require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const { initEmojis } = require("./utils/customEmoji");
const { ensurePlayMusicPanel } = require("./utils/playPanel");
const { createLogger } = require("./utils/logger");
const { swallow } = require("./utils/resilience");
const { musicBotCacheConfig } = require("./utils/clientCache");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const log = createLogger("instance");

const instanceConfig = require("../config.json");

const idlePhrases = [
  "🎧 /play to start",
  "✨ Vibe check: passed",
  "🫧 Breathing between beats",
  "🌙 Lowkey online",
  "💫 Just vibing",
  "📻 Static-free",
  "☕ Coffee break, still tuned in",
  "🛰️ Ready when you are",
];

const pickIdlePhrase = () =>
  idlePhrases[Math.floor(Math.random() * idlePhrases.length)];

const VC_WATCHDOG_INTERVAL_MS = 15_000;
const IDLE_REFRESH_INTERVAL_MS = 120_000;

const setPresenceActivity = (client, trackOrText) => {
  if (!client?.user) return;
  if (trackOrText && trackOrText.name) {
    client.user.setPresence({
      activities: [
        {
          name: (trackOrText.name || "music").slice(0, 128),
          type: ActivityType.Listening,
        },
      ],
      status: "online",
    });
  } else {
    const presenceText =
      typeof trackOrText === "string" ? trackOrText : pickIdlePhrase();
    client.user.setPresence({
      activities: [{ name: presenceText, type: ActivityType.Listening }],
      status: "online",
    });
  }
};

const setVoiceChannelStatus = async (client, channel, status) => {
  if (!channel || !client) return;
  const channelId = typeof channel === "string" ? channel : channel.id;
  try {
    await client.rest.put(`/channels/${channelId}/voice-status`, {
      body: { status: status ? status.slice(0, 500) : "" },
    });
  } catch (err) {
    log.debug("Failed to set voice status:", err?.message || err);
  }
};

process.on("unhandledRejection", (reason) => {
  if (reason && typeof reason === "object") {
    if (reason.code === 10008 || reason.code === 10062) return;
  }
  log.error("Unhandled rejection:", reason);
});

