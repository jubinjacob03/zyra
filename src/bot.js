require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
} = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");
const fs = require("fs");
const path = require("path");
const { formatDuration } = require("./utils/embed");
const { initEmojis, e } = require("./utils/customEmoji");
const SpotifyAPI = require("./utils/spotify");
const { initRuntimeLogger } = require("./utils/runtimeLogger");
const { getControllerPanel, setControllerPanel } = require("./utils/panelStore");

initRuntimeLogger({ label: process.env.RUNTIME_LOGGER_LABEL || "main" });

process.on("unhandledRejection", (reason) => {
  if (reason && typeof reason === "object") {
    if (reason.message && reason.message.includes("Cannot perform IP discovery - socket closed")) {
      return;
    }
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
client.queues = new Map();
client.musicPanels = new Map();

const Nodes = [
  {
    name: "Lavalink",
    url: (process.env.LAVALINK_URL || "lavalink:2333").replace(/^https?:\/\//, ''),
    auth: process.env.LAVALINK_PASSWORD || "youshallnotpass",
  },
];

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);

client.shoukaku.on("error", (_, error) => console.error("Shoukaku Error:", error));
client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink Node ${name} is ready!`));

let spotifyAPI = null;
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
  spotifyAPI = new SpotifyAPI(
    process.env.SPOTIFY_CLIENT_ID,
    process.env.SPOTIFY_CLIENT_SECRET,
  );
  console.log("✅ Spotify API initialized");
} else {
  console.log("⚠️ Spotify credentials not found - Spotify features disabled");
}

/**
 * Checks if a message is editable by the client.
 * @param {import('discord.js').Message} message - The message to check.
 * @param {string} clientUserId - The client's user ID.
 * @returns {boolean} True if the message is editable by the client.
 */
const isEditableByClient = (message, clientUserId) => {
  if (!message) return false;
  if (typeof message.editable === "boolean") return message.editable;
  if (!clientUserId) return true;
  return message.author?.id === clientUserId;
};

/**
 * Finds an existing music panel message in the given channel.
 * @param {import('discord.js').TextChannel} channel - The channel to search in.
 * @param {string} clientUserId - The client's user ID.
 * @returns {Promise<import('discord.js').Message|null>} The existing music panel message, or null if not found.
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
 * @param {string} channelId - The ID of the channel containing the panel.
 * @returns {Promise<import('discord.js').Message|null>} The resolved message, or null if not found or inaccessible.
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

/**
 * Music Queue Manager
 * Handles voice connection, audio playback, queue management, and player state.
 */
class MusicQueue {
  constructor(
    client,
    guildId,
    textChannel,
    voiceChannel,
    player,
    persistent = false,
  ) {
    this.client = client;
    this.guildId = guildId;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.player = player;
    this.songs = [];
    this.volume = 50;
    this.playing = false;
    this.paused = false;
    this.repeatMode = 0;
    this.persistent = persistent;
    this.lastInteraction = null;

    this.setupPlayerEvents();
  }

  /**
   * Send message - uses ephemeral followUp for persistent queues, regular send otherwise.
   * @param {string} content - The message content to send.
   */
  async sendMessage(content) {
    if (this.persistent) {
      if (this.lastInteraction) {
        try {
          await this.lastInteraction.followUp({ content, flags: 64 });
        } catch (error) {
          console.log("ℹ️ Message suppressed (interaction expired):", content);
        }
      } else {
        console.log("ℹ️ Message suppressed (no interaction):", content);
      }
    } else {
      const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
      const container = new ContainerBuilder().setAccentColor(0x00ffff);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
      await this.textChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
    }
  }

  /**
   * Setup audio player event listeners.
   * Handles song transitions and playback errors.
   */
  setupPlayerEvents() {
    this.player.on("end", (reason) => {
      if (reason.reason === "replaced") return;
      this.processQueue();
    });

    this.player.on("exception", (error) => {
      console.error("Player exception:", error);
      this.sendMessage(`${e("ERROR")} Player error: ${error.exception?.message || "Unknown error"}`);
      this.processQueue();
    });
  }

  /**
   * Add a single song to the queue
   * @param {Object} song - Song object with metadata
   * @param {number} position - Insert position (-1 for end of queue)
   */
  async addSong(song, position = -1) {
    if (position === -1 || position >= this.songs.length) {
      this.songs.push(song);
    } else {
      this.songs.splice(position, 0, song);
    }
  }

  /**
   * Add multiple songs to the queue (for playlists)
   * @param {Array} songs - Array of song objects
   */
  async addSongs(songs) {
    this.songs.push(...songs);
  }

  /**
   * Play the current song in the queue.
   */
  async play() {
    if (this.songs.length === 0) {
      this.stop();
      return;
    }

    const song = this.songs[0];
    this.playing = true;
    this.paused = false;

    try {
      await this.player.playTrack({ track: { encoded: song.track } });
      await this.player.setGlobalVolume(this.volume);

      const { createCompleteMusicController } = require("./utils/componentsV2");
      const controller = createCompleteMusicController(this);

      const existingPanel = this.client.musicPanels.get(this.guildId);
      let message = existingPanel?.message || null;
      const panelChannelId = this.textChannel?.id || null;

      if (message) {
        try {
          await message.edit(controller);
        } catch {
          message = null;
        }
      }

      if (!message) {
        const stored = await resolveStoredMusicPanel(
          this.client,
          panelChannelId,
        );
        if (stored) {
          try {
            await stored.edit(controller);
            message = stored;
          } catch {
            message = null;
          }
        }
      }

      if (!message) {
        const reused = await findExistingMusicPanel(
          this.textChannel,
          this.client.user?.id,
        );
        if (reused) {
          try {
            await reused.edit(controller);
            message = reused;
          } catch {
            message = null;
          }
        }
      }

      if (!message) {
        message = await this.textChannel.send({ components: controller.components, flags: controller.flags });
      }

      if (message?.id && message?.channelId) {
        setControllerPanel(message.channelId, message.id);
      }

      this.client.musicPanels.set(this.guildId, {
        message,
        song,
        startTime: Date.now(),
      });
      console.log("🎵 Now playing:", song.name);

      this.startProgressUpdates();
    } catch (error) {
      console.error(`❌ Playback error: ${error.message}`);
      this.sendMessage(
        `${e("ERROR")} Error playing **${song.name}**: ${error.message}`,
      );
      this.songs.shift();
      this.processQueue();
    }
  }

  /**
   * Process queue after song completion.
   * Handles repeat modes and queue progression.
   */
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
        console.log("🎵 Queue finished");

        if (!this.persistent) {
          this.playing = false;
          this.stopProgressUpdates();
          const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
          const container = new ContainerBuilder().setAccentColor(0x00ffff);
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("MUSIC")} Queue finished. Add more songs to keep the party going!`));
          this.textChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
          this.stop();
        } else {
          this.playing = false;
          this.stopProgressUpdates();
          console.log("⚪ Instance idle - waiting for new songs");
        }
      } else {
        this.play();
      }
    }
  }

  /**
   * Pause audio playback.
   */
  pause() {
    this.player.setPaused(true);
    this.paused = true;
  }

  /**
   * Resume audio playback.
   */
  resume() {
    this.player.setPaused(false);
    this.paused = false;
  }

  /**
   * Skip current song.
   */
  skip() {
    this.player.stopTrack();
  }

  /**
   * Stop playback and clean up resources.
   * Safely destroys voice connection and clears queue.
   */
  stop() {
    this.songs = [];
    this.playing = false;
    this.paused = false;
    this.player.stopTrack();

    this.stopProgressUpdates();

    if (this.persistent) {
      return;
    }

    try {
      this.client.shoukaku.leaveVoiceChannel(this.guildId);
    } catch (error) {
      console.error("Error destroying connection:", error);
    }

    this.client.queues.delete(this.guildId);
    this.client.musicPanels.delete(this.guildId);
  }

  /**
   * Shuffle queue using Fisher-Yates algorithm.
   * Keeps current song at position 0.
   */
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

  /**
   * Set playback volume.
   * @param {number} vol - Volume level (0-100).
   */
  setVolume(vol) {
    this.volume = vol;
    this.player.setGlobalVolume(vol);
  }

  /**
   * Set repeat mode.
   * @param {number} mode - 0: Off, 1: Single, 2: Queue.
   */
  setRepeatMode(mode) {
    this.repeatMode = mode;
    this.updateMusicPanel();
  }

  /**
   * Start real-time progress updates for the music panel.
   */
  startProgressUpdates() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }

    const panelData = this.client.musicPanels.get(this.guildId);
    if (!panelData) return;

    this.progressInterval = setInterval(async () => {
      if (!this.playing || this.paused || !this.songs[0]) {
        clearInterval(this.progressInterval);
        this.progressInterval = null;
        return;
      }

      try {
        await this.updateMusicPanel();
      } catch (error) {
        console.error("Error in progress update:", error.message);

        clearInterval(this.progressInterval);
        this.progressInterval = null;
      }
    }, 5000);
  }

  /**
   * Update the music panel embed with current progress.
   */
  async updateMusicPanel() {
    const panelData = this.client.musicPanels.get(this.guildId);
    if (!panelData?.message || !this.songs[0]) return;

    try {
      await panelData.message.fetch();

      const { createCompleteMusicController } = require("./utils/componentsV2");
      const controller = createCompleteMusicController(this);

      if (!controller) return;

      await panelData.message.edit(controller);
    } catch (error) {
      if (error.code === 10008) {
        console.log("Music panel message was deleted - cleaning up");
        this.client.musicPanels.delete(this.guildId);
        const channelId = panelData?.message?.channelId || this.textChannel?.id;
        if (channelId) setControllerPanel(channelId, null);
        this.stopProgressUpdates();
      } else if (error.code === 10003) {
        console.log("Music panel channel not found - cleaning up");
        this.client.musicPanels.delete(this.guildId);
        const channelId = panelData?.message?.channelId || this.textChannel?.id;
        if (channelId) setControllerPanel(channelId, null);
        this.stopProgressUpdates();
      } else {
        console.error("Error updating music panel:", error.message);
      }
    }
  }

  /**
   * Stop progress updates and clean up.
   */
  stopProgressUpdates() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * Remove song from queue by index.
   * @param {number} index - Song position in queue.
   * @returns {Object|null} Removed song or null.
   */
  remove(index) {
    if (index > 0 && index < this.songs.length) {
      return this.songs.splice(index, 1)[0];
    }
    return null;
  }

  /**
   * Get current playing song.
   * @returns {Object|null} Current song or null.
   */
  get currentSong() {
    return this.songs[0] || null;
  }

  /**
   * Get formatted total queue duration.
   * @returns {string} Formatted duration (HH:MM:SS or MM:SS).
   */
  get formattedDuration() {
    const total = this.songs.reduce((acc, s) => acc + (s.duration || 0), 0);
    return formatDuration(total);
  }
}

