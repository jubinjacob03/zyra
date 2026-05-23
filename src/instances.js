require("dotenv").config();

// Map Spotify credentials for discord-player extractor
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
  process.env.DP_SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  process.env.DP_SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
}

const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");
const { Player } = require("discord-player");
const { DefaultExtractors } = require("@discord-player/extractor");
const { initEmojis } = require("./utils/customEmoji");
const { ensurePlayMusicPanel } = require("./utils/playPanel");

let handleButtonInteraction;
let updateMusicController;
let formatDuration;

require('dns').setDefaultResultOrder('ipv4first');

const instanceConfig = require("../config.json");

const asEphemeral = (payload) => ({
  ...payload,
  flags: 64,
});

process.on("unhandledRejection", (reason) => {
  if (reason && typeof reason === "object") {
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
  console.error("Uncaught exception:", error);
});

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

  if (!handleButtonInteraction) {
    ({
      handleButtonInteraction,
      updateMusicController,
      formatDuration,
    } = require("./bot"));
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
  client.musicPanels = new Map();
  client.INSTANCE_NAME = INSTANCE_NAME;
  client.INSTANCE_VOICE_CHANNEL_ID = INSTANCE_VOICE_CHANNEL_ID;

  client.on("error", console.error);

  /**
   * Initialize Discord Player with optimized settings for low-memory environments.
   * Blocks YouTube extractors to bypass rate limits and forces fallback to SoundCloud/Spotify.
   */
  const player = new Player(client, {
    blockExtractors: ['YouTubeExtractor', 'YoutubeExtractor'],
    blockStreamFrom: ['YouTubeExtractor', 'YoutubeExtractor'],
    ytdlOptions: {
      quality: 'highestaudio',
      highWaterMark: 1 << 25
    },
    skipFFmpeg: false, // Required for volume control and audio filters
  });

  player.extractors.loadMulti(DefaultExtractors);
  client.player = player;

  client.updateMusicController = updateMusicController;
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

    const { joinVoiceChannel } = require('@discordjs/voice');
    const forceJoinVC = () => {
      try {
        joinVoiceChannel({
          channelId: INSTANCE_VOICE_CHANNEL_ID,
          guildId: GUILD_ID,
          adapterCreator: guild.voiceAdapterCreator,
          group: client.user.id,
        });
      } catch (e) {
        console.error("Failed to force join VC:", e);
      }
    };

    forceJoinVC();

    // Auto-rejoin if disconnected
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (oldState.member.user.id === client.user.id) {
        if (!newState.channelId || newState.channelId !== INSTANCE_VOICE_CHANNEL_ID) {
          setTimeout(forceJoinVC, 1000);
        }
      }
    });

    try {
      await ensurePlayMusicPanel(voiceChannel, INSTANCE_NAME, c.user.id);
    } catch (error) {
      console.log("Could not post play panel:", error.message || error);
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
          .setTitle(`🎵 Play Music`);

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

        const result = await client.player.search(query, {
          requestedBy: interaction.user,
        });

        if (!result || result.isEmpty()) {
          const { errorEmbed } = require("./utils/embed");
          return interaction.editReply(errorEmbed("No results found for your query."));
        }

        await client.player.play(voiceChannel, result, {
          nodeOptions: {
            metadata: {
              channel: interaction.channel,
            },
            leaveOnEmpty: false,
            leaveOnEnd: false,
            leaveOnStop: false,
          },
        });

        const { successEmbed } = require("./utils/embed");
        if (result.hasPlaylist()) {
          await interaction.editReply(successEmbed(`Added ${result.playlist.tracks.length} songs`));
        } else {
          await interaction.editReply(successEmbed("Added to queue"));
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

/**
 * Starts all configured instances or a specific instance by index.
 * @param {Object} options - Options object.
 * @param {number} [options.index] - The specific instance index to start.
 * @returns {Array<Promise<import('discord.js').Client>>} Array of promises resolving to the started clients.
 */
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

  return instances.map((instance, i) => startInstance(instance, i));
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
