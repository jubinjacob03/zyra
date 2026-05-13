require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
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
const youtube = require("youtube-sr").default;
const fs = require("fs");
const path = require("path");
const { formatDuration } = require("./utils/embed");
const { initEmojis, e } = require("./utils/customEmoji");
const SpotifyAPI = require("./utils/spotify");
const YouTubeSearchEngine = require("./utils/youtubeSearch");
const { youtubedl } = require("./utils/media");
const { initRuntimeLogger } = require("./utils/runtimeLogger");
const { getControllerPanel, setControllerPanel } = require("./utils/panelStore");

initRuntimeLogger({ label: process.env.RUNTIME_LOGGER_LABEL || "main" });

process.on("unhandledRejection", (reason) => {
  if (reason && typeof reason === "object") {
    if (reason.command && reason.command.includes("yt-dlp")) {
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
  if (error.message && error.message.includes("yt-dlp")) {
    return;
  }
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
 * Music Queue Manager
 * Handles voice connection, audio playback, queue management, and player state
 */
const isEditableByClient = (message, clientUserId) => {
  if (!message) return false;
  if (typeof message.editable === "boolean") return message.editable;
  if (!clientUserId) return true;
  return message.author?.id === clientUserId;
};

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

class MusicQueue {
  constructor(
    client,
    guildId,
    textChannel,
    voiceChannel,
    connection,
    persistent = false,
  ) {
    this.client = client;
    this.guildId = guildId;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.connection = connection;
    this.songs = [];
    this.volume = 50;
    this.playing = false;
    this.paused = false;
    this.repeatMode = 0;
    this.persistent = persistent;
    this.lastInteraction = null;
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: Math.round(10000 / 20),
      },
    });
    this.currentResource = null;
    this.currentProcess = null;
    this.streamStarted = false;

    this.connection.subscribe(this.player);
    this.setupPlayerEvents();
  }

  /**
   * Send message - uses ephemeral followUp for persistent queues, regular send otherwise
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
      await this.textChannel.send(content).catch(console.error);
    }
  }

  /**
   * Setup audio player event listeners
   * Handles song transitions and playback errors
   */
  setupPlayerEvents() {
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.playing && this.currentResource && this.streamStarted) {
        this.processQueue();
      }
    });

    this.player.on("error", (error) => {
      console.error("Player error:", error);
      this.sendMessage(`${e("ERROR")} Player error: ${error.message}`);
      this.processQueue();
    });
  }

  stopCurrentProcess() {
    if (this.currentProcess) {
      try {
        this.currentProcess.kill();
      } catch {}
      this.currentProcess = null;
    }
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
   * Play the current song in the queue
   * Extracts stream URL via yt-dlp and creates audio resource
   */
  async play() {
    if (this.songs.length === 0) {
      this.stop();
      return;
    }

    this.stopCurrentProcess();

    const song = this.songs[0];
    this.playing = true;
    this.paused = false;
    this.streamStarted = false;

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
        ...(process.env.YOUTUBE_PROXY && { proxy: process.env.YOUTUBE_PROXY }),
      };

      const ytdlpProcess = youtubedl.exec(song.url, ytdlpOpts);
      this.currentProcess = ytdlpProcess;

      ytdlpProcess.stderr?.on("data", () => {});

      ytdlpProcess.once("close", () => {
        if (this.currentProcess === ytdlpProcess) {
          this.currentProcess = null;
        }
      });

      let streamTimeout;
      ytdlpProcess.stdout?.once("data", () => {
        this.streamStarted = true;
        if (streamTimeout) clearTimeout(streamTimeout);
      });

      streamTimeout = setTimeout(() => {
        if (!this.streamStarted) {
          console.error("❌ Audio stream failed to start within 10 seconds");
          this.stopCurrentProcess();
          this.sendMessage(
            `${e("ERROR")} Failed to start audio stream. The video might be unavailable or region-locked.`,
          ).catch(console.error);
          this.processQueue();
        }
      }, 10000);

      this.currentResource = createAudioResource(ytdlpProcess.stdout, {
        metadata: song,
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
        highWaterMark: 1 << 25,
      });

      this.currentResource.volume.setVolume(this.volume / 100);

      this.player.play(this.currentResource);

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
        message = await this.textChannel.send(controller);
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
      this.stopCurrentProcess();
      console.error(`❌ Playback error: ${error.message}`);
      this.sendMessage(
        `${e("ERROR")} Error playing **${song.name}**: ${error.message}`,
      );
      this.songs.shift();
      this.processQueue();
    }
  }

  /**
   * Process queue after song completion
   * Handles repeat modes and queue progression
   */
  processQueue() {
    this.stopCurrentProcess();
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
          this.textChannel.send(
            `${e("MUSIC")} Queue finished. Add more songs to keep the party going!`,
          );
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
   * Pause audio playback
   */
  pause() {
    this.player.pause();
    this.paused = true;
  }

  /**
   * Resume audio playback
   */
  resume() {
    this.player.unpause();
    this.paused = false;
  }

  /**
   * Skip current song
   */
  skip() {
    this.stopCurrentProcess();
    this.player.stop();
  }

  /**
   * Stop playback and clean up resources
   * Safely destroys voice connection and clears queue
   */
  stop() {
    this.songs = [];
    this.playing = false;
    this.paused = false;
    this.stopCurrentProcess();
    this.player.stop();

    this.stopProgressUpdates();

    if (this.persistent) {
      return;
    }

    if (
      this.connection &&
      this.connection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      try {
        this.connection.destroy();
      } catch (error) {
        console.error("Error destroying connection:", error);
      }
    }

    this.client.queues.delete(this.guildId);
    this.client.musicPanels.delete(this.guildId);
  }

  /**
   * Shuffle queue using Fisher-Yates algorithm
   * Keeps current song at position 0
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
   * Set playback volume
   * @param {number} vol - Volume level (0-100)
   */
  setVolume(vol) {
    this.volume = vol;
    if (this.currentResource?.volume) {
      this.currentResource.volume.setVolume(vol / 100);
    }
  }

  /**
   * Set repeat mode
   * @param {number} mode - 0: Off, 1: Single, 2: Queue
   */
  setRepeatMode(mode) {
    this.repeatMode = mode;
    this.updateMusicPanel();
  }

  /**
   * Start real-time progress updates for the music panel
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
   * Update the music panel embed with current progress
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
   * Stop progress updates and clean up
   */
  stopProgressUpdates() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  /**
   * Remove song from queue by index
   * @param {number} index - Song position in queue
   * @returns {Object|null} Removed song or null
   */
  remove(index) {
    if (index > 0 && index < this.songs.length) {
      return this.songs.splice(index, 1)[0];
    }
    return null;
  }

  /**
   * Get current playing song
   * @returns {Object|null} Current song or null
   */
  get currentSong() {
    return this.songs[0] || null;
  }

  /**
   * Get formatted total queue duration
   * @returns {string} Formatted duration (HH:MM:SS or MM:SS)
   */
  get formattedDuration() {
    const total = this.songs.reduce((acc, s) => acc + (s.duration || 0), 0);
    return formatDuration(total);
  }
}

