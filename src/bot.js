require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} = require("discord.js");
const { Player } = require("discord-player");

const fs = require("fs");
const path = require("path");
const { formatDuration } = require("./utils/embed");
const { initEmojis, e } = require("./utils/customEmoji");
const { initRuntimeLogger } = require("./utils/runtimeLogger");
const { createLogger } = require("./utils/logger");
const { swallow } = require("./utils/resilience");
const {
  getControllerPanel,
  setControllerPanel,
} = require("./utils/panelStore");

require("dns").setDefaultResultOrder("ipv4first");

initRuntimeLogger({ label: process.env.RUNTIME_LOGGER_LABEL || "main" });

const log = createLogger("bot");

if (process.env.ALLOW_INSECURE_TLS === "1") {
  log.warn(
    "ALLOW_INSECURE_TLS=1 — TLS certificate validation is DISABLED for this process.",
  );
}

/** How often, while idle, the presence is refreshed to a random idle phrase. */
const IDLE_PRESENCE_INTERVAL_MS = 120_000;
/** How often a heartbeat line is logged. */
const STATUS_LOG_INTERVAL_MS = 900_000;

/** @type {NodeJS.Timeout|null} */
let idlePresenceInterval = null;
/** @type {NodeJS.Timeout|null} */
let statusLogInterval = null;

process.on("unhandledRejection", (reason) => {
  if (reason && typeof reason === "object") {
    if (reason.code === 10008 || reason.code === 10062) {
      log.info(
        `Discord API: ${reason.code === 10008 ? "Message deleted" : "Interaction expired"}`,
      );
      return;
    }
  }
  log.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
});

const { musicBotCacheConfig } = require("./utils/clientCache");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
  ...musicBotCacheConfig(),
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
      activities: [
        {
          name: (trackOrText.title || "music").slice(0, 128),
          type: ActivityType.Listening,
          timestamps: { start: Date.now() },
        },
      ],
      status: "online",
    });
  } else {
    const presenceText =
      typeof trackOrText === "string" ? trackOrText : pickIdlePhrase();
    client.user.setPresence({
      activities: [
        {
          name: presenceText,
          type: ActivityType.Listening,
        },
      ],
      status: "online",
    });
  }
};

client.updateMusicPresence = (track) => setPresenceActivity(track);
client.updateVoiceStatus = (channel, status) =>
  setVoiceChannelStatus(channel, status);

const isAnyTrackPlaying = () => {
  for (const queue of client.player?.nodes?.cache?.values() || []) {
    if (queue?.currentTrack) return true;
  }
  const DiscordPlayer = require("./utils/DiscordPlayer");
  for (const [key, queue] of DiscordPlayer.lavalinkQueues.entries()) {
    if (key.startsWith(client.user.id) && queue?.current) return true;
  }
  return false;
};

const setVoiceChannelStatus = async (channel, status) => {
  if (!channel) return;
  const channelObj =
    typeof channel === "string" ? client.channels.cache.get(channel) : channel;
  const channelId = typeof channel === "string" ? channel : channel.id;

  if (channelObj && typeof channelObj.setStatus === "function") {
    try {
      await channelObj.setStatus(status ?? null);
      return;
    } catch (e) {
      log.debug("setStatus failed; falling back to REST:", e?.message || e);
    }
  }

  try {
    await client.rest.put(`/channels/${channelId}/voice-status`, {
      body: { status: status ? status.slice(0, 500) : "" },
    });
  } catch (e) {
    log.debug(
      `Voice status REST update failed for ${channelId}:`,
      e?.message || e,
    );
  }
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
  try {
    const { createCompleteMusicController } = require("./utils/componentsV2");
    const {
      getControllerPanel: getStored,
      setControllerPanel: setStored,
    } = require("./utils/panelStore");
    const controller = createCompleteMusicController(queue);

    const textChannel = queue.metadata?.channel;
    if (!textChannel) return;

    let message = null;
    const existingData = client.musicPanels.get(queue.guild.id);

    if (existingData && existingData.message) {
      message = existingData.message;
    } else {
      const storedId = getStored(textChannel.id);
      if (storedId) {
        try {
          message = await textChannel.messages.fetch(storedId);
        } catch (e) {
          log.debug(`Stored panel ${storedId} not fetchable:`, e?.message || e);
        }
      }
    }

    const payload = {
      components: controller.components,
      flags: controller.flags,
    };
    if (message && typeof message.edit === "function") {
      try {
        message = await message.edit({ embeds: [], ...payload });
      } catch (e) {
        log.debug("Panel edit failed; resending:", e?.message || e);
        message = await textChannel.send(payload);
      }
    } else {
      message = await textChannel.send(payload);
    }

    if (message?.id && message?.channelId) {
      setStored(message.channelId, message.id);
    }

    client.musicPanels.set(queue.guild.id, {
      message,
      song: track,
      startTime: Date.now(),
    });

    setPresenceActivity(track);
    await setVoiceChannelStatus(queue.channel, `✨ Playing - ${track.title}`);
    log.info("Now playing:", track.title);
  } catch (error) {
    log.error("playerStart handler failed:", error?.message || error);
  }
});

player.events.on("audioTrackAdd", (queue, track) => {
  log.info(`Track added to queue: ${track.title}`);
});

player.events.on("disconnect", async (queue) => {
  try {
    client.musicPanels.delete(queue.guild.id);
    const phrase = pickIdlePhrase();
    setPresenceActivity(phrase);
    await setVoiceChannelStatus(queue.channel, phrase);
  } catch (error) {
    log.warn("disconnect handler failed:", error?.message || error);
  }
});