function startInstance(config, instanceIndex) {
  const label = `instance-${instanceIndex + 1}`;

  const {
    handleButtonInteraction,
    searchSong,
    MusicQueue,
    formatDuration,
    youtubedl,
  } = require("./bot");

  if (!config) {
    throw new Error(`Invalid instance index: ${instanceIndex + 1}`);
  }

  const {
    name: INSTANCE_NAME,
    botToken: INSTANCE_BOT_TOKEN,
    guildId: GUILD_ID,
    voiceChannelId: INSTANCE_VOICE_CHANNEL_ID,
    apiPort: INSTANCE_API_PORT,
  } = config;

  if (!INSTANCE_BOT_TOKEN || !GUILD_ID) {
    throw new Error("Missing configuration: botToken or guildId in config.json");
  }

  log.info(`Starting instance: ${INSTANCE_NAME}`);
  log.info(`  Guild: ${GUILD_ID}`);
  log.info(`  Voice Channel: ${INSTANCE_VOICE_CHANNEL_ID}`);
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
  client.queues = new Map();
  client.musicPanels = new Map();
  client.INSTANCE_NAME = INSTANCE_NAME;
  client.INSTANCE_VOICE_CHANNEL_ID = INSTANCE_VOICE_CHANNEL_ID;

  client.getQueue = function (guildId) {
    return this.queues.get(guildId);
  };

  client.createQueue = async function (guildId, textChannel, voiceChannel) {
    const { createAudioPlayer, NoSubscriberBehavior } = require("@discordjs/voice");

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      group: INSTANCE_NAME,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (error) {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
      throw new Error("Failed to connect to voice channel");
    }

    const { MusicQueue: MQ } = require("./bot");
    const queue = new MQ(guildId, textChannel, voiceChannel, connection);
    queue.client = client;
    this.queues.set(guildId, queue);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (queue) queue.stop();
      }
    });

    return queue;
  };

  client.searchSong = searchSong;
  client.formatDuration = formatDuration;

  let vcWatchdogInterval = null;
  let idleRefreshInterval = null;

  client.on("error", (err) => log.error("Client error:", err));

  client.once(Events.ClientReady, async (c) => {
    log.info(`Instance ready as ${c.user.tag} (name: ${INSTANCE_NAME})`);
    await initEmojis(client);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      log.error(`Guild ${GUILD_ID} not found`);
      return;
    }

    const voiceChannel = guild.channels.cache.get(INSTANCE_VOICE_CHANNEL_ID);
    if (!voiceChannel) {
      log.error(`Voice channel ${INSTANCE_VOICE_CHANNEL_ID} not found`);
      return;
    }

    const forceJoinVC = async () => {
      try {
        const existingQueue = client.getQueue(GUILD_ID);
        if (existingQueue) return;

        const { getVoiceConnection } = require("@discordjs/voice");
        const existing = getVoiceConnection(GUILD_ID, INSTANCE_NAME);
        if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) return;

        const { createAudioPlayer, NoSubscriberBehavior } = require("@discordjs/voice");

        const connection = joinVoiceChannel({
          channelId: INSTANCE_VOICE_CHANNEL_ID,
          guildId: GUILD_ID,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
          group: INSTANCE_NAME,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

        const idlePlayer = createAudioPlayer({
          behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
        });
        connection.subscribe(idlePlayer);
      } catch (err) {
        log.debug("Force join VC failed:", err?.message || err);
      }
    };

    await forceJoinVC();
    setPresenceActivity(client, pickIdlePhrase());
    await setVoiceChannelStatus(client, voiceChannel, "🎵 /play to start");

    let lastReconnectAttempt = 0;
    vcWatchdogInterval = setInterval(() => {
      try {
        const now = Date.now();
        if (now - lastReconnectAttempt < 30_000) return;

        const currentGuild = client.guilds.cache.get(GUILD_ID);
        if (!currentGuild) return;
        const me = currentGuild.members.me;
        if (!me || !me.voice || me.voice.channelId !== INSTANCE_VOICE_CHANNEL_ID) {
          lastReconnectAttempt = now;
          log.info(`[Watchdog] ${INSTANCE_NAME} disconnected; reconnecting...`);
          forceJoinVC();
        }
      } catch (error) {
        log.error(`[Watchdog] ${INSTANCE_NAME}:`, error?.message || error);
      }
    }, VC_WATCHDOG_INTERVAL_MS);

    idleRefreshInterval = setInterval(() => {
      const queue = client.getQueue(GUILD_ID);
      if (!queue || !queue.playing) {
        setPresenceActivity(client, pickIdlePhrase());
      }
    }, IDLE_REFRESH_INTERVAL_MS);

    try {
      await ensurePlayMusicPanel(voiceChannel, INSTANCE_NAME, c.user.id);
    } catch (error) {
      log.warn("Could not post play panel:", error?.message || error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.channelId !== INSTANCE_VOICE_CHANNEL_ID) return;

    if (interaction.isButton()) {
      if (interaction.customId === "play_song") {
        const modal = new ModalBuilder()
          .setCustomId("song_input_modal")
          .setTitle("🎵 Play Music");

        const songInput = new TextInputBuilder()
          .setCustomId("song_query")
          .setLabel("Song name, Spotify, or YouTube URL")
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
        return interaction.reply({ ...errorEmbed("You need to be in a voice channel!"), flags: 64 });
      }

      try {
        await interaction.deferReply({ flags: 64 });
      } catch (err) {
        if (err.code !== 10062) {
          log.warn("Failed to defer modal reply:", err?.message || err);
        }
        return;
      }

      const isUrl = /^https?:\/\//.test(query);

      if (isUrl) {
        try {
          log.info(`Modal play URL: "${query}"`);
          const result = await searchSong(query, member);
          if (!result) {
            const { errorEmbed } = require("./utils/embed");
            return interaction.editReply(errorEmbed("No results found."));
          }

          let queue = client.getQueue(interaction.guildId);
          const isNewQueue = !queue;
          if (!queue) {
            queue = await client.createQueue(interaction.guildId, interaction.channel, voiceChannel);
          }

          if (result.type === "playlist") { await queue.addSongs(result.songs); }
          else { await queue.addSong(result); }
          if (isNewQueue) { await queue.play(); }

          await interaction.deleteReply().catch(() => {});
        } catch (error) {
          log.error("Modal play error:", error?.message || error);
          const { errorEmbed } = require("./utils/embed");
          await interaction.editReply(errorEmbed(`${error.message || "Failed to play"}`));
        }
        return;
      }

      try {
        log.info(`Modal search for: "${query}"`);
        const youtube = require("youtube-sr").default;
        const results = await youtube.search(`${query} song`, { limit: 5, type: "video" });

        if (!results || results.length === 0) {
          const { errorEmbed } = require("./utils/embed");
          return interaction.editReply(errorEmbed("No results found."));
        }

        const { e: ei } = require("./utils/customEmoji");
        const {
          ContainerBuilder, TextDisplayBuilder, ActionRowBuilder,
          StringSelectMenuBuilder, SeparatorBuilder, SeparatorSpacingSize,
          MessageFlags,
        } = require("discord.js");

        const fmtDur = (s) => { if (!s) return "0:00"; if (s > 10000) s = Math.floor(s / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

        const container = new ContainerBuilder().setAccentColor(0x00ffff);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`### ${ei("MUSIC")} Results for "${query}"`),
        );

        for (const [i, r] of results.entries()) {
          container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
          );
          const title = r.title.length > 50 ? r.title.slice(0, 50) + "…" : r.title;
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `\`${i + 1}.\` **${title}**\n-# ${r.channel?.name || "Unknown"} · ${fmtDur(r.duration)}`,
            ),
          );
        }

        container.addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        );

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("instance_play_select")
          .setPlaceholder("Select a song to play")
          .addOptions(results.map((r, i) => ({
            label: `${i + 1}. ${r.title}`.slice(0, 100),
            description: `${fmtDur(r.duration)} • ${r.channel?.name || "Unknown"}`.slice(0, 100),
            value: `https://youtube.com/watch?v=${r.id}`,
          })));

        const row = new ActionRowBuilder().addComponents(selectMenu);
        container.addActionRowComponents(row);

        const response = await interaction.editReply({
          content: null,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });

        const collector = response.createMessageComponentCollector({
          filter: (i) => i.user.id === interaction.user.id,
          time: 30000,
        });

        collector.on("collect", async (i) => {
          await i.deferUpdate();
          collector.stop("selected");
          const selectedUrl = i.values[0];
          try {
            const result = await searchSong(selectedUrl, member);
            if (!result) return;

            let queue = client.getQueue(interaction.guildId);
            const isNewQueue = !queue;
            if (!queue) {
              queue = await client.createQueue(interaction.guildId, interaction.channel, voiceChannel);
            }
            await queue.addSong(result);
            if (isNewQueue) await queue.play();

            await interaction.deleteReply().catch(() => {});
          } catch (err) {
            const { errorEmbed } = require("./utils/embed");
            await interaction.editReply(errorEmbed(err.message));
          }
        });

        collector.on("end", (_, reason) => {
          if (reason === "time") {
            const { errorEmbed } = require("./utils/embed");
            interaction.editReply(errorEmbed("Selection timed out.")).catch(() => {});
          }
        });
      } catch (error) {
        log.error("Modal play error:", error?.message || error);
        const { errorEmbed } = require("./utils/embed");
        await interaction.editReply(errorEmbed(`${error.message || "Failed to play"}`));
      }
    }
  });

  let apiServer = null;

  client.login(INSTANCE_BOT_TOKEN).then(() => {
    setTimeout(() => {
      apiServer = require("./api")(client, INSTANCE_API_PORT);
    }, 3000);
  });

  return client;
}

function startInstances({ index } = {}) {
  const instances = instanceConfig.instances || [];

  if (!instances.length) {
    log.warn("No instances configured");
    return [];
  }

  if (typeof index === "number") {
    if (index < 0 || index >= instances.length) {
      throw new Error(
        `Invalid instance index. Use: [0-${instances.length - 1}]`,
      );
    }
    return [startInstance(instances[index], index)];
  }

  return instances.map((instance, i) => startInstance(instance, i));
}

module.exports = { startInstances };
