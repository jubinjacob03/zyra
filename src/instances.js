require("dotenv").config();
const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const { initEmojis } = require("./utils/customEmoji");
const { ensurePlayMusicPanel } = require("./utils/playPanel");
const { youtubedl } = require("./utils/media");

let MusicQueue;
let searchSong;
let handleButtonInteraction;
let updateMusicController;
let processSpotifyPlaylistBackground;
let formatDuration;
let spotifyAPI;

const instanceConfig = require("../config.json");

const asEphemeral = (payload) => ({
  ...payload,
  flags: 64,
});

const createSilentChannel = () => {
  const silentMessage = {
    edit: async () => {},
    fetch: async () => {},
  };

  return {
    send: async () => silentMessage,
  };
};

const createPanelChannel = (baseChannel) => {
  const silentMessage = {
    edit: async () => {},
    fetch: async () => {},
  };

  const allowPanelPayload = (payload) => {
    if (!payload || typeof payload === "string") return false;
    if (payload.content) return false;
    if (payload.components || payload.flags) return true;
    return false;
  };

  return {
    send: async (payload) => {
      if (!baseChannel) {
        return silentMessage;
      }
      return baseChannel.send(payload);
    },
    messages: baseChannel?.messages,
    id: baseChannel?.id,
    guildId: baseChannel?.guildId,
  };
};

process.on("unhandledRejection", (reason) => {
  if (reason && typeof reason === "object") {
    if (reason.command && reason.command.includes("yt-dlp")) return;
    if (reason.message && reason.message.includes("Cannot perform IP discovery - socket closed")) return;
    if (reason.code === 10008 || reason.code === 10062) {
      console.log(
        `Discord API: ${reason.code === 10008 ? "Message deleted" : "Interaction expired"}`,
      );
      return;
    }
  }
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  if (error.message && error.message.includes("yt-dlp")) return;
  console.error("Uncaught exception:", error);
});

/**
 * Connects to a voice channel.
 * @param {Object} options - Connection options.
 * @param {import('discord.js').VoiceChannel} options.voiceChannel - The voice channel to join.
 * @param {string} options.guildId - The ID of the guild.
 * @param {number} [options.timeoutMs=30000] - Timeout in milliseconds.
 * @returns {Promise<import('@discordjs/voice').VoiceConnection>} The established voice connection.
 * @throws {Error} If the connection fails or times out.
 */
async function connectVoice({ voiceChannel, guildId, timeoutMs = 30000 }) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, timeoutMs);
    return connection;
  } catch (error) {
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
      connection.destroy();
    }
    throw error;
  }
}

/**
 * Creates a rejoiner utility to automatically reconnect to a voice channel if disconnected.
 * @param {Object} options - Rejoiner options.
 * @param {import('discord.js').VoiceChannel} options.voiceChannel - The voice channel to rejoin.
 * @param {string} options.guildId - The ID of the guild.
 * @param {Object} options.queue - The music queue associated with the connection.
 * @param {string} options.label - A label for logging purposes.
 * @returns {Object} An object containing `attach` and `startRetry` methods.
 */
function createRejoiner({ voiceChannel, guildId, queue, label }) {
  let retryTimer = null;
  let retrying = false;

  const attempt = async () => {
    if (retrying) return;
    retrying = true;

    try {
      const newConnection = await connectVoice({ voiceChannel, guildId });

      if (queue) {
        queue.connection = newConnection;
        newConnection.subscribe(queue.player);
      }

      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }

      attach(newConnection);
      console.log(`Rejoined ${label}`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      console.log(`Rejoin failed for ${label}: ${message}`);
    } finally {
      retrying = false;
    }
  };

  const startRetry = () => {
    if (retryTimer) return;
    retryTimer = setInterval(attempt, 5000);
    attempt();
  };

  const attach = (connection) => {
    connection.on(VoiceConnectionStatus.Disconnected, startRetry);
    connection.on(VoiceConnectionStatus.Destroyed, startRetry);
  };

  return { attach, startRetry };
}

/**
 * Starts a new music bot instance based on the provided configuration.
 * @param {Object} config - The configuration object for the instance.
 * @param {number} instanceIndex - The index of the instance being started.
 * @throws {Error} If the configuration is invalid or missing required fields.
 */
