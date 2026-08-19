require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  ActivityType,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const { initRuntimeLogger } = require("./utils/runtimeLogger");
const { initEmojis, e } = require("./utils/customEmoji");
const { createLogger } = require("./utils/logger");
const { musicBotCacheConfig } = require("./utils/clientCache");

initRuntimeLogger({ label: process.env.RUNTIME_LOGGER_LABEL || "main" });
const log = createLogger("bot");
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
const youtubedlExec = require("youtube-dl-exec");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { formatDuration } = require("./utils/embed");
const SpotifyAPI = require("./utils/spotify");
const YouTubeSearchEngine = require("./utils/youtubeSearch");
const {
  createCompleteMusicController,
  createIdleMusicController,
} = require("./utils/componentsV2");
const {
  getControllerPanel,
  setControllerPanel,
} = require("./utils/panelStore");
const { binaryPath: ytdlpBinaryPath } = require("./utils/ytdlpPath");

// Cross-platform yt-dlp configuration
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
  const candidates = [
    "/root/.nix-profile/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    youtubedl = youtubedlExec.create(found);
    console.log(`✅ Using system yt-dlp (${found})`);
  } else {
    youtubedl = youtubedlExec;
    console.log("✅ Using bundled yt-dlp (Linux/Mac)");
  }
}

const ffmpegPath = require("ffmpeg-static");
process.env.FFMPEG_PATH = ffmpegPath;

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

process.on("unhandledRejection", (reason, promise) => {
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
  if (error.message && error.message.includes("yt-dlp")) return;
  if (
    error.code === "EOF" ||
    error.code === "EPIPE" ||
    error.code === "ERR_STREAM_DESTROYED"
  )
    return;
  if (
    error.syscall === "write" &&
    (error.errno === -4095 || error.errno === -32)
  )
    return;
  console.error("Uncaught exception:", error);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
  ...musicBotCacheConfig(),
});

client.commands = new Collection();
client.queues = new Map();
client.musicPanels = new Map();