/**
 * Create and initialize a music queue for a guild.
 * @param {string} guildId - Discord guild ID.
 * @param {object} textChannel - Text channel for bot messages.
 * @param {object} voiceChannel - Voice channel to join.
 * @param {boolean} persistent - Whether the queue is persistent.
 * @returns {Promise<MusicQueue>} Initialized music queue.
 * @throws {Error} If connection fails or times out.
 */
client.createQueue = async function (
  guildId,
  textChannel,
  voiceChannel,
  persistent = false,
) {
  let player;
  try {
    player = await this.shoukaku.joinVoiceChannel({
      guildId: guildId,
      channelId: voiceChannel.id,
      shardId: voiceChannel.guild.shardId || 0,
      deaf: true,
    });
  } catch (error) {
    console.error("Voice connection failed:", error);
    throw new Error("Failed to connect to voice channel");
  }

  const queue = new MusicQueue(
    this,
    guildId,
    textChannel,
    voiceChannel,
    player,
    persistent,
  );
  this.queues.set(guildId, queue);

  player.on("closed", async () => {
    if (queue && !queue.persistent) {
      queue.stop();
    } else if (queue && queue.persistent) {
      console.log("⚠️ Persistent instance disconnected - attempting reconnect...");
      try {
        const newPlayer = await this.shoukaku.joinVoiceChannel({
          guildId: guildId,
          channelId: voiceChannel.id,
          shardId: voiceChannel.guild.shardId || 0,
          deaf: true,
        });
        queue.player = newPlayer;
        queue.setupPlayerEvents();
        console.log("✅ Persistent instance reconnected successfully");
      } catch (reconnectError) {
        console.error("❌ Failed to reconnect persistent instance:", reconnectError.message);
      }
    }
  });

  return queue;
};

