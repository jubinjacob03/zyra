require("dotenv").config();
const { Client, GatewayIntentBits, Collection, Events } = require("discord.js");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const fs = require("fs");
const path = require("path");
const os = require("os");
const youtubedlExec = require("youtube-dl-exec");
const { initEmojis } = require("./utils/customEmoji");
const SpotifyAPI = require("./utils/spotify");

const {
  MusicQueue,
  searchSong,
  handleButtonInteraction,
  updateMusicController,
  processSpotifyPlaylistBackground,
  formatDuration,
} = require("./index");

const instanceConfig = require("../config.json");

const instanceIndex = parseInt(process.argv[2] || "1") - 1;
if (instanceIndex < 0 || instanceIndex >= instanceConfig.instances.length) {
  console.error(
    `❌ Invalid instance index. Use: node instances.js [1-${instanceConfig.instances.length}]`,
  );
  process.exit(1);
}

const config = instanceConfig.instances[instanceIndex];
const INSTANCE_NAME = config.name;
const INSTANCE_BOT_TOKEN = config.botToken;
const GUILD_ID = config.guildId;
const INSTANCE_VOICE_CHANNEL_ID = config.voiceChannelId;
const INSTANCE_API_PORT = config.apiPort;

if (!INSTANCE_BOT_TOKEN || !GUILD_ID) {
  console.error("❌ Missing configuration: botToken or guildId in config.json");
  process.exit(1);
}

console.log(`🎵 Starting instance: ${INSTANCE_NAME}`);
console.log(`   Guild: ${GUILD_ID}`);
console.log(
  `   Voice Channel (with built-in chat): ${INSTANCE_VOICE_CHANNEL_ID}`,
);
console.log(`   API Port: ${INSTANCE_API_PORT}`);

let youtubedl;
if (os.platform() === "win32") {
  const systemYtdlp = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages",
    "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "yt-dlp.exe",
  );
  if (fs.existsSync(systemYtdlp)) {
    youtubedl = youtubedlExec.create(systemYtdlp);
    console.log("✅ Using system yt-dlp (Windows)");
  } else {
    youtubedl = youtubedlExec;
    console.log("⚠️ Using bundled yt-dlp");
  }
} else {
  const systemYtdlp = "/root/.nix-profile/bin/yt-dlp";
  if (fs.existsSync(systemYtdlp)) {
    youtubedl = youtubedlExec.create(systemYtdlp);
    console.log("✅ Using system yt-dlp (Nix)");
  } else {
    youtubedl = youtubedlExec;
    console.log("✅ Using bundled yt-dlp (Linux/Mac)");
  }
}

const ffmpegPath = require("ffmpeg-static");
process.env.FFMPEG_PATH = ffmpegPath;

process.on("unhandledRejection", (reason) => {
  if (reason && typeof reason === "object") {
    if (reason.command && reason.command.includes("yt-dlp")) return;
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.queues = new Map();
client.musicPanels = new Map();
client.youtubedl = youtubedl;
client.INSTANCE_NAME = INSTANCE_NAME;
client.INSTANCE_VOICE_CHANNEL_ID = INSTANCE_VOICE_CHANNEL_ID;

client.MusicQueue = MusicQueue;
client.searchSong = searchSong;
client.updateMusicController = updateMusicController;
client.processSpotifyPlaylistBackground = processSpotifyPlaylistBackground;
client.formatDuration = formatDuration;

client.getQueue = function (guildId) {
  return this.queues.get(guildId);
};

client.createQueue = async function (guildId, textChannel, voiceChannel) {
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

  const queue = new MusicQueue(
    guildId,
    textChannel,
    voiceChannel,
    connection,
    true,
  );
  this.queues.set(guildId, queue);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.log("⚠️ Instance disconnected - attempting rejoin...");
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log("✅ Instance reconnected successfully");
    } catch {
      console.log("⚠️ Rejoin attempt failed - will retry on next disconnect");
      setTimeout(async () => {
        try {
          const newConnection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          });
          await entersState(newConnection, VoiceConnectionStatus.Ready, 10_000);
          queue.connection = newConnection;
          newConnection.subscribe(queue.player);
          console.log("✅ Force rejoin successful");
        } catch (error) {
          console.error("❌ Force rejoin failed:", error.message);
        }
      }, 3000);
    }
  });

  return queue;
};

let spotifyAPI = null;
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
  spotifyAPI = new SpotifyAPI(
    process.env.SPOTIFY_CLIENT_ID,
    process.env.SPOTIFY_CLIENT_SECRET,
  );
  client.spotifyAPI = spotifyAPI;
  console.log("✅ Spotify API initialized");
} else {
  console.log("⚠️ Spotify credentials not found");
}

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

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    console.log(`✅ Auto-joined voice channel: ${voiceChannel.name}`);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log("⚠️ Auto-join disconnect detected - attempting rejoin...");
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 5000);
        console.log("✅ Auto-join reconnected");
      } catch {
        console.log(
          "⚠️ Auto-join rejoin failed - trying force rejoin after delay",
        );
        setTimeout(async () => {
          try {
            const newConnection = joinVoiceChannel({
              channelId: voiceChannel.id,
              guildId: guild.id,
              adapterCreator: guild.voiceAdapterCreator,
            });
            await entersState(
              newConnection,
              VoiceConnectionStatus.Ready,
              10_000,
            );
            console.log("✅ Force rejoin successful for auto-join");
          } catch (error) {
            console.error("❌ Force rejoin failed:", error.message);
          }
        }, 3000);
      }
    });

    const {
      EmbedBuilder,
      ButtonBuilder,
      ButtonStyle,
      ActionRowBuilder,
    } = require("discord.js");
    const { e } = require("./utils/customEmoji");

    const helpEmbed = new EmbedBuilder()
      .setColor(0x00ffff)
      .setTitle(`${e("music_note")} NexKord - Music Player`)
      .setDescription(
        `Click the button below to play music in this VC!\n\n` +
          `**Query Supports:**\n` +
          `• Song names\n` +
          `• YouTube links\n` +
          `• Spotify links (tracks & playlists)`,
      );

    const playButton = new ButtonBuilder()
      .setCustomId("play_song")
      .setLabel("🎵 Play Music")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(playButton);

    const pinned = await voiceChannel.send({
      embeds: [helpEmbed],
      components: [row],
    });
    await pinned.pin().catch(() => console.log("Could not pin message"));
  } catch (error) {
    console.error("❌ Failed to join VC:", error);
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
        .setTitle("🎵 Play Music");

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
      return interaction.reply({
        content: "❌ You need to be in a voice channel!",
        flags: 64,
      });
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
        return interaction.editReply({
          content: "❌ No results found for your query.",
        });
      }

      let queue = client.getQueue(interaction.guildId);
      const isNewQueue = !queue;

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
        await interaction.editReply({
          content: `✅ Added ${result.tracks.length} songs`,
        });

        if (result.backgroundProcessing) {
          client
            .processSpotifyPlaylistBackground(result.tracks, queue)
            .catch(console.error);
        }
      } else {
        queue.addSong(result);
        await interaction.editReply({ content: "✅ Added to queue" });
      }

      if (!queue.playing) {
        queue.play();
      }
    } catch (error) {
      console.error("Modal play error:", error);
      await interaction.editReply({
        content: `❌ ${error.message || "Failed to play"}`,
      });
    }
  }
});

client.login(INSTANCE_BOT_TOKEN);

setTimeout(() => {
  require("./api")(client, INSTANCE_API_PORT);
}, 3000);