function startInstance(config, instanceIndex) {
  const label = `instance-${instanceIndex + 1}`;
  if (!process.env.RUNTIME_LOGGER_LABEL) {
    process.env.RUNTIME_LOGGER_LABEL = label;
  }

  if (!MusicQueue) {
    ({
      MusicQueue,
      searchSong,
      handleButtonInteraction,
      updateMusicController,
      processSpotifyPlaylistBackground,
      formatDuration,
      spotifyAPI,
    } = require("./index"));
  }

  if (!config) {
    throw new Error(`❌ Invalid instance index: ${instanceIndex + 1}`);
  }

  const {
    name: INSTANCE_NAME,
    botToken: INSTANCE_BOT_TOKEN,
    guildId: GUILD_ID,
    voiceChannelId: INSTANCE_VOICE_CHANNEL_ID,
    apiPort: INSTANCE_API_PORT,
  } = config;

  if (!INSTANCE_BOT_TOKEN || !GUILD_ID) {
    throw new Error(
      "❌ Missing configuration: botToken or guildId in config.json",
    );
  }

  console.log(`🎵 Starting instance: ${INSTANCE_NAME}`);
  console.log(`   Guild: ${GUILD_ID}`);
  console.log(
    `   Voice Channel (with built-in chat): ${INSTANCE_VOICE_CHANNEL_ID}`,
  );
  console.log(`   API Port: ${INSTANCE_API_PORT}`);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.commands = new Collection();
  client.queues = new Map();
  client.musicPanels = new Map();
  client.youtubedl = youtubedl;
  client.INSTANCE_NAME = INSTANCE_NAME;
  client.INSTANCE_VOICE_CHANNEL_ID = INSTANCE_VOICE_CHANNEL_ID;

  client.on("error", console.error);

  if (spotifyAPI) {
    client.spotifyAPI = spotifyAPI;
  }

  client.MusicQueue = MusicQueue;
  client.searchSong = searchSong;
  client.updateMusicController = updateMusicController;
  const silentChannel = createSilentChannel();
  client.processSpotifyPlaylistBackground = (tracks, queue) =>
    processSpotifyPlaylistBackground(queue, tracks, silentChannel);
  client.formatDuration = formatDuration;

  const originalHandleButtonInteraction = handleButtonInteraction;

  client.handleButtonInteraction = async (interaction) => {
    const previousReply = interaction.reply.bind(interaction);
    const previousFollowUp = interaction.followUp.bind(interaction);
    const previousDeferUpdate = interaction.deferUpdate?.bind(interaction);

    interaction.reply = (options) => previousReply(asEphemeral(options));
    interaction.followUp = (options) => previousFollowUp(asEphemeral(options));

    if (previousDeferUpdate) {
      interaction.deferUpdate = () => interaction.deferReply({ flags: 64 });
    }

    return originalHandleButtonInteraction(interaction, client);
  };

  client.getQueue = function (guildId) {
    return this.queues.get(guildId);
  };

  client.createQueue = async function (
    guildId,
    textChannel,
    voiceChannel,
    persistent = true,
  ) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (error) {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
      console.error("Voice connection failed:", error);
      throw new Error("Failed to connect to voice channel");
    }

    const panelChannel = createPanelChannel(voiceChannel);
    const queue = new MusicQueue(
      this,
      guildId,
      panelChannel,
      voiceChannel,
      connection,
      persistent,
    );
    this.queues.set(guildId, queue);

    const queueRejoiner = createRejoiner({
      voiceChannel,
      guildId,
      queue,
      label: `${INSTANCE_NAME} queue`,
    });
    queueRejoiner.attach(connection);

    return queue;
  };

  console.log(
    `✅ Instance configured - no slash commands, message-based control`,
  );

  client.once(Events.ClientReady, async (c) => {
    console.log(`🤖 Instance ready as ${c.user.tag} (name: ${INSTANCE_NAME})`);
    await initEmojis(client);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.error(`❌ Guild ${GUILD_ID} not found`);
      process.exit(1);
    }

    const voiceChannel = guild.channels.cache.get(INSTANCE_VOICE_CHANNEL_ID);
    if (!voiceChannel) {
      console.error(`❌ Voice channel ${INSTANCE_VOICE_CHANNEL_ID} not found`);
      process.exit(1);
    }

    const autoRejoiner = createRejoiner({
      voiceChannel,
      guildId: guild.id,
      label: `${INSTANCE_NAME} auto-join`,
    });

    try {
      const connection = await connectVoice({
        voiceChannel,
        guildId: guild.id,
      });

      console.log(`✅ Auto-joined voice channel: ${voiceChannel.name}`);

      autoRejoiner.attach(connection);
      try {
        await ensurePlayMusicPanel(voiceChannel, INSTANCE_NAME, c.user.id);
      } catch (error) {
        console.log("Could not post play panel:", error.message || error);
      }
    } catch (error) {
      console.error("Failed to join VC:", error);
      autoRejoiner.startRetry();
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.channelId !== INSTANCE_VOICE_CHANNEL_ID) return;

    if (interaction.isButton()) {
      if (interaction.customId === "play_song") {
        const {
          ModalBuilder,
          TextInputBuilder,
          TextInputStyle,
          ActionRowBuilder,
        } = require("discord.js");
        const { e } = require("./utils/customEmoji");

        const modal = new ModalBuilder()
          .setCustomId("song_input_modal")
          .setTitle(`${e("MUSIC")} Play Music`);

        const songInput = new TextInputBuilder()
          .setCustomId("song_query")
          .setLabel("Song name, YouTube or Spotify link")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g., royalty, https://youtu.be/...")
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(songInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
        return;
      }

      await client.handleButtonInteraction(interaction);
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "song_input_modal"
    ) {
      const query = interaction.fields.getTextInputValue("song_query");
      const member = interaction.member;
      const voiceChannel = member?.voice?.channel;

      if (!voiceChannel) {
        const { errorEmbed } = require("./utils/embed");
        const payload = errorEmbed("You need to be in a voice channel!");
        payload.flags = payload.flags | 64;
        return interaction.reply(payload);
      }

      await interaction.deferReply({ flags: 64 });

      try {
        console.log(`🔍 Modal search for: "${query}"`);

        const result = await Promise.race([
          client.searchSong(query, member),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Operation timeout")), 30000),
          ),
        ]);

        if (!result) {
          const { errorEmbed } = require("./utils/embed");
          return interaction.editReply(errorEmbed("No results found for your query."));
        }

        let queue = client.getQueue(interaction.guildId);

        if (!queue) {
          queue = await client.createQueue(
            interaction.guildId,
            interaction.channel,
            voiceChannel,
            true,
          );
        }

        queue.lastInteraction = interaction;

        if (result.type === "playlist") {
          queue.addSongs(result.tracks);
          const { successEmbed } = require("./utils/embed");
          await interaction.editReply(successEmbed(`Added ${result.tracks.length} songs`));

          if (result.backgroundProcessing) {
            client
              .processSpotifyPlaylistBackground(result.tracks, queue)
              .catch(console.error);
          }
        } else {
          queue.addSong(result);
          const { successEmbed } = require("./utils/embed");
          await interaction.editReply(successEmbed("Added to queue"));
        }

        if (!queue.playing) {
          queue.play();
        }
      } catch (error) {
        console.error("Modal play error:", error);
        const { errorEmbed } = require("./utils/embed");
        await interaction.editReply(errorEmbed(`${error.message || "Failed to play"}`));
      }
    }
  });

  let apiServer = null;
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      apiServer?.close();
    } catch {}
    try {
      client.destroy();
    } catch {}
    setTimeout(() => process.exit(0), 5000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  client.login(INSTANCE_BOT_TOKEN);

  setTimeout(() => {
    apiServer = require("./api")(client, INSTANCE_API_PORT);
  }, 3000);

  return client;
}

function startInstances({ index } = {}) {
  const instances = instanceConfig.instances || [];

  if (!instances.length) {
    console.log("⚠️ No instances configured");
    return [];
  }

  if (typeof index === "number") {
    if (index < 0 || index >= instances.length) {
      throw new Error(
        `❌ Invalid instance index. Use: node instances.js [1-${instances.length}]`,
      );
    }
    return [startInstance(instances[index], index)];
  }

  return [startInstance(instances[0], 0)];
}

if (require.main === module) {
  const arg = process.argv[2];
  let index;
  if (arg) {
    const parsed = parseInt(arg, 10);
    if (Number.isNaN(parsed)) {
      console.error(
        `❌ Invalid instance index. Use: node instances.js [1-${instanceConfig.instances.length}]`,
      );
      process.exit(1);
    }
    index = parsed - 1;
  }

  try {
    startInstances({ index });
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  startInstances,
};