/**
 * Get existing music queue for a guild.
 * @param {string} guildId - Discord guild ID.
 * @returns {MusicQueue|undefined} Music queue or undefined.
 */
client.getQueue = function (guildId) {
  return this.queues.get(guildId);
};

/**
 * Enhanced search function with Spotify support and timeout handling.
 * Handles YouTube URLs, Spotify URLs, and search queries.
 * @param {string} query - YouTube URL, Spotify URL, or search term.
 * @param {import('discord.js').GuildMember} user - User who requested the song.
 * @param {import('discord.js').Client} searchClient - The Discord client to use for searching.
 * @returns {Promise<Object|null>} Song/playlist object or null.
 */
async function searchSong(query, user, searchClient = client) {
  return Promise.race([
    searchSongInternal(query, user, searchClient),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Search timeout - please try again or use a direct YouTube link",
            ),
          ),
        60000,
      ),
    ),
  ]);
}

/**
 * Internal implementation of the search function.
 * @param {string} query - The search query.
 * @param {import('discord.js').GuildMember} user - The user who requested the song.
 * @param {import('discord.js').Client} searchClient - The Discord client.
 * @returns {Promise<Object>} The resolved song or playlist.
 */
async function searchSongInternal(query, user, searchClient) {
  const node = searchClient.shoukaku.getIdealNode();
  if (!node) throw new Error("Lavalink node is not ready");

  const spotifyTrackPattern = /spotify\.com\/track\/([a-zA-Z0-9]+)/;
  const spotifyPlaylistPattern = /spotify\.com\/playlist\/([a-zA-Z0-9]+)/;
  const spotifyAlbumPattern = /spotify\.com\/album\/([a-zA-Z0-9]+)/;

  if (spotifyTrackPattern.test(query) && spotifyAPI) {
    try {
      const trackId = SpotifyAPI.extractSpotifyId(query, "track");
      const spotifyTrack = await spotifyAPI.getTrack(trackId);
      const fallbackQuery = `ytsearch:${spotifyTrack.name} ${spotifyTrack.artists[0]?.name}`;
      
      const result = await node.rest.resolve(fallbackQuery);
      if (!result || result.loadType === "empty" || result.loadType === "error") {
        throw new Error("Could not find a matching YouTube video for this Spotify track");
      }

      const t = result.data[0];
      return {
        type: "song",
        name: spotifyTrack.name,
        url: t.info.uri,
        duration: Math.round(t.info.length / 1000),
        formattedDuration: formatDuration(Math.round(t.info.length / 1000)),
        thumbnail: spotifyTrack.album?.images?.[0]?.url || t.info.artworkUrl,
        author: spotifyTrack.artists.map((a) => a.name).join(", "),
        user: user,
        track: t.encoded,
        spotifyData: {
          originalUrl: query,
          trackId: trackId,
          isSpotify: true,
        },
      };
    } catch (error) {
      throw new Error(`Unable to find this Spotify track. Try a different song or search manually.`);
    }
  }

  if (spotifyPlaylistPattern.test(query) && spotifyAPI) {
    try {
      const playlistId = SpotifyAPI.extractSpotifyId(query, "playlist");
      const { tracks, playlistInfo } = await spotifyAPI.getPlaylistTracks(playlistId);

      if (!tracks || tracks.length === 0) {
        throw new Error("Spotify playlist is empty or contains no playable tracks");
      }

      const immediateConversions = Math.min(tracks.length, 3);
      const convertedSongs = [];

      for (let i = 0; i < immediateConversions; i++) {
        const track = tracks[i].track;
        const fallbackQuery = `ytsearch:${track.name} ${track.artists[0]?.name}`;
        try {
          const result = await node.rest.resolve(fallbackQuery);
          if (result && result.loadType !== "empty" && result.loadType !== "error") {
            const t = result.data[0];
            convertedSongs.push({
              name: track.name,
              url: t.info.uri,
              duration: Math.round(t.info.length / 1000),
              formattedDuration: formatDuration(Math.round(t.info.length / 1000)),
              thumbnail: track.album?.images?.[0]?.url || t.info.artworkUrl,
              author: track.artists.map((a) => a.name).join(", "),
              user: user,
              track: t.encoded,
              spotifyData: {
                originalUrl: track.external_urls?.spotify,
                trackId: track.id,
                isSpotify: true,
              },
            });
          }
        } catch (error) {}
      }

      if (convertedSongs.length === 0) {
        throw new Error("Could not convert any tracks from the Spotify playlist");
      }

      return {
        type: "playlist",
        name: playlistInfo.name || "Spotify Playlist",
        url: query,
        thumbnail: playlistInfo.images?.[0]?.url,
        songs: convertedSongs,
        spotifyData: {
          playlistId: playlistId,
          totalTracks: tracks.length,
          remainingTracks: tracks.slice(immediateConversions),
          isSpotify: true,
        },
      };
    } catch (error) {
      throw new Error(`Failed to process Spotify playlist: ${error.message}`);
    }
  }

  if (spotifyAlbumPattern.test(query) && spotifyAPI) {
    try {
      const albumId = SpotifyAPI.extractSpotifyId(query, "album");
      const { tracks, albumInfo } = await spotifyAPI.getAlbumTracks(albumId);

      if (!tracks || tracks.length === 0) {
        throw new Error("Spotify album is empty or contains no playable tracks");
      }

      const convertedSongs = [];
      const maxConversions = Math.min(tracks.length, 10);

      for (let i = 0; i < maxConversions; i++) {
        const track = tracks[i];
        const artists = track.artists.length > 0 ? track.artists : albumInfo.artists;
        const fallbackQuery = `ytsearch:${track.name} ${artists[0]?.name}`;
        try {
          const result = await node.rest.resolve(fallbackQuery);
          if (result && result.loadType !== "empty" && result.loadType !== "error") {
            const t = result.data[0];
            convertedSongs.push({
              name: track.name,
              url: t.info.uri,
              duration: Math.round(t.info.length / 1000),
              formattedDuration: formatDuration(Math.round(t.info.length / 1000)),
              thumbnail: albumInfo.images?.[0]?.url || t.info.artworkUrl,
              author: artists.map((a) => a.name).join(", "),
              user: user,
              track: t.encoded,
              spotifyData: {
                originalUrl: track.external_urls?.spotify,
                trackId: track.id,
                isSpotify: true,
              },
            });
          }
        } catch (error) {}
      }

      if (convertedSongs.length === 0) {
        throw new Error("Could not convert any tracks from the Spotify album");
      }

      return {
        type: "playlist",
        name: `${albumInfo.name} - ${albumInfo.artists.map((a) => a.name).join(", ")}`,
        url: query,
        thumbnail: albumInfo.images?.[0]?.url,
        songs: convertedSongs,
        spotifyData: {
          albumId: albumId,
          totalTracks: tracks.length,
          isSpotify: true,
        },
      };
    } catch (error) {
      throw new Error(`Failed to process Spotify album: ${error.message}`);
    }
  }

  const isUrl = /^https?:\/\//.test(query);
  const searchQuery = isUrl ? query : `ytsearch:${query}`;
  
  const result = await node.rest.resolve(searchQuery);
  if (!result || result.loadType === "empty" || result.loadType === "error") {
    throw new Error("No results found or error occurred");
  }

  if (result.loadType === "playlist") {
    return {
      type: "playlist",
      name: result.data.info.name,
      url: query,
      thumbnail: result.data.tracks[0]?.info?.artworkUrl,
      songs: result.data.tracks.map(t => ({
        name: t.info.title,
        url: t.info.uri,
        duration: Math.round(t.info.length / 1000),
        formattedDuration: formatDuration(Math.round(t.info.length / 1000)),
        thumbnail: t.info.artworkUrl,
        author: t.info.author,
        user: user,
        track: t.encoded
      }))
    };
  } else {
    const t = result.loadType === "track" ? result.data : result.data[0];
    return {
      type: "song",
      name: t.info.title,
      url: t.info.uri,
      duration: Math.round(t.info.length / 1000),
      formattedDuration: formatDuration(Math.round(t.info.length / 1000)),
      thumbnail: t.info.artworkUrl,
      author: t.info.author,
      user: user,
      track: t.encoded
    };
  }
}

