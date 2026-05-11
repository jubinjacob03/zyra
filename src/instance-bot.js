require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
} = require("@discordjs/voice");
const fs = require("fs");
const { youtubedl } = require("./utils/media");

// Load instance configuration
const instanceIndex = parseInt(process.argv[2]) - 1;
const instanceConfig = require("../config.json");
const config = instanceConfig.instances[instanceIndex];

if (!config) {
  console.error(`❌ Invalid instance index: ${process.argv[2]}`);
  process.exit(1);
}

const {
  name: INSTANCE_NAME,
  botToken,
  guildId,
  voiceChannelId,
  apiPort,
} = config;

console.log(`🎵 Starting persistent music instance: ${INSTANCE_NAME}`);
console.log(`   Guild: ${guildId}`);
console.log(`   Voice Channel: ${voiceChannelId}`);
console.log(`   API Port: ${apiPort}`);

// Import search function from master
const { searchSong, formatDuration } = require("./index");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// Simple persistent queue that NEVER leaves VC
class PersistentMusicQueue {
  constructor(connection, voiceChannel, textChannel) {
    this.connection = connection;
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    this.songs = [];
    this.playing = false;
    this.paused = false;
    this.volume = 70;
    this.lastInteraction = null;

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: Math.round(10000 / 20),
      },
    });

    this.connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.playing) {
        this.processQueue();
      }
    });

    this.player.on("error", (error) => {
      console.error("Player error:", error.message);
      this.processQueue();
    });
  }

  addSong(song) {
    this.songs.push(song);
  }

  async play() {
    if (this.songs.length === 0) {
      this.playing = false;
      console.log("⚪ Queue empty - instance idle");
      return;
    }

    const song = this.songs[0];
    this.playing = true;
    this.paused = false;

    try {
      const ytdlpOpts = {
        output: "-",
        quiet: true,
        noWarnings: true,
        format: "bestaudio/best",
        noPlaylist: true,
        geoBypass: true,
        noCheckCertificates: true,
        addHeader: [
          "referer:youtube.com",
          "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ],
        extractorArgs: "youtube:player_client=android",
        ...(fs.existsSync("./cookies.txt") && { cookies: "./cookies.txt" }),
      };

      const ytdlpProcess = youtubedl.exec(song.url, ytdlpOpts);
      ytdlpProcess.stderr?.on("data", () => {});

      const resource = createAudioResource(ytdlpProcess.stdout, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
        highWaterMark: 1 << 25,
      });

      resource.volume.setVolume(this.volume / 100);
      this.player.play(resource);

      console.log(`🎵 Now playing: ${song.name}`);

      // Update controller
      await this.updateController();
    } catch (error) {
      console.error(`❌ Playback error: ${error.message}`);
      this.songs.shift();
      this.processQueue();
    }
  }

  processQueue() {
    this.songs.shift();

    if (this.songs.length === 0) {
      this.playing = false;
      console.log("⚪ Instance idle - staying in VC");
    } else {
      this.play();
    }
  }

  pause() {
    this.player.pause();
    this.paused = true;
  }

  resume() {
    this.player.unpause();
    this.paused = false;
  }

  skip() {
    this.player.stop();
  }

  async updateController() {
    if (!this.controllerMessage) return;

    try {
      const song = this.songs[0];
      if (!song) return;

      const embed = new EmbedBuilder()
        .setColor(0x0e0e12)
        .setDescription(
          `🎵 **${song.name}**\n\n` +
            `by **${song.author || "Unknown"}**\n\n` +
            `🔴 YouTube • ${song.formattedDuration}`,
        )
        .setThumbnail(song.thumbnail);

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("shuffle")
          .setLabel("Shuffle")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("previous")
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("pause")
          .setLabel(this.paused ? "Play" : "Pause")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("skip")
          .setLabel("Skip")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("stop")
          .setLabel("Stop")
          .setStyle(ButtonStyle.Danger),
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("voldown")
          .setLabel("Vol −")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("volup")
          .setLabel("Vol +")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("loop")
          .setLabel("Loop")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("queue")
          .setLabel("Queue")
          .setStyle(ButtonStyle.Secondary),
      );

      await this.controllerMessage.edit({
        embeds: [embed],
        components: [row1, row2],
      });
    } catch (error) {
      console.log("Could not update controller:", error.message);
    }
  }
}

