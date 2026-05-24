require("dotenv").config();

// Map Spotify credentials for discord-player extractor
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
  process.env.DP_SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  process.env.DP_SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
}

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} = require("discord.js");
const { Player } = require("discord-player");
const { DefaultExtractors, SpotifyExtractor, SoundCloudExtractor } = require("@discord-player/extractor");
const fs = require("fs");
const path = require("path");
const { formatDuration } = require("./utils/embed");
const { initEmojis, e } = require("./utils/customEmoji");
const { initRuntimeLogger } = require("./utils/runtimeLogger");
const { getControllerPanel, setControllerPanel } = require("./utils/panelStore");

require('dns').setDefaultResultOrder('ipv4first');

initRuntimeLogger({ label: process.env.RUNTIME_LOGGER_LABEL || "main" });

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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.commands = new Collection();
client.musicPanels = new Map();

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
  async onBeforeCreateStream(track, source, _fallback) {
    if (track.source === 'spotify') {
      try {
        const query = track.title + ' ' + track.author;
        const res = await player.search(query, { searchEngine: 'soundcloud' });
        if (res.tracks.length > 0) {
          const scTrack = res.tracks[0];
          return await scTrack.extractor.stream(scTrack);
        }
      } catch (err) {
        console.error("Custom bridge failed:", err);
      }
    }
    return _fallback(track, source);
  }
});

player.extractors.register(SpotifyExtractor, {
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  bridgeProvider: SoundCloudExtractor
}).then(() => {
  player.extractors.loadMulti(DefaultExtractors.filter(e => e.name !== 'SpotifyExtractor'));
}).catch(console.error);
client.player = player;

/**
 * Checks if a message is editable by the client.
 * @param {import('discord.js').Message} message - The message to check.
 * @param {string} clientUserId - The client's user ID.
 * @returns {boolean} True if editable.
 */
const isEditableByClient = (message, clientUserId) => {
  if (!message) return false;
  if (typeof message.editable === "boolean") return message.editable;
  if (!clientUserId) return true;
  return message.author?.id === clientUserId;
};

/**
 * Finds an existing music panel message in the given channel.
 * @param {import('discord.js').TextChannel} channel - The text channel to search.
 * @param {string} clientUserId - The client's user ID.
 * @returns {Promise<import('discord.js').Message|null>} The found message or null.
 */
async function findExistingMusicPanel(channel, clientUserId) {
  if (!channel || !channel.messages || !channel.messages.fetch) return null;

  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    return (
      messages.find(
        (message) =>
          isEditableByClient(message, clientUserId) &&
          message.components?.some((row) =>
            row.components?.some(
              (component) =>
                typeof component.customId === "string" &&
                component.customId.startsWith("music_"),
            ),
          ),
      ) || null
    );
  } catch {
    return null;
  }
}

/**
 * Resolves a stored music panel message from the channel ID.
 * @param {import('discord.js').Client} client - The Discord client.
 * @param {string} channelId - The ID of the channel.
 * @returns {Promise<import('discord.js').Message|null>} The resolved message or null.
 */
async function resolveStoredMusicPanel(client, channelId) {
  if (!channelId) return null;
  const storedId = getControllerPanel(channelId);
  if (!storedId) return null;

  let channel = client.channels.cache.get(channelId);
  if (!channel) {
    try {
      channel = await client.channels.fetch(channelId);
    } catch {
      channel = null;
    }
  }

  if (!channel?.messages?.fetch) return null;

  try {
    const message = await channel.messages.fetch(storedId);
    if (isEditableByClient(message, client.user?.id)) {
      return message;
    }
  } catch (error) {
    if (error?.code === 10008 || error?.code === 10003) {
      setControllerPanel(channelId, null);
    }
  }

  return null;
}

player.events.on('playerStart', async (queue, track) => {
  const { createCompleteMusicController } = require("./utils/componentsV2");
  const { getControllerPanel, setControllerPanel } = require("./utils/panelStore");
  const controller = createCompleteMusicController(queue);

  const textChannel = queue.metadata?.channel;
  if (!textChannel) return;

  // Master bot behavior: always send a new message, do not delete the old one.
  const message = await textChannel.send({ components: controller.components, flags: controller.flags });

  if (message?.id && message?.channelId) {
    setControllerPanel(message.channelId, message.id);
  }

  client.musicPanels.set(queue.guild.id, {
    message,
    song: track,
    startTime: Date.now(),
  });
  console.log("🎵 Now playing:", track.title);
});

player.events.on('audioTrackAdd', (queue, track) => {
  console.log(`🎵 Track added to queue: ${track.title}`);
});

