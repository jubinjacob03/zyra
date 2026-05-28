require("dotenv").config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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
const { Player, onBeforeCreateStream } = require("discord-player");
const {
  DefaultExtractors,
  SpotifyExtractor,
  SoundCloudExtractor,
} = require("@discord-player/extractor");

onBeforeCreateStream(async (track, queryType, queue) => {
  if (track.source === "spotify") {
    try {
      let q = track.title + " " + track.author;
      let scRes = await queue.player.search(q, { searchEngine: "soundcloud" });

      if (scRes.tracks.length === 0) {
        scRes = await queue.player.search(track.title, {
          searchEngine: "soundcloud",
        });
      }

      if (scRes.tracks.length > 0) {
        const scTrack = scRes.tracks[0];
        if (scTrack.thumbnail) {
          track.thumbnail = scTrack.thumbnail;
        }
        return await scTrack.extractor.stream(scTrack);
      }
    } catch (e) {}
  }
  return null;
});
const fs = require("fs");
const path = require("path");
const { formatDuration } = require("./utils/embed");
const { initEmojis, e } = require("./utils/customEmoji");
const { initRuntimeLogger } = require("./utils/runtimeLogger");
const {
  getControllerPanel,
  setControllerPanel,
} = require("./utils/panelStore");

require("dns").setDefaultResultOrder("ipv4first");

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

const player = new Player(client, {
  blockExtractors: ["YouTubeExtractor", "YoutubeExtractor"],
  blockStreamFrom: ["YouTubeExtractor", "YoutubeExtractor"],
  ytdlOptions: {
    quality: "highestaudio",
    highWaterMark: 1 << 25,
  },
  skipFFmpeg: false,
});

player.extractors
  .register(SpotifyExtractor, {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    bridgeProvider: SoundCloudExtractor,
  })
  .then(() => {
    player.extractors.loadMulti(
      DefaultExtractors.filter((e) => e.name !== "SpotifyExtractor"),
    );
  })
  .catch(console.error);
client.player = player;

const idlePhrases = [
  "🎧 /play to start",
  "✨ Vibe check: passed",
  "🫧 Breathing between beats",
  "🌙 Lowkey online",
  "🧊 Chill rn",
  "💫 Just vibing",
  "📻 Static-free",
  "🪩 Mood: playlist",
  "☕ Coffee break, still tuned in",
  "🎯 Energy: steady",
  "🍀 Good vibes only",
  "🛰️ Ready when you are",
];

const pickIdlePhrase = () =>
  idlePhrases[Math.floor(Math.random() * idlePhrases.length)];

const setPresenceActivity = (trackOrText) => {
  if (!client?.user) return;
  if (trackOrText && trackOrText.title) {
    client.user.setPresence({
      activities: [{
        name: (trackOrText.title || "music").slice(0, 128),
        type: ActivityType.Listening,
        timestamps: { start: Date.now() },
      }],
      status: "online",
    });
  } else {
    const presenceText = typeof trackOrText === "string" ? trackOrText : pickIdlePhrase();
    client.user.setPresence({
      activities: [{
        name: presenceText,
        type: ActivityType.Listening,
      }],
      status: "online",
    });
  }
};

client.updateMusicPresence = (track) => setPresenceActivity(track);
client.updateVoiceStatus = (channel, status) => setVoiceChannelStatus(channel, status);

const isAnyTrackPlaying = () => {
  for (const queue of client.player?.nodes?.cache?.values() || []) {
    if (queue?.currentTrack) return true;
  }
  return false;
};

const setVoiceChannelStatus = async (channel, status) => {
  if (!channel) return;
  if (typeof channel.setStatus === "function") {
    try {
      await channel.setStatus(status ?? null);
      return;
    } catch {}
  }
  try {
    await channel.edit({ status: status ?? null });
  } catch {}
};

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