let queue = null;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Instance ready: ${readyClient.user.tag}`);

  // Auto-join voice channel
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    console.error("❌ Guild not found");
    return;
  }

  const voiceChannel = guild.channels.cache.get(voiceChannelId);
  if (!voiceChannel) {
    console.error("❌ Voice channel not found");
    return;
  }

  const textChannel = voiceChannel;

  try {
    // Join and NEVER leave
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log(`✅ Permanently joined: ${voiceChannel.name}`);

    // Create persistent queue
    queue = new PersistentMusicQueue(connection, voiceChannel, textChannel);

    // Handle disconnects - auto-rejoin immediately
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log("⚠️ Disconnected - attempting immediate rejoin...");
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        // Force rejoin
        try {
          const newConnection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
          });

          await entersState(newConnection, VoiceConnectionStatus.Ready, 10_000);
          queue.connection = newConnection;
          newConnection.subscribe(queue.player);
          console.log("✅ Rejoined successfully");
        } catch (error) {
          console.error("❌ Rejoin failed:", error.message);
        }
      }
    });

    // Post pinned embed
    const helpEmbed = new EmbedBuilder()
      .setColor(0x0e0e12)
      .setTitle(`${INSTANCE_NAME} - Music Player`)
      .setDescription(
        `Click the button below to play music in this VC!\n\n` +
          `**Supports:**\n` +
          `• Song names (e.g., \`powerhouse\`)\n` +
          `• YouTube links\n` +
          `• Spotify links (tracks & playlists)`,
      );

    const playButton = new ButtonBuilder()
      .setCustomId("play_song")
      .setLabel("🎵 Play Music")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(playButton);

    const pinned = await textChannel.send({
      embeds: [helpEmbed],
      components: [row],
    });

    queue.controllerMessage = pinned;

    await pinned.pin().catch(() => console.log("Could not pin message"));
    console.log("✅ Posted music controller");
  } catch (error) {
    console.error("❌ Failed to initialize:", error);
  }
});

// Handle button interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!queue) return;

  if (interaction.isButton()) {
    if (interaction.customId === "play_song") {
      const modal = new ModalBuilder()
        .setCustomId("song_input_modal")
        .setTitle("🎵 Play Music");

      const songInput = new TextInputBuilder()
        .setCustomId("song_query")
        .setLabel("Song name, YouTube or Spotify link")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g., powerhouse, https://youtu.be/...")
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(songInput);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    // Handle music control buttons
    const member = interaction.member;
    if (!member.voice.channel || member.voice.channel.id !== voiceChannelId) {
      return interaction.reply({
        content: "❌ You need to be in the voice channel!",
        flags: 64,
      });
    }

    await interaction.deferUpdate();

    switch (interaction.customId) {
      case "pause":
        if (queue.paused) {
          queue.resume();
        } else {
          queue.pause();
        }
        await queue.updateController();
        break;
      case "skip":
        queue.skip();
        break;
      case "stop":
        queue.songs = [];
        queue.player.stop();
        queue.playing = false;
        break;
      case "voldown":
        queue.volume = Math.max(0, queue.volume - 10);
        break;
      case "volup":
        queue.volume = Math.min(100, queue.volume + 10);
        break;
    }
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId === "song_input_modal"
  ) {
    const query = interaction.fields.getTextInputValue("song_query");
    const member = interaction.member;

    if (!member.voice.channel || member.voice.channel.id !== voiceChannelId) {
      return interaction.reply({
        content: "❌ You need to be in the voice channel!",
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 });
    queue.lastInteraction = interaction;

    try {
      const result = await Promise.race([
        searchSong(query, member),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 30000),
        ),
      ]);

      if (!result) {
        return interaction.editReply({ content: "❌ No results found" });
      }

      if (result.type === "playlist") {
        result.songs.forEach((song) => queue.addSong(song));
        await interaction.editReply({
          content: `✅ Added ${result.songs.length} songs`,
        });
      } else {
        queue.addSong(result);
        await interaction.editReply({ content: "✅ Added to queue" });
      }

      if (!queue.playing) {
        queue.play();
      }
    } catch (error) {
      console.error("Search error:", error);
      await interaction.editReply({
        content: `❌ ${error.message || "Failed"}`,
      });
    }
  }
});

client.login(botToken);

// API server on instance-specific port
setTimeout(() => {
  require("./api")(client, apiPort);
}, 3000);