player.events.on('disconnect', async (queue) => {
  const textChannel = queue.metadata?.channel;
  if (textChannel) {
    const { getControllerPanel } = require("./utils/panelStore");
    const storedId = getControllerPanel(textChannel.id);
    if (storedId) {
      try {
        const message = await textChannel.messages.fetch(storedId);
        if (message && isEditableByClient(message, client.user?.id)) {
          const { createIdleMusicController } = require("./utils/componentsV2");
          const payload = createIdleMusicController("Disconnected. Add more songs to keep the party going!");
          await message.edit({ embeds: [], components: payload.components, flags: payload.flags }).catch(() => {});
        }
      } catch (e) {}
    }
  }
  client.musicPanels.delete(queue.guild.id);
});

player.events.on('emptyQueue', async (queue) => {
  console.log("🎵 Queue finished");
  const textChannel = queue.metadata?.channel;
  if (textChannel) {
    const { getControllerPanel } = require("./utils/panelStore");
    const storedId = getControllerPanel(textChannel.id);
    if (storedId) {
      try {
        const message = await textChannel.messages.fetch(storedId);
        if (message && isEditableByClient(message, client.user?.id)) {
          const { createIdleMusicController } = require("./utils/componentsV2");
          const payload = createIdleMusicController("Queue finished. Add more songs to keep the party going!");
          await message.edit({ embeds: [], components: payload.components, flags: payload.flags }).catch(() => {});
        }
      } catch (e) {}
    }
  }
  client.musicPanels.delete(queue.guild.id);
});

player.events.on('error', (queue, error) => {
  console.error(`Player error: ${error.message}`);
});

player.events.on('playerError', (queue, error) => {
  console.error(`Player error: ${error.message}`);
});

/**
 * Handles music panel button clicks.
 * @param {import('discord.js').ButtonInteraction} interaction - The button interaction.
 * @param {import('discord.js').Client} client - The Discord client.
 */
async function handleButtonInteraction(interaction, client) {
  try {
    await interaction.deferUpdate();
  } catch (error) {
    console.error("Failed to defer button interaction:", error.message);
    return;
  }

  const queue = client.player.nodes.get(interaction.guildId);

  if (!queue || !queue.isPlaying()) {
    return interaction.followUp({
      content: `${e("ERROR")} Nothing is playing right now.`,
      ephemeral: true,
    });
  }

  const member = interaction.member;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel || voiceChannel.id !== queue.channel.id) {
    return interaction.followUp({
      content: `${e("ERROR")} You need to be in the same voice channel.`,
      ephemeral: true,
    });
  }

  try {
    switch (interaction.customId) {
      case "music_pause":
        if (queue.node.isPaused()) {
          queue.node.resume();
          await interaction.followUp({ ephemeral: true, content: `${e("PLAY")} Resumed the music.` });
        } else {
          queue.node.pause();
          await interaction.followUp({ ephemeral: true, content: `${e("PAUSE")} Paused the music.` });
        }
        break;

      case "music_skip":
        queue.node.skip();
        await interaction.followUp({
          ephemeral: true,
          content: `${e("SKIP")} Skipped the current song.`,
        });
        break;

      case "music_stop":
        queue.delete();
        await interaction.followUp({
          ephemeral: true,
          content: `${e("STOP")} Stopped the music and cleared the queue.`,
        });
        break;

      case "music_shuffle":
        queue.tracks.shuffle();
        await interaction.followUp({ ephemeral: true, content: `${e("SHUFFLE")} Shuffled the queue.` });
        break;

      case "music_loop":
        const modes = ["Off", "Track", "Queue", "Autoplay"];
        const nextMode = (queue.repeatMode + 1) % 4;
        queue.setRepeatMode(nextMode);
        await interaction.followUp({
          ephemeral: true,
          content: `${e("LOOP")} Loop mode: **${modes[nextMode]}**`,
        });
        break;

      case "music_previous":
        if (queue.history.previousTrack) {
          await queue.history.previous();
          await interaction.followUp({
            ephemeral: true,
            content: `${e("PREVIOUS")} Playing previous track.`,
          });
        } else {
          await interaction.followUp({
            ephemeral: true,
            content: `${e("PREVIOUS")} Previous track not available.`,
          });
        }
        break;

      case "music_queue":
        const tracks = queue.tracks.toArray().slice(0, 10);
        const queueList = tracks
          .map(
            (song, i) =>
              `**${i + 1}.** [${song.title}](${song.url}) - \`${song.duration}\``,
          )
          .join("\n");
        const current = queue.currentTrack;
        const currentStr = current ? `**${e("PLAY")} Now:** [${current.title}](${current.url}) - \`${current.duration}\`\n\n` : "";
        await interaction.followUp({
          ephemeral: true,
          content: `${e("QUEUE")} **Queue** (${queue.tracks.size} songs)\n\n${currentStr}${queueList}`,
        });
        break;

      case "music_voldown":
        const newVolDown = Math.max(0, queue.node.volume - 10);
        queue.node.setVolume(newVolDown);
        await interaction.followUp({
          ephemeral: true,
          content: `${e("VOLDOWN")} Volume: **${newVolDown}%**`,
        });
        break;

      case "music_volup":
        const newVolUp = Math.min(100, queue.node.volume + 10);
        queue.node.setVolume(newVolUp);
        await interaction.followUp({ ephemeral: true, content: `${e("VOLUP")} Volume: **${newVolUp}%**` });
        break;

      case "music_refresh":
        await interaction.followUp({
          content: `${e("REFRESH")} Music controller refreshed!`,
          ephemeral: true,
        });
        break;

      default:
        await interaction.followUp({
          content: `${e("WARNING")} Unknown button action.`,
          ephemeral: true,
        });
    }

    await updateMusicController(interaction, queue);
  } catch (error) {
    console.error("Button interaction error:", error);
    try {
      await interaction.followUp({
        content: `${e("ERROR")} An error occurred.`,
        ephemeral: true,
      });
    } catch (replyError) {
      console.error("Failed to send error message:", replyError);
    }
  }
}