/**
 * Create and initialize a music queue for a guild
 * @param {string} guildId - Discord guild ID
 * @param {object} textChannel - Text channel for bot messages
 * @param {object} voiceChannel - Voice channel to join
 * @returns {Promise<MusicQueue>} Initialized music queue
 * @throws {Error} If connection fails or times out
 */
client.createQueue = async function (
  guildId,
  textChannel,
  voiceChannel,
  persistent = false,
) {
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
    this,
    guildId,
    textChannel,
    voiceChannel,
    connection,
    persistent,
  );
  this.queues.set(guildId, queue);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      if (queue && !queue.persistent) {
        queue.stop();
      } else if (queue && queue.persistent) {
        console.log(
          "⚠️ Persistent instance disconnected - attempting reconnect...",
        );
        try {
          const newConnection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          });

          await entersState(newConnection, VoiceConnectionStatus.Ready, 10_000);
          queue.connection = newConnection;
          newConnection.subscribe(queue.player);
          console.log("✅ Persistent instance reconnected successfully");
        } catch (reconnectError) {
          console.error(
            "❌ Failed to reconnect persistent instance:",
            reconnectError.message,
          );
        }
      }
    }
  });

  return queue;
};

/**
 * Get existing music queue for a guild
 * @param {string} guildId - Discord guild ID
 * @returns {MusicQueue|undefined} Music queue or undefined
 */