player.events.on("playerStart", async (queue, track) => {
  const { createCompleteMusicController } = require("./utils/componentsV2");
  const {
    getControllerPanel,
    setControllerPanel,
  } = require("./utils/panelStore");
  const controller = createCompleteMusicController(queue);

  const textChannel = queue.metadata?.channel;
  if (!textChannel) return;

  let message = null;
  const existingData = client.musicPanels.get(queue.guild.id);

  if (existingData && existingData.message) {
    try {
      message = await existingData.message.edit({
        embeds: [],
        components: controller.components,
        flags: controller.flags,
      });
    } catch (e) {
      message = await textChannel.send({
        components: controller.components,
        flags: controller.flags,
      });
    }
  } else {
    message = await textChannel.send({
      components: controller.components,
      flags: controller.flags,
    });
  }

  if (message?.id && message?.channelId) {
    setControllerPanel(message.channelId, message.id);
  }

  client.musicPanels.set(queue.guild.id, {
    message,
    song: track,
    startTime: Date.now(),
  });

  setPresenceActivity(track);
  await setVoiceChannelStatus(queue.channel, `✨ Now playing: ${track.title}`);
  console.log("🎵 Now playing:", track.title);
});

player.events.on("audioTrackAdd", (queue, track) => {
  console.log(`🎵 Track added to queue: ${track.title}`);
});

player.events.on("disconnect", async (queue) => {
  client.musicPanels.delete(queue.guild.id);
  setPresenceActivity(pickIdlePhrase());

  setInterval(() => {
    if (!isAnyTrackPlaying()) {
      setPresenceActivity(pickIdlePhrase());
    }
  }, 120000);
  await setVoiceChannelStatus(queue.channel, "🎵 /play to start");
});

player.events.on("emptyQueue", async (queue) => {
  console.log("🎵 Queue finished");
  client.musicPanels.delete(queue.guild.id);
  setPresenceActivity(pickIdlePhrase());
  await setVoiceChannelStatus(queue.channel, "🎵 /play to start");
});

player.events.on("error", (queue, error) => {
  console.error(`Player error: ${error.message}`);
});