player.events.on("emptyQueue", async (queue) => {
  if (queue.repeatMode !== 0) return;
  try {
    log.info("Queue finished");
    client.musicPanels.delete(queue.guild.id);
    const phrase = pickIdlePhrase();
    setPresenceActivity(phrase);
    await setVoiceChannelStatus(queue.channel, phrase);
  } catch (error) {
    log.warn("emptyQueue handler failed:", error?.message || error);
  }
});

player.events.on("error", (queue, error) => {
  log.error(`Player error: ${error.message}`);
});

player.events.on("playerError", (queue, error) => {
  log.error(`Player error: ${error.message}`);
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
    log.warn("Failed to defer button interaction:", error.message);
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
    const { EmbedBuilder } = require("discord.js");
    const embed = new EmbedBuilder().setColor(color).setDescription(message);

    return interaction.followUp({
      embeds: [embed],
      components: [],
      flags: 64,
    });
  };

  const DiscordPlayer = require("./utils/DiscordPlayer");

  const botVoiceChannelId =
    interaction.guild?.members?.me?.voice?.channelId || null;
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
  const voiceChannel = member?.voice?.channel;

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
    log.error("Button interaction error:", error);
    try {
      await sendEphemeralEmbed(
        COLORS.ERROR,
        `${e("ERROR")} An error occurred.`,
      );
    } catch (replyError) {
      log.warn(
        "Failed to send error message:",
        replyError?.message || replyError,
      );
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
      log.debug("No message to update - interaction message not found");
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
      log.debug("Message was deleted - cannot update music controller");
      queue.guild.client.musicPanels.delete(queue.guild.id);
    } else if (error.code === 10062) {
      log.debug("Interaction expired - cannot update music controller");
    } else {
      log.error("Error updating music controller:", error.message);
    }
  }
}

client.on("error", (err) => log.error("Client error:", err));

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
    log.info(`Loaded command: ${command.data.name}`);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  initEmojis(readyClient);

  log.info(`Remani Music Bot is online!`);
  log.info(`Logged in as ${readyClient.user.tag}`);
  log.info(`Serving ${readyClient.guilds.cache.size} servers`);

  try {
    const avatarPath = path.join(__dirname, "..", "assets", "avatar.jpg");
    if (fs.existsSync(avatarPath)) {
      await client.user
        .setAvatar(avatarPath)
        .catch((err) => log.warn("Avatar update failed:", err?.message || err));
      log.info("Avatar updated successfully!");
    }
  } catch (error) {
    if (error.code !== 50035) {
      log.info("Avatar already set or rate limited");
    }
  }

  setPresenceActivity(pickIdlePhrase());

  if (!idlePresenceInterval) {
    idlePresenceInterval = setInterval(() => {
      if (!isAnyTrackPlaying()) {
        const phrase = pickIdlePhrase();
        setPresenceActivity(phrase);
        const botChannel =
          client.guilds.cache.first()?.members?.me?.voice?.channelId;
        if (botChannel) setVoiceChannelStatus(botChannel, phrase);
      }
    }, IDLE_PRESENCE_INTERVAL_MS);
  }

  if (!statusLogInterval) {
    statusLogInterval = setInterval(() => {
      log.info(
        `Alive | ${client.guilds.cache.size} servers | ${client.player.nodes.cache.size} active queues`,
      );
    }, STATUS_LOG_INTERVAL_MS);
  }
});

client.on(Events.GuildDelete, (guild) => {
  const DiscordPlayer = require("./utils/DiscordPlayer");
  swallow(
    DiscordPlayer.cleanupGuild(client, guild.id),
    `Cleanup after leaving guild ${guild.id}`,
  );
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (oldState.member?.user?.id === client.user?.id) return;
  const guildId = newState.guild?.id;
  if (!guildId) return;

  const botChannelId = newState.guild.members.me?.voice?.channelId || null;
  if (!botChannelId || newState.channelId !== botChannelId) return;
  if (oldState.channelId === botChannelId) return;

  const DiscordPlayer = require("./utils/DiscordPlayer");
  const info = DiscordPlayer.getQueueInfo(guildId, client);
  if (info?.current?.title) {
    setVoiceChannelStatus(botChannelId, `✨ Playing - ${info.current.title}`);
  }
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

      log.error(`Error executing ${interaction.commandName}:`, error);

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
          log.error("Failed to send error message:", replyError);
        }
      }
    }
  }

  if (interaction.isButton()) {
    await handleButtonInteraction(interaction, client);
  }
});

/**
 * Initializes and starts the primary Remani Discord bot instance.
 * Sets up Lavalink watchdogs and the Music API server.
 * Ensures graceful shutdown on process termination.
 * @returns {Promise<string>} A promise that resolves with the client token when logged in.
 */
function startMainBot() {
  if (!process.env.DISCORD_TOKEN) {
    log.error("DISCORD_TOKEN is not set in .env file!");
    process.exit(1);
  }

  const { initWatchdog } = require("./utils/watchdog");
  const watchdog = initWatchdog(client);

  const apiServer = require("./api")(client);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (idlePresenceInterval) clearInterval(idlePresenceInterval);
    if (statusLogInterval) clearInterval(statusLogInterval);
    try {
      apiServer?.close();
    } catch (error) {
      log.debug("API server close failed:", error?.message || error);
    }
    try {
      client.destroy();
    } catch (error) {
      log.debug("Client destroy failed:", error?.message || error);
    }
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