client.getQueue = function (guildId) {
  return this.queues.get(guildId);
};

/**
 * Enhanced search function with Spotify support and timeout handling
 * Handles YouTube URLs, Spotify URLs, and search queries
 * @param {string} query - YouTube URL, Spotify URL, or search term
 * @param {GuildMember} user - User who requested the song
 * @returns {Promise<Object|null>} Song/playlist object or null
 */
async function searchSong(query, user) {
  return Promise.race([
    searchSongInternal(query, user),
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

async function searchSongInternal(query, user) {
  const videoPattern =
    /^(https?:\/\/)?(www\.)?(m\.|music\.)?(youtube\.com|youtu\.?be)\/.+$/;
  const playlistPattern = /^.*(list=)([^#\&\?]*).*/;

  const mixPlaylistPattern =
    /[?&]list=(RD[A-Za-z0-9_-]+|RDMM[A-Za-z0-9_-]+|RDAMPL[A-Za-z0-9_-]+|RDCLAK[A-Za-z0-9_-]+)/;

  const spotifyTrackPattern = /spotify\.com\/track\/([a-zA-Z0-9]+)/;
  const spotifyPlaylistPattern = /spotify\.com\/playlist\/([a-zA-Z0-9]+)/;
  const spotifyAlbumPattern = /spotify\.com\/album\/([a-zA-Z0-9]+)/;

  if (mixPlaylistPattern.test(query)) {
    throw new Error(
      "❌ **YouTube Mix playlists are not supported**\n\n" +
        "🔒 Mix playlists are personalized and user-specific - they cannot be accessed by bots.\n\n" +
        "💡 **Alternatives:**\n" +
        "• Use a regular YouTube playlist instead\n" +
        "• Search for individual songs\n" +
        "• Create a custom playlist with your favorite tracks",
    );
  }

  const cookieOpts = fs.existsSync("./cookies.txt")
    ? { cookies: "./cookies.txt" }
    : {};

  const antiDetectionOpts = {
    ...cookieOpts,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    referer: "https://www.youtube.com/",
    addHeader: [
      "Accept-Language:en-US,en;q=0.9",
      "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Sec-Fetch-Mode:navigate",
      "Sec-Fetch-Dest:document",
    ],
    ...(process.env.YOUTUBE_PROXY && { proxy: process.env.YOUTUBE_PROXY }),
  };

  if (spotifyTrackPattern.test(query) && spotifyAPI) {
    try {
      const trackId = SpotifyAPI.extractSpotifyId(query, "track");

      const spotifyTrack = await spotifyAPI.getTrack(trackId);

      const youtubeVideo =
        await YouTubeSearchEngine.findBestMatch(spotifyTrack);

      if (!youtubeVideo) {
        const fallbackQuery = `${spotifyTrack.name} ${spotifyTrack.artists[0]?.name}`;

        try {
          const fallbackResult = await youtube.searchOne(fallbackQuery);

          if (fallbackResult) {
            const info = await youtubedl(fallbackResult.url, {
              dumpSingleJson: true,
              noWarnings: true,
              noCheckCertificates: true,
              skipDownload: true,
              ...antiDetectionOpts,
            });

            return {
              type: "song",
              name: spotifyTrack.name,
              url: info.webpage_url || fallbackResult.url,
              duration: parseInt(info.duration) || fallbackResult.duration || 0,
              formattedDuration: formatDuration(
                parseInt(info.duration) || fallbackResult.duration || 0,
              ),
              thumbnail: spotifyTrack.album?.images?.[0]?.url || info.thumbnail,
              author: spotifyTrack.artists.map((a) => a.name).join(", "),
              user: user,
              spotifyData: {
                originalUrl: query,
                trackId: trackId,
                isSpotify: true,
                fallbackUsed: true,
              },
            };
          }
        } catch (fallbackError) {}

        throw new Error(
          "Could not find a matching YouTube video for this Spotify track",
        );
      }

      const info = await youtubedl(youtubeVideo.url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        skipDownload: true,
        ...antiDetectionOpts,
      });

      return {
        type: "song",
        name: spotifyTrack.name,
        url: info.webpage_url || youtubeVideo.url,
        duration:
          parseInt(info.duration) ||
          youtubeVideo.correctedDuration ||
          youtubeVideo.duration ||
          0,
        formattedDuration: formatDuration(
          parseInt(info.duration) ||
            youtubeVideo.correctedDuration ||
            youtubeVideo.duration ||
            0,
        ),
        thumbnail: spotifyTrack.album?.images?.[0]?.url || info.thumbnail,
        author: spotifyTrack.artists.map((a) => a.name).join(", "),
        user: user,
        spotifyData: {
          originalUrl: query,
          trackId: trackId,
          isSpotify: true,
        },
      };
    } catch (error) {
      if (error.message.includes("Could not find a matching YouTube video")) {
        try {
          const trackId = SpotifyAPI.extractSpotifyId(query, "track");
          const spotifyTrack = await spotifyAPI.getTrack(trackId);
          const fallbackQuery = `${spotifyTrack.name} ${spotifyTrack.artists[0]?.name}`;

          const fallbackResult = await youtube.searchOne(fallbackQuery);
          if (fallbackResult) {
            const info = await youtubedl(fallbackResult.url, {
              dumpSingleJson: true,
              noWarnings: true,
              noCheckCertificates: true,
              skipDownload: true,
              ...antiDetectionOpts,
            });

            return {
              type: "song",
              name: spotifyTrack.name,
              url: info.webpage_url || fallbackResult.url,
              duration: parseInt(info.duration) || fallbackResult.duration || 0,
              formattedDuration: formatDuration(
                parseInt(info.duration) || fallbackResult.duration || 0,
              ),
              thumbnail: spotifyTrack.album?.images?.[0]?.url || info.thumbnail,
              author: spotifyTrack.artists.map((a) => a.name).join(", "),
              user: user,
              spotifyData: {
                originalUrl: query,
                trackId: trackId,
                isSpotify: true,
                fallbackUsed: true,
              },
            };
          }
        } catch (fallbackError) {}
      }
      throw new Error(
        `Unable to find this Spotify track on YouTube. Try a different song or search manually.`,
      );
    }
  }

  if (spotifyPlaylistPattern.test(query) && spotifyAPI) {
    try {
      const playlistId = SpotifyAPI.extractSpotifyId(query, "playlist");

      const { tracks, playlistInfo } =
        await spotifyAPI.getPlaylistTracks(playlistId);

      if (!tracks || tracks.length === 0) {
        throw new Error(
          "Spotify playlist is empty or contains no playable tracks",
        );
      }

      const immediateConversions = Math.min(tracks.length, 3);
      const convertedSongs = [];

      for (let i = 0; i < immediateConversions; i++) {
        const track = tracks[i].track;
        console.log(
          `🎵 Converting track ${i + 1}: "${track.name}" by ${track.artists.map((a) => a.name).join(", ")}`,
        );
        try {
          const youtubeVideo = await YouTubeSearchEngine.findBestMatch(track);
          if (youtubeVideo) {
            console.log(`✅ Successfully converted: "${track.name}"`);
            convertedSongs.push({
              name: track.name,
              url: youtubeVideo.url,
              duration: youtubeVideo.duration || 0,
              formattedDuration: formatDuration(youtubeVideo.duration || 0),
              thumbnail:
                track.album?.images?.[0]?.url || youtubeVideo.thumbnail,
              author: track.artists.map((a) => a.name).join(", "),
              user: user,
              spotifyData: {
                originalUrl: track.external_urls?.spotify,
                trackId: track.id,
                isSpotify: true,
              },
            });
          } else {
          }
        } catch (error) {}
      }

      if (convertedSongs.length === 0) {
        throw new Error(
          "Could not convert any tracks from the Spotify playlist",
        );
      }

      console.log(
        `✅ Successfully converted ${convertedSongs.length}/${immediateConversions} immediate tracks`,
      );

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
        throw new Error(
          "Spotify album is empty or contains no playable tracks",
        );
      }

      const convertedSongs = [];
      const maxConversions = Math.min(tracks.length, 10);

      for (let i = 0; i < maxConversions; i++) {
        const track = tracks[i];
        try {
          const trackWithAlbumArtist = {
            ...track,
            artists:
              track.artists.length > 0 ? track.artists : albumInfo.artists,
          };

          const youtubeVideo =
            await YouTubeSearchEngine.findBestMatch(trackWithAlbumArtist);
          if (youtubeVideo) {
            convertedSongs.push({
              name: track.name,
              url: youtubeVideo.url,
              duration: youtubeVideo.duration || 0,
              formattedDuration: formatDuration(youtubeVideo.duration || 0),
              thumbnail: albumInfo.images?.[0]?.url || youtubeVideo.thumbnail,
              author:
                track.artists.map((a) => a.name).join(", ") ||
                albumInfo.artists.map((a) => a.name).join(", "),
              user: user,
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

  if (videoPattern.test(query) && !playlistPattern.test(query)) {
    const info = await youtubedl(query, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      skipDownload: true,
      ...antiDetectionOpts,
    });

    return {
      type: "song",
      name: info.title,
      url: info.webpage_url || query,
      duration: parseInt(info.duration) || 0,
      formattedDuration: formatDuration(parseInt(info.duration) || 0),
      thumbnail: info.thumbnail,
      author: info.uploader || info.channel || "Unknown",
      user: user,
    };
  } else if (playlistPattern.test(query)) {
    try {
      const info = await youtubedl(query, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noWarnings: true,
        skipDownload: true,
        ...antiDetectionOpts,
      });

      const videos = info.entries || [];

      if (
        videos.length === 0 &&
        (query.includes("RD") ||
          query.includes("RDMM") ||
          query.includes("RDAMPL"))
      ) {
        throw new Error(
          "❌ **YouTube Mix playlists are not supported**\n\n" +
            "🔒 Mix playlists are personalized and user-specific - they cannot be accessed by bots.\n\n" +
            "💡 **Alternatives:**\n" +
            "• Use a regular YouTube playlist instead\n" +
            "• Search for individual songs\n" +
            "• Create a custom playlist with your favorite tracks",
        );
      }

      if (videos.length === 0) {
        throw new Error("This playlist is empty or cannot be accessed");
      }

      return {
        type: "playlist",
        name: info.title || "Playlist",
        url: info.webpage_url || query,
        thumbnail: info.thumbnail || videos[0]?.thumbnail,
        songs: videos.slice(0, 50).map((v) => ({
          name: v.title,
          url: v.url || `https://youtube.com/watch?v=${v.id}`,
          duration: v.duration || 0,
          formattedDuration: formatDuration(v.duration || 0),
          thumbnail: v.thumbnail,
          author: v.uploader || v.channel || "Unknown",
          user: user,
        })),
      };
    } catch (error) {
      if (error.message.includes("Mix playlists are not supported")) {
        throw error;
      }

      if (
        error.message.includes("Unable to extract") ||
        error.message.includes("playlist does not exist") ||
        error.message.includes("Private playlist") ||
        (query.includes("RD") && error.message.includes("ERROR"))
      ) {
        throw new Error(
          "❌ **YouTube Mix playlists are not supported**\n\n" +
            "🔒 Mix playlists are personalized and user-specific - they cannot be accessed by bots.\n\n" +
            "💡 **Alternatives:**\n" +
            "• Use a regular YouTube playlist instead\n" +
            "• Search for individual songs\n" +
            "• Create a custom playlist with your favorite tracks",
        );
      }

      throw new Error(`Failed to process YouTube playlist: ${error.message}`);
    }
  } else {
    if (
      spotifyAPI &&
      !query.startsWith("youtube:") &&
      !query.startsWith("yt:")
    ) {
      try {
        const spotifyResults = await spotifyAPI.searchTracks(query, 3);
        if (spotifyResults && spotifyResults.length > 0) {
          const bestSpotifyMatch = spotifyResults[0];
          const youtubeVideo =
            await YouTubeSearchEngine.findBestMatch(bestSpotifyMatch);

          if (youtubeVideo) {
            const info = await youtubedl(youtubeVideo.url, {
              dumpSingleJson: true,
              noWarnings: true,
              skipDownload: true,
              ...antiDetectionOpts,
            });

            return {
              type: "song",
              name: bestSpotifyMatch.name,
              url: info.webpage_url || youtubeVideo.url,
              duration: parseInt(info.duration) || youtubeVideo.duration || 0,
              formattedDuration: formatDuration(
                parseInt(info.duration) || youtubeVideo.duration || 0,
              ),
              thumbnail:
                bestSpotifyMatch.album?.images?.[0]?.url || info.thumbnail,
              author: bestSpotifyMatch.artists.map((a) => a.name).join(", "),
              user: user,
              spotifyData: {
                originalUrl: bestSpotifyMatch.external_urls?.spotify,
                trackId: bestSpotifyMatch.id,
                isSpotify: true,
                searchQuery: query,
              },
            };
          }
        }
      } catch (error) {}
    }

    const result = await youtube.searchOne(query);
    if (!result) return null;

    const url = `https://youtube.com/watch?v=${result.id}`;
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true,
      ...antiDetectionOpts,
    });

    return {
      type: "song",
      name: info.title,
      url: info.webpage_url || url,
      duration: parseInt(info.duration) || 0,
      formattedDuration: formatDuration(parseInt(info.duration) || 0),
      thumbnail: info.thumbnail,
      author: info.uploader || "Unknown",
      user: user,
    };
  }
}

client.searchSong = searchSong;
client.formatDuration = formatDuration;

/**
 * Background processor for Spotify playlist conversion
 * Converts remaining Spotify tracks to YouTube in the background
 */
async function processSpotifyPlaylistBackground(
  queue,
  remainingTracks,
  textChannel,
) {
  if (!remainingTracks || remainingTracks.length === 0) return;

  const queueClient = queue.client;

  let convertedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < remainingTracks.length; i++) {
    const track = remainingTracks[i].track;

    try {
      const youtubeVideo = await YouTubeSearchEngine.findBestMatch(track);
      if (youtubeVideo) {
        const song = {
          name: track.name,
          url: youtubeVideo.url,
          duration: youtubeVideo.duration || 0,
          formattedDuration: formatDuration(youtubeVideo.duration || 0),
          thumbnail: track.album?.images?.[0]?.url || youtubeVideo.thumbnail,
          author: track.artists.map((a) => a.name).join(", "),
          user: queue.songs[0]?.user,
          spotifyData: {
            originalUrl: track.external_urls?.spotify,
            trackId: track.id,
            isSpotify: true,
          },
        };

        await queue.addSong(song);
        convertedCount++;

        if (convertedCount % 10 === 0) {
          textChannel
            .send(
              `🎵 **Spotify Converter**: Added ${convertedCount}/${remainingTracks.length} tracks to queue`,
            )
            .catch(console.error);
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
    textChannel
      .send(
        `✅ **Spotify Converter Complete**: Added ${convertedCount} tracks, ${failedCount} failed`,
      )
      .catch(console.error);
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
        content: "❌ There was an error executing this command!",
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
 * Handle music panel button clicks
 * Processes play/pause, skip, stop, shuffle, loop, volume controls
 * @param {ButtonInteraction} interaction - Button interaction from music panel
 * @param {Client} client - Discord client instance
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
      content: "\u274c Nothing is playing right now.",
      ephemeral: true,
    });
  }

  const member = interaction.member;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel || voiceChannel.id !== queue.voiceChannel.id) {
    return interaction.followUp({
      content: "❌ You need to be in the same voice channel.",
      ephemeral: true,
    });
  }

  try {
    switch (interaction.customId) {
      case "music_pause":
        if (queue.paused) {
          queue.resume();
          await interaction.editReply({ content: "▶️ Resumed the music." });
        } else {
          queue.pause();
          await interaction.editReply({ content: "⏸️ Paused the music." });
        }
        break;

      case "music_skip":
        queue.skip();
        await interaction.editReply({
          content: "⏭️ Skipped the current song.",
        });
        break;

      case "music_stop":
        queue.stop();
        await interaction.editReply({
          content: "⏹️ Stopped the music and cleared the queue.",
        });
        break;

      case "music_shuffle":
        queue.shuffle();
        await interaction.editReply({ content: "🔀 Shuffled the queue." });
        break;

      case "music_loop":
        const modes = ["Off", "Song", "Queue"];
        const nextMode = (queue.repeatMode + 1) % 3;
        queue.setRepeatMode(nextMode);
        await interaction.editReply({
          content: `🔁 Loop mode: **${modes[nextMode]}**`,
        });
        break;

      case "music_previous":
        await interaction.editReply({
          content: "⏮️ Previous track not available.",
        });
        break;

      case "music_queue":
        const songs = queue.songs.slice(0, 10);
        const queueList = songs
          .map(
            (song, i) =>
              `${i === 0 ? "**▶️ Now:**" : `**${i}.**`} [${song.name}](${song.url}) - \`${song.formattedDuration}\``,
          )
          .join("\n");
        await interaction.editReply({
          content: `📋 **Queue** (${queue.songs.length} songs)\n\n${queueList}`,
        });
        break;

      case "music_voldown":
        const newVolDown = Math.max(0, queue.volume - 10);
        queue.setVolume(newVolDown);
        await interaction.editReply({
          content: `🔉 Volume: **${newVolDown}%**`,
        });
        break;

      case "music_volup":
        const newVolUp = Math.min(100, queue.volume + 10);
        queue.setVolume(newVolUp);
        await interaction.editReply({ content: `🔊 Volume: **${newVolUp}%**` });
        break;

      case "music_refresh":
        await interaction.followUp({
          content: "🔄 Music controller refreshed!",
          ephemeral: true,
        });
        break;

      default:
        await interaction.followUp({
          content: "❓ Unknown button action.",
          ephemeral: true,
        });
    }

    await updateMusicController(interaction, queue);
  } catch (error) {
    console.error("Button interaction error:", error);
    try {
      await interaction.followUp({
        content: "❌ An error occurred.",
        ephemeral: true,
      });
    } catch (replyError) {
      console.error("Failed to send error message:", replyError);
    }
  }
}

/**
 * Update the music controller after button interactions
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