player.events.on("playerError", (queue, error) => {
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

  const { e } = require("./utils/customEmoji");
  const { COLORS } = require("./utils/embed");
  const {
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags,
  } = require("discord.js");

  const sendEphemeralEmbed = async (color, message) => {
    const container = new ContainerBuilder().setAccentColor(color);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(message),
    );
    return interaction.followUp({
      components: [container],
      flags: MessageFlags.IsComponentsV2 | 64,
    });
  };

  const DiscordPlayer = require("./utils/DiscordPlayer");

  const botVoiceChannelId = interaction.guild.members.me.voice.channelId;
  if (
    !botVoiceChannelId ||
    (!DiscordPlayer.isUsingLavalink(client, interaction.guildId) &&
      !DiscordPlayer.isUsingDiscordPlayer(client, interaction.guildId))
  ) {
    return sendEphemeralEmbed(
      COLORS.ERROR,
      `${e("ERROR")} Nothing is playing right now.`,
    );
  }

  const member = interaction.member;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel || voiceChannel.id !== botVoiceChannelId) {
    return sendEphemeralEmbed(
      COLORS.ERROR,
      `${e("ERROR")} You need to be in the same voice channel.`,
    );
  }

  try {
    switch (interaction.customId) {
      case "music_pause":
        const { isPaused } = await DiscordPlayer.pause(
          interaction.guildId,
          client,
        );
        if (isPaused) {
          await sendEphemeralEmbed(
            COLORS.INFO,
            `${e("PAUSE")} Paused the music.`,
          );
        } else {
          await sendEphemeralEmbed(
            COLORS.INFO,
            `${e("PLAY")} Resumed the music.`,
          );
        }
        break;

      case "music_skip":
        await DiscordPlayer.skip(interaction.guildId, client);
        await sendEphemeralEmbed(
          COLORS.INFO,
          `${e("SKIP")} Skipped the current song.`,
        );
        break;

      case "music_stop":
        client.musicPanels.delete(interaction.guildId);
        await DiscordPlayer.stop(interaction.guildId, client);
        await sendEphemeralEmbed(
          COLORS.ERROR,
          `${e("STOP")} Stopped the music and cleared the queue.`,
        );
        break;

      case "music_shuffle":
        await DiscordPlayer.shuffle(interaction.guildId, client);
        await sendEphemeralEmbed(
          COLORS.INFO,
          `${e("SHUFFLE")} Shuffled the queue.`,
        );
        break;

      case "music_loop":
        const modes = ["Off", "Track", "Queue", "Autoplay"];
        const nextMode = await DiscordPlayer.loop(interaction.guildId, client);
        await sendEphemeralEmbed(
          COLORS.INFO,
          `${e("LOOP")} Loop mode: **${modes[nextMode]}**`,
        );
        break;

      case "music_previous":
        const hasPrev = await DiscordPlayer.previous(
          interaction.guildId,
          client,
        );
        if (hasPrev) {
          await sendEphemeralEmbed(
            COLORS.INFO,
            `${e("PREVIOUS")} Playing previous track.`,
          );
        } else {
          await sendEphemeralEmbed(
            COLORS.ERROR,
            `${e("PREVIOUS")} Previous track not available.`,
          );
        }
        break;

      case "music_queue":
        const queueInfo = DiscordPlayer.getQueueInfo(
          interaction.guildId,
          client,
        );
        if (!queueInfo) break;
        const queueList = queueInfo.tracks
          .map(
            (song, i) =>
              `**${i + 1}.** [${song.title}](${song.url}) - \`${song.duration}\``,
          )
          .join("\n");
        const currentStr = queueInfo.current
          ? `**${e("PLAY")} Now:** [${queueInfo.current.title}](${queueInfo.current.url}) - \`${queueInfo.current.duration}\`\n\n`
          : "";
        await sendEphemeralEmbed(
          COLORS.INFO,
          `${e("QUEUE")} **Queue** (${queueInfo.size} songs)\n\n${currentStr}${queueList}`,
        );
        break;

      case "music_voldown":
        const newVolDown = await DiscordPlayer.adjustVolume(
          interaction.guildId,
          client,
          -10,
        );
        await sendEphemeralEmbed(
          COLORS.INFO,
          `${e("VOLDOWN")} Volume: **${newVolDown}%**`,
        );
        break;

      case "music_volup":
        const newVolUp = await DiscordPlayer.adjustVolume(
          interaction.guildId,
          client,
          10,
        );
        await sendEphemeralEmbed(
          COLORS.INFO,
          `${e("VOLUP")} Volume: **${newVolUp}%**`,
        );
        break;

      case "music_refresh":
        await sendEphemeralEmbed(
          COLORS.INFO,
          `${e("REFRESH")} Music controller refreshed!`,
        );
        break;

      default:
        await sendEphemeralEmbed(
          COLORS.ERROR,
          `${e("WARNING")} Unknown button action.`,
        );
    }

    await DiscordPlayer.triggerUpdate(interaction.guildId, client);
  } catch (error) {
    console.error("Button interaction error:", error);
    try {
      await sendEphemeralEmbed(
        COLORS.ERROR,
        `${e("ERROR")} An error occurred.`,
      );
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
      await client.user.setAvatar(avatarPath).catch(console.error);
      console.log("✅ Avatar updated successfully!");
    }
  } catch (error) {
    if (error.code !== 50035) {
      console.log("ℹ️ Avatar already set or rate limited");
    }
  }

  setPresenceActivity(pickIdlePhrase());

  setInterval(() => {
    const status = `✅ Bot alive | ${client.guilds.cache.size} servers | ${client.player.nodes.cache.size} active queues`;
    console.log(status);
  }, 900000);
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

  const { initWatchdog } = require("./utils/watchdog");
  const watchdog = initWatchdog(client);

  const { initScraper } = require("./scraper/NodeScraper");
  initScraper(watchdog);

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
