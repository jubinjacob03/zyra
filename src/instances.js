require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} = require("discord.js");
const { Player } = require("discord-player");
const { initEmojis, e } = require("./utils/customEmoji");
const { ensurePlayMusicPanel } = require("./utils/playPanel");
const { createLogger } = require("./utils/logger");
const { swallow } = require("./utils/resilience");
const { musicBotCacheConfig } = require("./utils/clientCache");

const log = createLogger("instance");

let handleButtonInteraction;
let updateMusicController;
let formatDuration;

require("dns").setDefaultResultOrder("ipv4first");

const instanceConfig = require("../config.json");

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

/** How often the voice-connection watchdog re-checks the instance's channel. */
const VC_WATCHDOG_INTERVAL_MS = 15_000;
/** How often, while idle, the instance refreshes its presence/status. */
const IDLE_REFRESH_INTERVAL_MS = 120_000;
/** Delay before re-joining after an unexpected voice-state change. */
const REJOIN_DELAY_MS = 1_000;

const setPresenceActivity = (client, trackOrText) => {
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

const applyIdleStatus = async (client, channel) => {
  const phrase = pickIdlePhrase();
  setPresenceActivity(client, phrase);
  await setVoiceChannelStatus(client, channel, "🎵 /play to start");
};

const setVoiceChannelStatus = async (client, channel, status) => {
  if (!channel || !client) return;
  try {
    await client.rest.put(`/channels/${channel.id || channel}/voice-status`, {
      body: { status: status ? status.slice(0, 500) : "" },
    });
  } catch (e) {
    log.debug("Failed to set voice status:", e.message);
  }
};

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

  log.info(`Starting instance: ${INSTANCE_NAME}`);
  log.info(`  Guild: ${GUILD_ID}`);
  log.info(
    `  Voice Channel (with built-in chat): ${INSTANCE_VOICE_CHANNEL_ID}`,
  );
  log.info(`  API Port: ${INSTANCE_API_PORT}`);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    ...musicBotCacheConfig(),
  });

  client.commands = new Collection();
  client.musicPanels = new Map();
  client.INSTANCE_NAME = INSTANCE_NAME;
  client.INSTANCE_VOICE_CHANNEL_ID = INSTANCE_VOICE_CHANNEL_ID;

  /** @type {NodeJS.Timeout|null} */
  let vcWatchdogInterval = null;
  /** @type {NodeJS.Timeout|null} */
  let idleRefreshInterval = null;

  const { initWatchdog } = require("./utils/watchdog");
  client.watchdog = initWatchdog(client);

  client.on("error", (err) => log.error("Client error:", err));

  /**
   * Initialize Discord Player with optimized settings for low-memory environments.
   * Keeps the instance aligned with the Lavalink-only music pipeline.
   */
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

  player.events.on("playerStart", async (queue, track) => {
    try {
      const { createCompleteMusicController } = require("./utils/componentsV2");
      const {
        getControllerPanel,
        setControllerPanel,
      } = require("./utils/panelStore");
      const controller = createCompleteMusicController(queue);

      const textChannel =
        queue.metadata?.channel ||
        client.channels.cache.get(INSTANCE_VOICE_CHANNEL_ID);
      if (!textChannel) return;

      let message = null;
      const existingPanel = client.musicPanels.get(queue.guild.id);
      if (existingPanel?.message) {
        message = existingPanel.message;
      }

      if (!message) {
        const storedId = getControllerPanel(textChannel.id);
        if (storedId) {
          try {
            message = await textChannel.messages.fetch(storedId);
          } catch (error) {
            log.debug(
              `Stored panel ${storedId} not fetchable:`,
              error?.message,
            );
          }
        }
      }

      const payload = {
        components: controller.components,
        flags: controller.flags,
      };
      if (message && typeof message.edit === "function") {
        try {
          await message.edit({ embeds: [], ...payload });
        } catch (error) {
          log.debug("Panel edit failed; resending:", error?.message);
          message = await textChannel.send(payload);
        }
      } else {
        message = await textChannel.send(payload);
      }

      if (message?.id && message?.channelId) {
        setControllerPanel(message.channelId, message.id);
      }

      client.musicPanels.set(queue.guild.id, {
        message,
        song: track,
        startTime: Date.now(),
      });
      setPresenceActivity(client, track);
      await setVoiceChannelStatus(
        client,
        queue.channel,
        `✨ Playing - ${track.title}`,
      );
      log.info(`[${INSTANCE_NAME}] Now playing:`, track.title);
    } catch (error) {
      log.error(
        `[${INSTANCE_NAME}] playerStart handler failed:`,
        error?.message || error,
      );
    }
  });

  player.events.on("emptyQueue", async (queue) => {
    if (queue.repeatMode !== 0) return;
    try {
      log.info(`[${INSTANCE_NAME}] Queue finished`);
      const textChannel =
        queue.metadata?.channel ||
        client.channels.cache.get(INSTANCE_VOICE_CHANNEL_ID);
      if (textChannel) {
        const { getControllerPanel } = require("./utils/panelStore");
        const storedId = getControllerPanel(textChannel.id);
        if (storedId) {
          try {
            const message = await textChannel.messages.fetch(storedId);
            if (message && typeof message.edit === "function") {
              const {
                createIdleMusicController,
              } = require("./utils/componentsV2");
              const payload = createIdleMusicController(
                "Queue finished. Add more songs!",
                textChannel.client?.user?.username,
              );
              await swallow(
                message.edit({
                  embeds: [],
                  components: payload.components,
                  flags: payload.flags,
                }),
                "Edit idle panel on empty queue",
              );
            }
          } catch (e) {
            log.debug(`Idle panel update skipped:`, e?.message || e);
          }
        }
      }
      client.musicPanels.delete(queue.guild.id);
      await applyIdleStatus(client, queue.channel);
    } catch (error) {
      log.error(
        `[${INSTANCE_NAME}] emptyQueue handler failed:`,
        error?.message || error,
      );
    }
  });

  player.events.on("error", (queue, error) => {
    log.error(`[${INSTANCE_NAME}] Player error: ${error.message}`);
  });

  player.events.on("playerError", (queue, error) => {
    log.error(
      `[${INSTANCE_NAME}] Player error (connection/playback): ${error.message}`,
    );
  });

  client.updateMusicController = updateMusicController;
  client.formatDuration = formatDuration;

  log.info("Instance configured - no slash commands, message-based control");

  client.updateMusicPresence = (track) => setPresenceActivity(client, track);
  client.updateVoiceStatus = (channelId, status) =>
    setVoiceChannelStatus(client, channelId, status);

  client.once(Events.ClientReady, async (c) => {
    log.info(`Instance ready as ${c.user.tag} (name: ${INSTANCE_NAME})`);
    await initEmojis(client);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      log.error(`Guild ${GUILD_ID} not found`);
      process.exit(1);
    }

    const voiceChannel = guild.channels.cache.get(INSTANCE_VOICE_CHANNEL_ID);
    if (!voiceChannel) {
      log.error(`Voice channel ${INSTANCE_VOICE_CHANNEL_ID} not found`);
      process.exit(1);
    }

    const { getWatchdog } = require("./utils/watchdog");

    /**
     * Forces the bot instance to join its designated voice channel.
     * Uses Shoukaku to establish the connection adapter.
     * @function forceJoinVC
     * @returns {Promise<void>}
     */
    let rejoinInProgress = false;
    const forceJoinVC = async () => {
      if (client.isFallingBack) return;
      if (client.player?.nodes?.has(GUILD_ID)) return;
      if (rejoinInProgress) return;

      rejoinInProgress = true;
      try {
        const watchdog = getWatchdog(client);
        if (watchdog && watchdog.shoukaku && watchdog.isNodeAvailable()) {
          const hasConnection = watchdog.shoukaku.connections.has(GUILD_ID);
          if (!hasConnection) {
            await watchdog.shoukaku.joinVoiceChannel({
              guildId: GUILD_ID,
              channelId: INSTANCE_VOICE_CHANNEL_ID,
              shardId: guild.shardId,
              deaf: true,
            });
          }
        }
      } catch (e) {
        log.error("Failed to force join VC via Shoukaku:", e?.message || e);
      } finally {
        rejoinInProgress = false;
      }
    };

    forceJoinVC();
    await applyIdleStatus(client, voiceChannel);

    vcWatchdogInterval = setInterval(() => {
      try {
        const currentGuild = client.guilds.cache.get(GUILD_ID);
        if (!currentGuild) return;
        const me = currentGuild.members.me;

        if (
          !me ||
          !me.voice ||
          me.voice.channelId !== INSTANCE_VOICE_CHANNEL_ID
        ) {
          log.info(
            `[Watchdog] Instance ${INSTANCE_NAME} disconnected; attempting to reconnect...`,
          );
          forceJoinVC();
        }
      } catch (error) {
        log.error(
          `[Watchdog] Instance ${INSTANCE_NAME}:`,
          error?.message || error,
        );
      }
    }, VC_WATCHDOG_INTERVAL_MS);

    idleRefreshInterval = setInterval(() => {
      const queue = client.player?.nodes?.cache?.get(GUILD_ID);
      const lavalinkQueue =
        require("./utils/DiscordPlayer").lavalinkQueues?.get(
          `${client.user.id}_${GUILD_ID}`,
        );
      if (
        (!queue || !queue.currentTrack) &&
        (!lavalinkQueue || !lavalinkQueue.current)
      ) {
        applyIdleStatus(client, voiceChannel);
      }
    }, IDLE_REFRESH_INTERVAL_MS);

    /**
     * Returns the title of whatever is currently playing in this guild across both
     * playback backends, or null if nothing is playing.
     * @returns {string|null}
     */
    const currentlyPlayingTitle = () => {
      const dp = client.player?.nodes?.cache?.get(GUILD_ID);
      if (dp?.currentTrack) return dp.currentTrack.title;
      const lq = require("./utils/DiscordPlayer").lavalinkQueues?.get(
        `${client.user.id}_${GUILD_ID}`,
      );
      if (lq?.current) return lq.current.info?.title;
      return null;
    };

    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (oldState.member?.user?.id === client.user.id) {
        if (
          !newState.channelId ||
          newState.channelId !== INSTANCE_VOICE_CHANNEL_ID
        ) {
          if (
            client.isFallingBack ||
            client.isRecoveringNode ||
            client.player?.nodes?.has(GUILD_ID)
          )
            return;
          setTimeout(forceJoinVC, REJOIN_DELAY_MS);
        }
        return;
      }

      const joinedBotChannel =
        newState.channelId === INSTANCE_VOICE_CHANNEL_ID &&
        oldState.channelId !== INSTANCE_VOICE_CHANNEL_ID;
      if (joinedBotChannel) {
        const title = currentlyPlayingTitle();
        if (title) {
          setVoiceChannelStatus(
            client,
            INSTANCE_VOICE_CHANNEL_ID,
            `✨ Playing - ${title}`,
          );
        }
      }
    });

    try {
      await ensurePlayMusicPanel(voiceChannel, INSTANCE_NAME, c.user.id);
    } catch (error) {
      log.warn("Could not post play panel:", error.message || error);
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

        const modal = new ModalBuilder()
          .setCustomId("song_input_modal")
          .setTitle(`🎵 Play Music`);

        const songInput = new TextInputBuilder()
          .setCustomId("song_query")
          .setLabel("Song name, Spotify, SoundCloud, or YouTube")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g., sao paulo, https://youtube.com/...")
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(songInput);
        modal.addComponents(row);

        try {
          await interaction.showModal(modal);
        } catch (err) {
          if (err.code !== 10062) {
            log.warn("Failed to open play modal:", err?.message || err);
          }
        }
        return;
      }

      await handleButtonInteraction(interaction, client);
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

      try {
        await interaction.deferReply({ flags: 64 });
      } catch (err) {
        if (err.code !== 10062) {
          log.warn("Failed to defer modal reply:", err?.message || err);
        }
        return;
      }

      try {
        const DiscordPlayer = require("./utils/DiscordPlayer");
        const { errorEmbed, successEmbed } = require("./utils/embed");
        const { searchWithPriority } = require("./utils/musicSearch");
        const { buildSearchResultsUi } = require("./utils/searchUi");
        const { MessageFlags } = require("discord.js");

        const isUrl = (value) => /^https?:\/\//i.test(value);

        if (isUrl(query)) {
          log.info(`Modal direct play for: "${query}"`);
          const { isPlaylist, count } = await DiscordPlayer.play(
            interaction,
            query,
            voiceChannel,
            client,
          );

          if (isPlaylist) {
            await interaction.editReply(successEmbed(`Added ${count} songs`));
          } else {
            await interaction.editReply(successEmbed("Added to queue"));
          }
          return;
        }

        log.info(`Modal search for: "${query}"`);
        const results = await searchWithPriority(
          query,
          interaction.user,
          client,
          5,
        );

        if (!results.length) {
          await interaction.editReply(
            errorEmbed("No results found. Try a direct YouTube URL."),
          );
          return;
        }

        const container = buildSearchResultsUi(
          results,
          "instance_search_select",
          query,
        );

        const response = await interaction.editReply({
          content: null,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });

        const collector = response.createMessageComponentCollector({
          filter: (i) => i.user.id === interaction.user.id,
          time: 60000,
        });

        collector.on("collect", async (i) => {
          await i.deferUpdate();
          collector.stop("selected");

          try {
            const selectedUrl = i.values[0];
            const { isPlaylist, count } = await DiscordPlayer.play(
              interaction,
              selectedUrl,
              voiceChannel,
              client,
            );

            if (isPlaylist) {
              await interaction.editReply(successEmbed(`Added ${count} songs`));
            } else {
              await interaction.editReply(successEmbed("Added to queue"));
            }
          } catch (error) {
            await interaction.editReply(
              errorEmbed(`Failed to play: ${error.message}`),
            );
          }
        });

        collector.on("end", async (_, reason) => {
          if (reason === "time") {
            await interaction.editReply({ components: [] }).catch(() => {});
          }
        });
      } catch (error) {
        log.warn("Failed to handle modal submit:", error?.message || error);
        const { errorEmbed } = require("./utils/embed");
        const payload = errorEmbed(
          error?.message || "Could not play the song.",
        );
        payload.flags = payload.flags | 64;
        try {
          await interaction.editReply(payload);
        } catch {
          await interaction.followUp(payload).catch(() => {});
        }
      }
    }
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (vcWatchdogInterval) clearInterval(vcWatchdogInterval);
    if (idleRefreshInterval) clearInterval(idleRefreshInterval);
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

  client.login(INSTANCE_BOT_TOKEN).then(() => {});

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
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (vcWatchdogInterval) clearInterval(vcWatchdogInterval);
    if (idleRefreshInterval) clearInterval(idleRefreshInterval);
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

  client.login(INSTANCE_BOT_TOKEN).then(() => {});

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
    log.warn("No instances configured");
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
      log.error(
        `Invalid instance index. Use: node instances.js [1-${instanceConfig.instances.length}]`,
      );
      process.exit(1);
    }
    index = parsed - 1;
  }

  try {
    startInstances({ index });
  } catch (error) {
    log.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  startInstances,
};
