require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { btn } = require("./utils/customEmoji");
const { Shoukaku, Connectors } = require("shoukaku");
const fs = require("fs");
const { ensurePlayMusicPanel } = require("./utils/playPanel");

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

const { searchSong, formatDuration } = require("./bot");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const Nodes = [
  {
    name: "Lavalink",
    url: process.env.LAVALINK_URL || "lavalink:2333",
    auth: process.env.LAVALINK_PASSWORD || "youshallnotpass",
  },
];

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);

client.shoukaku.on("error", (_, error) => console.error("Shoukaku Error:", error));
client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink Node ${name} is ready!`));

/**
 * A persistent music queue that remains in the voice channel even when idle.
 * Handles audio playback, queue management, and controller updates.
 */
class PersistentMusicQueue {
  constructor(player, voiceChannel, textChannel) {
    this.player = player;
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    this.songs = [];
    this.playing = false;
    this.paused = false;
    this.volume = 70;
    this.repeatMode = 0;
    this.lastInteraction = null;

    this.player.on("end", (reason) => {
      if (reason.reason === "replaced") return;
      if (this.playing) {
        this.processQueue();
      }
    });

    this.player.on("exception", (error) => {
      console.error("Player exception:", error.exception?.message || "Unknown error");
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
      await this.player.playTrack({ track: { encoded: song.track } });
      await this.player.setGlobalVolume(this.volume);

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
    if (this.repeatMode === 1) {
      this.play();
    } else {
      if (this.repeatMode === 2 && this.songs.length > 0) {
        this.songs.push(this.songs.shift());
      } else {
        this.songs.shift();
      }

      if (this.songs.length === 0) {
        this.playing = false;
        console.log("⚪ Instance idle - staying in VC");
      } else {
        this.play();
      }
    }
  }

  pause() {
    this.player.setPaused(true);
    this.paused = true;
  }

  resume() {
    this.player.setPaused(false);
    this.paused = false;
  }

  skip() {
    this.player.stopTrack();
  }

  stop() {
    this.songs = [];
    this.player.stopTrack();
    this.playing = false;
    this.paused = false;
  }

  shuffle() {
    if (this.songs.length > 1) {
      const current = this.songs.shift();
      for (let i = this.songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
      }
      this.songs.unshift(current);
    }
  }

  setRepeatMode(mode) {
    this.repeatMode = mode;
  }

  setVolume(vol) {
    this.volume = vol;
    this.player.setGlobalVolume(vol);
  }

  remove(index) {
    if (index > 0 && index < this.songs.length) {
      return this.songs.splice(index, 1)[0];
    }
    return null;
  }

  async updateController() {
    if (!this.controllerMessage) return;

    try {
      const song = this.songs[0];
      if (!song) return;

      const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
      const container = new ContainerBuilder().setAccentColor(0x0e0e12);
      
      const loopModes = ["Off", "Song", "Queue"];
      const description = `🎵 **${song.name}**\n\nby **${song.author || "Unknown"}**\n\n🔴 YouTube • ${song.formattedDuration}\n🔊 Volume: ${this.volume}% • 🔁 Loop: ${loopModes[this.repeatMode]}`;
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(description)
      );

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("shuffle")
          .setEmoji(btn("SHUFFLE"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("previous")
          .setEmoji(btn("PREVIOUS"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("pause")
          .setEmoji(this.paused ? btn("PLAY") : btn("PAUSE"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("skip")
          .setEmoji(btn("SKIP"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("stop")
          .setEmoji(btn("STOP"))
          .setStyle(ButtonStyle.Danger),
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("voldown")
          .setEmoji(btn("VOLDOWN"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("volup")
          .setEmoji(btn("VOLUP"))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("loop")
          .setEmoji(btn("LOOP"))
          .setStyle(this.repeatMode > 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("queue")
          .setEmoji(btn("QUEUE"))
          .setStyle(ButtonStyle.Secondary),
      );

      container.addActionRowComponents(row1);
      container.addActionRowComponents(row2);

      await this.controllerMessage.edit({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      console.log("Could not update controller:", error.message);
    }
  }
}

let queue = null;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Instance ready: ${readyClient.user.tag}`);

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
    const player = await client.shoukaku.joinVoiceChannel({
      guildId: guild.id,
      channelId: voiceChannel.id,
      shardId: 0,
      deaf: true,
    });

    console.log(`✅ Permanently joined: ${voiceChannel.name}`);

    queue = new PersistentMusicQueue(player, voiceChannel, textChannel);

    player.on("closed", async () => {
      console.log("⚠️ Disconnected - attempting immediate rejoin...");
      try {
        const newPlayer = await client.shoukaku.joinVoiceChannel({
          guildId: guild.id,
          channelId: voiceChannel.id,
          shardId: 0,
          deaf: true,
        });
        queue.player = newPlayer;
        console.log("✅ Rejoined successfully");
      } catch (error) {
        console.error("❌ Rejoin failed:", error.message);
      }
    });

    const pinned = await ensurePlayMusicPanel(
      textChannel,
      INSTANCE_NAME,
      client.user.id,
    );
    queue.controllerMessage = pinned || null;
    if (pinned) {
      console.log("✅ Posted music controller");
    }
  } catch (error) {
    console.error("❌ Failed to initialize:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!queue) return;

  if (interaction.isButton()) {
    if (interaction.customId === "play_song") {
      const { e } = require("./utils/customEmoji");

      const modal = new ModalBuilder()
        .setCustomId("song_input_modal")
        .setTitle(`🎵 Play Music`);

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

    const member = interaction.member;
    if (!member.voice.channel || member.voice.channel.id !== voiceChannelId) {
      const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
      const { e } = require("./utils/customEmoji");
      const container = new ContainerBuilder().setAccentColor(0xff4444);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} You need to be in the voice channel!`));
      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | 64,
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
        queue.stop();
        break;
      case "voldown":
        queue.setVolume(Math.max(0, queue.volume - 10));
        await queue.updateController();
        break;
      case "volup":
        queue.setVolume(Math.min(100, queue.volume + 10));
        await queue.updateController();
        break;
      case "shuffle":
        queue.shuffle();
        await queue.updateController();
        break;
      case "loop":
        queue.setRepeatMode((queue.repeatMode + 1) % 3);
        await queue.updateController();
        break;
      case "previous":
        const { e } = require("./utils/customEmoji");
        await interaction.followUp({
          ephemeral: true,
          content: `${e("PREVIOUS")} Previous track not available.`,
        });
        break;
      case "queue":
        const { e: e2 } = require("./utils/customEmoji");
        const songs = queue.songs.slice(0, 10);
        const queueList = songs
          .map(
            (song, i) =>
              `${i === 0 ? `**${e2("PLAY")} Now:**` : `**${i}.**`} [${song.name}](${song.url}) - \`${song.formattedDuration}\``,
          )
          .join("\n");
        await interaction.followUp({
          ephemeral: true,
          content: `${e2("QUEUE")} **Queue** (${queue.songs.length} songs)\n\n${queueList}`,
        });
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
      const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
      const { e } = require("./utils/customEmoji");
      const container = new ContainerBuilder().setAccentColor(0xff4444);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} You need to be in the voice channel!`));
      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | 64,
      });
    }

    await interaction.deferReply({ flags: 64 });
    queue.lastInteraction = interaction;

    try {
      const result = await Promise.race([
        searchSong(query, member, client),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 30000),
        ),
      ]);

      if (!result) {
        const { e } = require("./utils/customEmoji");
        return interaction.editReply({ content: `${e("ERROR")} No results found` });
      }

      if (result.type === "playlist") {
        result.songs.forEach((song) => queue.addSong(song));
        const { e } = require("./utils/customEmoji");
        await interaction.editReply({
          content: `${e("SUCCESS")} Added ${result.songs.length} songs`,
        });
      } else {
        queue.addSong(result);
        const { e } = require("./utils/customEmoji");
        await interaction.editReply({ content: `${e("SUCCESS")} Added to queue` });
      }

      if (!queue.playing) {
        queue.play();
      }
    } catch (error) {
      console.error("Search error:", error);
      const { e } = require("./utils/customEmoji");
      await interaction.editReply({
        content: `${e("ERROR")} ${error.message || "Failed"}`,
      });
    }
  }
});

client.login(botToken);

  setTimeout(() => {
    require("./api")(client, apiPort);
  }, 3000);