client.searchSong = searchSong;
client.formatDuration = formatDuration;

/**
 * Background processor for Spotify playlist conversion.
 * Converts remaining Spotify tracks to YouTube in the background.
 * @param {MusicQueue} queue - The music queue to add tracks to.
 * @param {Array} remainingTracks - The remaining Spotify tracks to convert.
 * @param {import('discord.js').TextChannel} textChannel - The channel to send updates to.
 */
async function processSpotifyPlaylistBackground(
  queue,
  remainingTracks,
  textChannel,
) {
  if (!remainingTracks || remainingTracks.length === 0) return;

  const queueClient = queue.client;
  const node = queueClient.shoukaku.getIdealNode();
  if (!node) return;

  let convertedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < remainingTracks.length; i++) {
    const track = remainingTracks[i].track;

    try {
      const fallbackQuery = `ytsearch:${track.name} ${track.artists[0]?.name}`;
      const result = await node.rest.resolve(fallbackQuery);
      
      if (result && result.loadType !== "empty" && result.loadType !== "error") {
        const t = result.data[0];
        const song = {
          name: track.name,
          url: t.info.uri,
          duration: Math.round(t.info.length / 1000),
          formattedDuration: formatDuration(Math.round(t.info.length / 1000)),
          thumbnail: track.album?.images?.[0]?.url || t.info.artworkUrl,
          author: track.artists.map((a) => a.name).join(", "),
          user: queue.songs[0]?.user,
          track: t.encoded,
          spotifyData: {
            originalUrl: track.external_urls?.spotify,
            trackId: track.id,
            isSpotify: true,
          },
        };

        await queue.addSong(song);
        convertedCount++;

        if (convertedCount % 10 === 0) {
          const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
          const container = new ContainerBuilder().setAccentColor(0x1db954);
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("MUSIC")} **Spotify Converter**: Added ${convertedCount}/${remainingTracks.length} tracks to queue`));
          textChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
        }
      } else {
        failedCount++;
      }
    } catch (error) {
      failedCount++;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));

    if (!queueClient || !queueClient.getQueue(queue.guildId)) {
      break;
    }
  }

  if (convertedCount > 0) {
    const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
    const container = new ContainerBuilder().setAccentColor(0x1db954);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("SUCCESS")} **Spotify Converter Complete**: Added ${convertedCount} tracks, ${failedCount} failed`));
    textChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(console.error);
  }
}