const MAIN_PANEL_CHANNEL_ID = "1473105751575760917";

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
class MusicQueue {
  constructor(guildId, textChannel, voiceChannel, connection) {
    this.guildId = guildId;
    this.textChannel = textChannel;
    this.voiceChannel = voiceChannel;
    this.connection = connection;
    this.client = null;
    this.songs = [];
    this.volume = 50;
    this.playing = false;
    this.paused = false;
    this.repeatMode = 0;
    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: Math.round(10000 / 20),
      },
    });
    this.currentResource = null;
    this.streamStarted = false;

    this.connection.subscribe(this.player);
    this.setupPlayerEvents();
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
      this.textChannel
        .send(`${e("ERROR")} Player error: ${error.message}`)
        .catch(console.error);
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
   * Play the current song in the queue
   * Extracts stream URL via yt-dlp and creates audio resource
   */
  async play() {
    if (this.songs.length === 0) {
      this.stop();
      return;
    }

    if (this.connection.state.status !== VoiceConnectionStatus.Ready) {
      try {
        await entersState(this.connection, VoiceConnectionStatus.Ready, 10_000);
      } catch {
        console.error("Voice connection not ready, skipping playback");
        this.songs.shift();
        this.processQueue();
        return;
      }
    }

    const song = this.songs[0];
    this.playing = true;
    this.paused = false;
    this.streamStarted = false;
    this.killStreams();

    try {
      const PLAYER_CLIENTS = ["web_embedded", "android_vr", "tv"];

      let ytdlpProcess = null;
      let lastError = "";

      for (const pc of PLAYER_CLIENTS) {
        const ytdlpArgs = [
          song.url,
          "-o",
          "-",
          "-q",
          "--no-warnings",
          "-f",
          "bestaudio/best",
          "--no-playlist",
          "--geo-bypass",
          "--no-check-certificates",
          "--no-update",
          "--buffer-size",
          "16K",
          "--extractor-args",
          `youtube:player_client=${pc}`,
          "--add-header",
          "referer:youtube.com",
          "--add-header",
          "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ];
        if (fs.existsSync("./cookies.txt")) {
          ytdlpArgs.push("--cookies", "./cookies.txt");
        }

        const proc = spawn(ytdlpBinaryPath, ytdlpArgs, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });

        // Pause stdout so no data is lost before we pipe to ffmpeg
        proc.stdout.pause();

        const result = await new Promise((resolve) => {
          let gotData = false;
          let stderr = "";
          proc.stdout.once("readable", () => {
            gotData = true;
            resolve({ ok: true, proc });
          });
          proc.stderr.on("data", (c) => {
            stderr += c.toString();
          });
          proc.on("close", (code) => {
            if (!gotData) resolve({ ok: false, error: stderr.trim() });
          });
          setTimeout(() => {
            if (!gotData) {
              proc.kill();
              resolve({ ok: false, error: "timeout" });
            }
          }, 15_000);
        });

        if (result.ok) {
          ytdlpProcess = result.proc;
          break;
        }

        lastError = result.error;
        const retryable =
          lastError.includes("403") ||
          lastError.includes("format is not available");
        console.warn(
          `[yt-dlp] player_client=${pc} failed: ${lastError.split("\n").pop()}`,
        );
        if (!retryable) break;
      }

      if (!ytdlpProcess) {
        throw new Error(lastError || "All player_clients failed");
      }

      const ffmpegProcess = spawn(
        ffmpegPath,
        [
          "-i",
          "pipe:0",
          "-analyzeduration",
          "2000000",
          "-probesize",
          "524288",
          "-loglevel",
          "0",
          "-vn",
          "-c:a",
          "libopus",
          "-f",
          "ogg",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-b:a",
          "128k",
          "-application",
          "audio",
          "-frame_duration",
          "20",
          "-vbr",
          "on",
          "-compression_level",
          "10",
          "-packet_loss",
          "3",
          "pipe:1",
        ],
        {
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        },
      );

      ytdlpProcess.stdout.pipe(ffmpegProcess.stdin);
      ytdlpProcess.stdout.resume();
      ytdlpProcess.stdout.on("error", () => {});
      ytdlpProcess.on("error", () => {});
      ffmpegProcess.stdin.on("error", () => {});
      ffmpegProcess.stdout.on("error", () => {});
      ffmpegProcess.on("error", () => {});
      ytdlpProcess.on("close", () => {
        try {
          ffmpegProcess.stdin.end();
        } catch {}
      });
      ytdlpProcess.stderr?.on("data", () => {});

      let streamTimeout;
      ffmpegProcess.stdout?.once("data", () => {
        this.streamStarted = true;
        if (streamTimeout) clearTimeout(streamTimeout);
      });

      streamTimeout = setTimeout(() => {
        if (!this.streamStarted) {
          console.error("Audio stream failed to start within 30 seconds");
          ytdlpProcess.kill();
          ffmpegProcess.kill();
          this.processQueue();
        }
      }, 30000);

      this.ytdlpProcess = ytdlpProcess;
      this.ffmpegProcess = ffmpegProcess;

      this.currentResource = createAudioResource(ffmpegProcess.stdout, {
        metadata: song,
        inputType: StreamType.OggOpus,
        inlineVolume: false,
      });

      this.player.play(this.currentResource);

      const controller = createCompleteMusicController(this);

      const panelClient = this.client || client;
      const isMainInstance = !panelClient.INSTANCE_NAME;

      let panelChannel = this.textChannel;
      if (isMainInstance && MAIN_PANEL_CHANNEL_ID) {
        let pinned = panelClient.channels.cache.get(MAIN_PANEL_CHANNEL_ID);
        if (!pinned) {
          try {
            pinned = await panelClient.channels.fetch(MAIN_PANEL_CHANNEL_ID);
          } catch {}
        }
        if (pinned?.send) panelChannel = pinned;
      }

      const existingPanel = panelClient.musicPanels.get(this.guildId);
      let message = null;

      if (existingPanel?.message) {
        message = existingPanel.message;
      }

      const payload = {
        components: controller.components,
        flags: controller.flags,
      };
      if (message && typeof message.edit === "function") {
        try {
          message = await message.edit({ embeds: [], ...payload });
        } catch {
          message = await panelChannel.send(payload);
        }
      } else {
        message = await panelChannel.send(payload);
      }

      if (message?.id && message?.channelId) {
        setControllerPanel(message.channelId, message.id);
      }

      panelClient.musicPanels.set(this.guildId, {
        message,
        song,
        startTime: Date.now(),
      });
      console.log("Now playing:", song.name);

      try {
        const vcId = this.voiceChannel?.id;
        if (vcId && panelClient.rest) {
          await panelClient.rest.put(`/channels/${vcId}/voice-status`, {
            body: { status: `✨ Playing - ${song.name}`.slice(0, 500) },
          });
        }
      } catch {}

      this.startProgressUpdates();
    } catch (error) {
      this.textChannel.send(
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
    if (this.repeatMode === 1) {
      this.play();
    } else {
      if (this.repeatMode === 2 && this.songs.length > 0) {
        this.songs.push(this.songs.shift());
      } else {
        this.songs.shift();
      }

      if (this.songs.length === 0) {
        console.log("Queue finished");
        const isInstance = this.client && this.client.INSTANCE_NAME;
        if (isInstance) {
          this.playing = false;
          this.stopProgressUpdates();
          const panelClient = this.client || client;
          const panelData = panelClient.musicPanels.get(this.guildId);
          if (panelData?.message) {
            const idle = createIdleMusicController(
              "Queue finished. Add more songs!",
              panelClient.user?.username,
            );
            panelData.message.edit(idle).catch(() => {});
          }
          try {
            const vcId = this.voiceChannel?.id;
            if (vcId && panelClient.rest) {
              panelClient.rest
                .put(`/channels/${vcId}/voice-status`, {
                  body: { status: pickIdlePhrase() },
                })
                .catch(() => {});
            }
          } catch {}
          panelClient.queues.delete(this.guildId);
        } else {
          this.stop();
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
    this.player.stop();
  }

  /**
   * Stop playback and clean up resources
   * Safely destroys voice connection and clears queue
   */
  stop() {
    this.songs = [];
    this.playing = false;
    this.player.stop();

    this.killStreams();
    this.stopProgressUpdates();

    const isInstance = this.client && this.client.INSTANCE_NAME;
    if (
      !isInstance &&
      this.connection &&
      this.connection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      try {
        this.connection.destroy();
      } catch (error) {
        console.error("Error destroying connection:", error);
      }
    }

    const panelClient = this.client || client;
    panelClient.queues.delete(this.guildId);
    panelClient.musicPanels.delete(this.guildId);
  }

  killStreams() {
    try {
      this.ytdlpProcess?.kill();
    } catch {}
    try {
      this.ffmpegProcess?.kill();
    } catch {}
    this.ytdlpProcess = null;
    this.ffmpegProcess = null;
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

    const panelData = client.musicPanels.get(this.guildId);
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
    }, 30000);
  }

  /**
   * Update the music panel embed with current progress
   */
  async updateMusicPanel() {
    const panelData = client.musicPanels.get(this.guildId);
    if (!panelData?.message || !this.songs[0]) return;

    try {
      await panelData.message.fetch();

      const controller = createCompleteMusicController(this);
      if (!controller) return;

      await panelData.message.edit({
        embeds: [],
        components: controller.components,
        flags: controller.flags,
      });
    } catch (error) {
      if (error.code === 10008) {
        console.log("Music panel message was deleted - cleaning up");
        client.musicPanels.delete(this.guildId);
        this.stopProgressUpdates();
      } else if (error.code === 10003) {
        console.log("Music panel channel not found - cleaning up");
        client.musicPanels.delete(this.guildId);
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
 * @param {TextChannel} textChannel - Text channel for bot messages
 * @param {VoiceChannel} voiceChannel - Voice channel to join
 * @returns {Promise<MusicQueue>} Initialized music queue
 * @throws {Error} If connection fails or times out
 */
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

  const queue = new MusicQueue(guildId, textChannel, voiceChannel, connection);
  queue.client = this;
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

  // Anti-bot detection configuration for yt-dlp
  const cookieOpts = fs.existsSync("./cookies.txt")
    ? { cookies: "./cookies.txt" }
    : {};

  // Enhanced anti-detection options
  const antiDetectionOpts = {
    ...cookieOpts,
    extractorArgs: "youtube:player_client=web_embedded,android_vr",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    referer: "https://www.youtube.com/",
    addHeader: [
      "Accept-Language:en-US,en;q=0.9",
      "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Sec-Fetch-Mode:navigate",
      "Sec-Fetch-Dest:document",
    ],
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
          const fallbackResult = await youtubedl(`ytsearch1:${fallbackQuery}`, {
            dumpSingleJson: true,
            noWarnings: true,
            noCheckCertificates: true,
            skipDownload: true,
            ...antiDetectionOpts,
          });
          const entry = fallbackResult.entries?.[0] || fallbackResult;

          if (entry && entry.title) {
            return {
              type: "song",
              name: spotifyTrack.name,
              url:
                entry.webpage_url ||
                `https://www.youtube.com/watch?v=${entry.id}`,
              duration: parseInt(entry.duration) || 0,
              formattedDuration: formatDuration(parseInt(entry.duration) || 0),
              thumbnail:
                spotifyTrack.album?.images?.[0]?.url || entry.thumbnail,
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
        duration: parseInt(info.duration) || youtubeVideo.duration || 0,
        formattedDuration: formatDuration(
          parseInt(info.duration) || youtubeVideo.duration || 0,
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
    const searchResult = await youtubedl(`ytsearch1:${query}`, {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true,
      noCheckCertificates: true,
      ...antiDetectionOpts,
    });
    const entry = searchResult.entries?.[0] || searchResult;
    if (!entry || !entry.title) return null;

    return {
      type: "song",
      name: entry.title,
      url: entry.webpage_url || `https://youtube.com/watch?v=${entry.id}`,
      duration: parseInt(entry.duration) || 0,
      formattedDuration: formatDuration(parseInt(entry.duration) || 0),
      thumbnail:
        entry.thumbnail || entry.thumbnails?.[entry.thumbnails.length - 1]?.url,
      author: entry.uploader || entry.channel || "Unknown",
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
              `${e("MUSIC")} **Spotify Converter**: Added ${convertedCount}/${remainingTracks.length} tracks to queue`,
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

    if (!client.getQueue(queue.guildId)) {
      break;
    }
  }

  if (convertedCount > 0) {
    textChannel
      .send(
        `${e("SUCCESS")} **Spotify Converter Complete**: Added ${convertedCount} tracks, ${failedCount} failed`,
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
  await initEmojis(readyClient);
  log.info(`Remani Music Bot is online!`);
  log.info(`Logged in as ${readyClient.user.tag}`);
  log.info(`Serving ${readyClient.guilds.cache.size} servers`);

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

  client.user.setActivity(pickIdlePhrase(), { type: ActivityType.Listening });

  setInterval(() => {
    if (!client.queues.size) {
      const phrase = pickIdlePhrase();
      client.user.setActivity(phrase, { type: ActivityType.Listening });
      const guild = client.guilds.cache.first();
      const botChannel = guild?.members?.me?.voice?.channelId;
      if (botChannel) {
        client.rest
          .put(`/channels/${botChannel}/voice-status`, {
            body: { status: phrase },
          })
          .catch(() => {});
      }
    }
  }, 120_000);

  setInterval(() => {
    const status = `✅ Bot alive | ${client.guilds.cache.size} servers | ${client.queues.size} active queues`;
    console.log(status);
  }, 300000);
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
        flags: 64,
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
      content: `${e("ERROR")} Nothing is playing right now.`,
      flags: 64,
    });
  }

  const member = interaction.member;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel || voiceChannel.id !== queue.voiceChannel.id) {
    return interaction.followUp({
      content: `${e("ERROR")} You need to be in the same voice channel.`,
      flags: 64,
    });
  }

  try {
    switch (interaction.customId) {
      case "music_pause":
        if (queue.paused) {
          queue.resume();
          await interaction.followUp({
            content: `${e("PLAY")} Resumed the music.`,
            flags: 64,
          });
        } else {
          queue.pause();
          await interaction.followUp({
            content: `${e("PAUSE")} Paused the music.`,
            flags: 64,
          });
        }
        break;

      case "music_skip":
        queue.skip();
        await interaction.followUp({
          content: `${e("SKIP")} Skipped the current song.`,
          flags: 64,
        });
        break;

      case "music_stop":
        queue.stop();
        await interaction.followUp({
          content: `${e("STOP")} Stopped the music and cleared the queue.`,
          flags: 64,
        });
        break;

      case "music_shuffle":
        queue.shuffle();
        await interaction.followUp({
          content: `${e("SHUFFLE")} Shuffled the queue.`,
          flags: 64,
        });
        break;

      case "music_loop":
        const modes = ["Off", "Song", "Queue"];
        const nextMode = (queue.repeatMode + 1) % 3;
        queue.setRepeatMode(nextMode);
        await interaction.followUp({
          content: `${e("LOOP")} Loop mode: **${modes[nextMode]}**`,
          flags: 64,
        });
        break;

      case "music_previous":
        await interaction.followUp({
          content: `${e("PREVIOUS")} Previous track not available.`,
          flags: 64,
        });
        break;

      case "music_queue":
        const songs = queue.songs.slice(0, 10);
        const playIcon = e("PLAY");
        const queueIcon = e("QUEUE");
        const queueList = songs
          .map(
            (song, i) =>
              `${i === 0 ? `**${playIcon} Now:**` : `**${i}.**`} [${song.name}](${song.url}) - \`${song.formattedDuration}\``,
          )
          .join("\n");
        const qContainer = new ContainerBuilder().setAccentColor(0x00ffff);
        qContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${queueIcon} **Queue** (${queue.songs.length} songs)\n\n${queueList}`,
          ),
        );
        await interaction.followUp({
          components: [qContainer],
          flags: MessageFlags.IsComponentsV2 | 64,
        });
        break;

      case "music_voldown":
        const newVolDown = Math.max(0, queue.volume - 10);
        queue.setVolume(newVolDown);
        await interaction.followUp({
          content: `${e("VOLDOWN")} Volume: **${newVolDown}%**`,
          flags: 64,
        });
        break;

      case "music_volup":
        const newVolUp = Math.min(100, queue.volume + 10);
        queue.setVolume(newVolUp);
        await interaction.followUp({
          content: `${e("VOLUP")} Volume: **${newVolUp}%**`,
          flags: 64,
        });
        break;

      case "music_refresh":
        await interaction.followUp({
          content: `${e("REFRESH")} Music controller refreshed!`,
          flags: 64,
        });
        break;

      default:
        await interaction.followUp({
          content: `${e("WARNING")} Unknown button action.`,
          flags: 64,
        });
    }

    await updateMusicController(interaction, queue);
  } catch (error) {
    console.error("Button interaction error:", error);
    try {
      await interaction.followUp({
        content: `${e("ERROR")} An error occurred.`,
        flags: 64,
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

    const controller = createCompleteMusicController(queue);

    if (controller && interaction.message) {
      await interaction.message.edit({
        embeds: [],
        components: controller.components,
        flags: controller.flags,
      });
    }
  } catch (error) {
    if (error.code === 10008) {
      console.log("Message was deleted - cannot update music controller");

      const panelData = client.musicPanels.get(queue.guildId);
      if (
        panelData &&
        panelData.message &&
        panelData.message.id === interaction.message.id
      ) {
        client.musicPanels.delete(queue.guildId);
      }
    } else if (error.code === 10062) {
      console.log("Interaction expired - cannot update music controller");
    } else {
      console.error("Error updating music controller:", error.message);
    }
  }
}

async function updateMusicPanel(guildId, client) {
  const queue = client.getQueue(guildId);
  if (!queue) return;

  await queue.updateMusicPanel();
}

client.on("error", (err) => log.error("Client error:", err));

function startMainBot() {
  if (!process.env.DISCORD_TOKEN) {
    log.error("DISCORD_TOKEN is not set in .env file!");
    process.exit(1);
  }

  require("./api")(client);

  return client.login(process.env.DISCORD_TOKEN);
}

module.exports = {
  startMainBot,
  client,
  MusicQueue,
  searchSong,
  handleButtonInteraction,
  updateMusicController,
  formatDuration,
  youtubedl,
  ytdlpBinaryPath,
};