/**
 * Update the music controller after button interactions.
 * @param {import('discord.js').ButtonInteraction} interaction - The button interaction.
 * @param {import('discord-player').GuildQueue} queue - The music queue.
 */
async function updateMusicController(interaction, queue) {
  try {
    if (!interaction.message || !interaction.message.id) {
      console.log("No message to update - interaction message not found");
      return;
    }

    const { createCompleteMusicController } = require("./utils/componentsV2");
    const controller = createCompleteMusicController(queue);

    if (controller && interaction.message) {
      await interaction.message.edit({
        embeds: controller.embeds,
        components: controller.components,
        flags: controller.flags,
      });
    }
  } catch (error) {
    if (error.code === 10008) {
      console.log("Message was deleted - cannot update music controller");
      client.musicPanels.delete(queue.guild.id);
    } else if (error.code === 10062) {
      console.log("Interaction expired - cannot update music controller");
    } else {
      console.error("Error updating music controller:", error.message);
    }
  }
}

client.on("error", console.error);

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  delete require.cache[require.resolve(filePath)];
  const command = require(filePath);
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: ${command.data.name}`);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  initEmojis(readyClient);

  console.log(`\n🎵 Remani Music Bot is online!`);
  console.log(`📡 Logged in as ${readyClient.user.tag}`);
  console.log(`🌐 Serving ${readyClient.guilds.cache.size} servers\n`);

  try {
    const avatarPath = path.join(__dirname, "..", "assets", "avatar.jpg");
    if (fs.existsSync(avatarPath)) {
      await client.user.setAvatar(avatarPath);
      console.log("✅ Avatar updated successfully!");
    }
  } catch (error) {
    if (error.code !== 50035) {
      console.log("ℹ️ Avatar already set or rate limited");
    }
  }

  client.user.setActivity("🎵 /play to start", {
    type: ActivityType.Listening,
  });

  setInterval(() => {
    const status = `✅ Bot alive | ${client.guilds.cache.size} servers | ${client.player.nodes.cache.size} active queues`;
    console.log(status);
  }, 30000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client);
    } catch (error) {
      if (error.code === 10062 || error.code === 40060) {
        return;
      }

      console.error(`Error executing ${interaction.commandName}:`, error);

      const errorMessage = {
        content: `${e("ERROR")} There was an error executing this command!`,
        ephemeral: true,
      };

      try {
        if (interaction.replied) {
          await interaction.followUp(errorMessage);
        } else if (interaction.deferred) {
          await interaction.editReply(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (replyError) {
        if (replyError.code !== 10062 && replyError.code !== 40060) {
          console.error("Failed to send error message:", replyError);
        }
      }
    }
  }

  if (interaction.isButton()) {
    await handleButtonInteraction(interaction, client);
  }
});

function startMainBot() {
  if (!process.env.DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN is not set in .env file!");
    process.exit(1);
  }

  const apiServer = require("./api")(client);

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

  return client.login(process.env.DISCORD_TOKEN);
}

if (require.main === module) {
  startMainBot();
}

module.exports = {
  handleButtonInteraction,
  updateMusicController,
  formatDuration,
  startMainBot,
};