client.processSpotifyPlaylistBackground = processSpotifyPlaylistBackground;

// Load all slash commands from commands directory
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
    const status = `✅ Bot alive | ${client.guilds.cache.size} servers | ${client.queues.size} active queues`;
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
      // Silently ignore expired/unknown interactions (10062) - they don't break anything
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

/**
 * Handles music panel button clicks.
 * Processes play/pause, skip, stop, shuffle, loop, and volume controls.
 * @param {import('discord.js').ButtonInteraction} interaction - Button interaction from music panel.
 * @param {import('discord.js').Client} client - Discord client instance.
 */
async function handleButtonInteraction(interaction, client) {
  try {
    await interaction.deferUpdate();
  } catch (error) {
    console.error("Failed to defer button interaction:", error.message);
    return;
  }

  const queue = client.getQueue(interaction.guildId);

  if (!queue) {
    return interaction.followUp({
      content: `${e("ERROR")} Nothing is playing right now.`,
      ephemeral: true,
    });
  }

  const member = interaction.member;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel || voiceChannel.id !== queue.voiceChannel.id) {
    return interaction.followUp({
      content: `${e("ERROR")} You need to be in the same voice channel.`,
      ephemeral: true,
    });
  }

  try {
    switch (interaction.customId) {
      case "music_pause":
        if (queue.paused) {
          queue.resume();
          await interaction.followUp({ ephemeral: true, content: `${e("PLAY")} Resumed the music.` });
        } else {
          queue.pause();
          await interaction.followUp({ ephemeral: true, content: `${e("PAUSE")} Paused the music.` });
        }
        break;

      case "music_skip":
        queue.skip();
        await interaction.followUp({
          ephemeral: true,
          content: `${e("SKIP")} Skipped the current song.`,
        });
        break;

      case "music_stop":
        queue.stop();
        await interaction.followUp({
          ephemeral: true,
          content: `${e("STOP")} Stopped the music and cleared the queue.`,
        });
        break;

      case "music_shuffle":
        queue.shuffle();
        await interaction.followUp({ ephemeral: true, content: `${e("SHUFFLE")} Shuffled the queue.` });
        break;

      case "music_loop":
        const modes = ["Off", "Song", "Queue"];
        const nextMode = (queue.repeatMode + 1) % 3;
        queue.setRepeatMode(nextMode);
        await interaction.followUp({
          ephemeral: true,
          content: `${e("LOOP")} Loop mode: **${modes[nextMode]}**`,
        });
        break;

      case "music_previous":
        await interaction.followUp({
          ephemeral: true,
          content: `${e("PREVIOUS")} Previous track not available.`,
        });
        break;

      case "music_queue":
        const songs = queue.songs.slice(0, 10);
        const queueList = songs
          .map(
            (song, i) =>
              `${i === 0 ? `**${e("PLAY")} Now:**` : `**${i}.**`} [${song.name}](${song.url}) - \`${song.formattedDuration}\``,
          )
          .join("\n");
        await interaction.followUp({
          ephemeral: true,
          content: `${e("QUEUE")} **Queue** (${queue.songs.length} songs)\n\n${queueList}`,
        });
        break;

      case "music_voldown":
        const newVolDown = Math.max(0, queue.volume - 10);
        queue.setVolume(newVolDown);
        await interaction.followUp({
          ephemeral: true,
          content: `${e("VOLDOWN")} Volume: **${newVolDown}%**`,
        });
        break;

      case "music_volup":
        const newVolUp = Math.min(100, queue.volume + 10);
        queue.setVolume(newVolUp);
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
 * @param {MusicQueue} queue - The music queue instance.
 */
async function updateMusicController(interaction, queue) {
  try {
    if (!interaction.message || !interaction.message.id) {
      console.log("No message to update - interaction message not found");
      return;
    }

    const panelClient = queue?.client || interaction?.client;

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

      const panelData = panelClient?.musicPanels?.get(queue.guildId);
      if (
        panelData &&
        panelData.message &&
        panelData.message.id === interaction.message.id
      ) {
        panelClient.musicPanels.delete(queue.guildId);
      }
    } else if (error.code === 10062) {
      console.log("Interaction expired - cannot update music controller");
    } else {
      console.error("Error updating music controller:", error.message);
    }
  }
}

client.on("error", console.error);

/**
 * Initializes the main bot process.
 * Validates environment variables, starts the API server, and logs into Discord.
 * @returns {Promise<string>} The Discord login token.
 */
function startMainBot() {
  if (!process.env.DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN is not set in .env file!");
    process.exit(1);
  }

  if (process.env.SPOTIFY_CLIENT_ID && !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error(
      "❌ SPOTIFY_CLIENT_SECRET is required when SPOTIFY_CLIENT_ID is provided!",
    );
    process.exit(1);
  }

  if (!process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    console.error(
      "❌ SPOTIFY_CLIENT_ID is required when SPOTIFY_CLIENT_SECRET is provided!",
    );
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
  MusicQueue,
  searchSong,
  handleButtonInteraction,
  updateMusicController,
  processSpotifyPlaylistBackground,
  formatDuration,
  spotifyAPI,
  startMainBot,
};
