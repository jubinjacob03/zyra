require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, ActivityType, EmbedBuilder } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    NoSubscriberBehavior,
    StreamType
} = require('@discordjs/voice');
const play = require('play-dl');
const youtubedlExec = require('youtube-dl-exec');
const youtube = require('youtube-sr').default;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createMusicPanel, createNowPlayingEmbed, createProgressBar, formatDuration } = require('./utils/embed');
const SpotifyAPI = require('./utils/spotify');
const YouTubeSearchEngine = require('./utils/youtubeSearch');

// Cross-platform yt-dlp configuration
// Windows: Use WinGet system installation (no spaces in path)
// Linux/Mac: Use bundled binary from youtube-dl-exec or system yt-dlp
let youtubedl;
if (os.platform() === 'win32') {
    const systemYtdlp = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe');
    if (fs.existsSync(systemYtdlp)) {
        youtubedl = youtubedlExec.create(systemYtdlp);
        console.log('✅ Using system yt-dlp (Windows)');
    } else {
        youtubedl = youtubedlExec;
        console.log('⚠️ Using bundled yt-dlp');
    }
} else {
    // Linux/Mac: Try system yt-dlp first (for Railway/production), then bundled
    const systemYtdlp = '/root/.nix-profile/bin/yt-dlp';
    if (fs.existsSync(systemYtdlp)) {
        youtubedl = youtubedlExec.create(systemYtdlp);
        console.log('✅ Using system yt-dlp (Nix)');
    } else {
        youtubedl = youtubedlExec;
        console.log('✅ Using bundled yt-dlp (Linux/Mac)');
    }
}

const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

// Global error handlers for cleaner logs
process.on('unhandledRejection', (reason, promise) => {
    // Only log non-yt-dlp errors and non-Discord API errors
    if (reason && typeof reason === 'object') {
        if (reason.command && reason.command.includes('yt-dlp')) {
            // Suppress yt-dlp broken pipe errors - they're expected when audio completes
            return;
        }
        if (reason.code === 10008 || reason.code === 10062) {
            // Suppress Discord API errors for deleted messages/expired interactions
            console.log(`Discord API: ${reason.code === 10008 ? 'Message deleted' : 'Interaction expired'}`);
            return;
        }
    }
    console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
    // Only log non-yt-dlp errors
    if (error.message && error.message.includes('yt-dlp')) {
        return;
    }
    console.error('Uncaught exception:', error);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
    ],
});

// Initialize bot collections
client.commands = new Collection();
client.queues = new Map();
client.musicPanels = new Map();

// Initialize Spotify API if credentials are provided
let spotifyAPI = null;
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    spotifyAPI = new SpotifyAPI(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
    console.log('✅ Spotify API initialized');
} else {
    console.log('⚠️ Spotify credentials not found - Spotify features disabled');
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
        this.songs = [];
        this.volume = 50;
        this.playing = false;
        this.paused = false;
        this.repeatMode = 0; 
        this.player = createAudioPlayer({
            behaviors: { 
                noSubscriber: NoSubscriberBehavior.Play,
                maxMissedFrames: Math.round(5000 / 20) // Allow up to 5 seconds of missed frames
            }
        });
        this.currentResource = null;
        
        this.connection.subscribe(this.player);
        this.setupPlayerEvents();
    }

    /**
     * Setup audio player event listeners
     * Handles song transitions and playback errors
     */
    setupPlayerEvents() {
        this.player.on(AudioPlayerStatus.Idle, () => {
            // Only process queue if we were actually playing something
            if (this.playing && this.currentResource) {
                this.processQueue();
            }
        });

        this.player.on('error', error => {
            console.error('Player error:', error);
            this.textChannel.send(`❌ Player error: ${error.message}`).catch(console.error);
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

        const song = this.songs[0];
        this.playing = true;
        this.paused = false;

        try {
            const ytdlpProcess = youtubedl.exec(song.url, {
                output: '-',
                quiet: true,
                noWarnings: true,
                // Optimized format for streaming - prefer opus audio for Discord
                format: 'bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio',
                noPlaylist: true,
                geoBypass: true,
                noCheckCertificates: true,
                addHeader: [
                    'referer:youtube.com',
                    'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                ],
                extractorArgs: 'youtube:player_client=android',
                // Add buffer size for smoother streaming
                bufferSize: '16K',
                httpChunkSize: '10M',
                ...(fs.existsSync('./cookies.txt') && { cookies: './cookies.txt' })
            });
            
            // Suppress stderr to avoid broken pipe warnings
            ytdlpProcess.stderr?.on('data', () => {});
            
            // Create audio resource with optimized buffering to reduce glitching
            this.currentResource = createAudioResource(ytdlpProcess.stdout, {
                metadata: song,
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });
            
            this.currentResource.volume.setVolume(this.volume / 100);
            
            this.player.play(this.currentResource);
            
            // Send clean music controller embed
            const { createCompleteMusicController } = require('./utils/componentsV2');
            const controller = createCompleteMusicController(this);
            const message = await this.textChannel.send(controller);
            
            // Clean up old panel before setting new one
            const oldPanel = client.musicPanels.get(this.guildId);
            if (oldPanel?.message) {
                try { 
                    await oldPanel.message.delete(); 
                } catch (error) {
                    // Ignore deletion errors (message might already be deleted)
                    console.log('Could not delete old music panel - it may have been already deleted');
                }
            }
            
            client.musicPanels.set(this.guildId, { message, song, startTime: Date.now() });
            console.log('🎵 Now playing:', song.name);
            
            // Start real-time progress updates via WebSocket
            this.startProgressUpdates();
            
        } catch (error) {
            this.textChannel.send(`❌ Error playing **${song.name}**: ${error.message}`);
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
                console.log('🎵 Queue finished');
                this.textChannel.send('🎵 Queue finished. Add more songs to keep the party going!');
                this.stop();
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
        
        // Stop progress updates
        this.stopProgressUpdates();
        
        if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            try {
                this.connection.destroy();
            } catch (error) {
                console.error('Error destroying connection:', error);
            }
        }
        
        client.queues.delete(this.guildId);
        client.musicPanels.delete(this.guildId);
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
        // Clear any existing interval
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
                console.error('Error in progress update:', error.message);
                // Stop updates if there's a persistent error
                clearInterval(this.progressInterval);
                this.progressInterval = null;
            }
        }, 5000); // Update every 5 seconds
    }

    /**
     * Update the music panel embed with current progress
     */
    async updateMusicPanel() {
        const panelData = client.musicPanels.get(this.guildId);
        if (!panelData?.message || !this.songs[0]) return;

        try {
            // Check if message still exists before updating
            await panelData.message.fetch();
            
            const { embed, components } = createMusicPanel(this);
            
            // Calculate current progress
            const elapsed = this.playing && !this.paused ? 
                Math.floor((Date.now() - (panelData.startTime || Date.now())) / 1000) : 0;
            const song = this.songs[0];
            const progressBar = createProgressBar(elapsed, song.duration || 100, 15);
            
            // Update embed description with live progress
            const volumeIcon = this.volume > 66 ? '🔊' : this.volume > 33 ? '🔉' : '🔈';
            const loopModes = ['Off', '🔂 Song', '🔁 Queue'];
            
            embed.setDescription(`**${song.author || 'Unknown Artist'}**\n\n` +
                `⏱️ \`${formatDuration(elapsed)} ${progressBar} ${song.formattedDuration}\`\n` +
                `👤 ${song.user?.displayName || song.user?.username || 'Unknown'}\n` +
                `${volumeIcon} \`${this.volume}%\` • ${loopModes[this.repeatMode]} • \`${this.songs.length} songs\``
            );

            await panelData.message.edit({ embeds: [embed], components });
        } catch (error) {
            // Handle specific Discord API errors
            if (error.code === 10008) {
                // Message was deleted, clean up
                console.log('Music panel message was deleted - cleaning up');
                client.musicPanels.delete(this.guildId);
                this.stopProgressUpdates();
            } else if (error.code === 10003) {
                // Unknown channel, clean up
                console.log('Music panel channel not found - cleaning up');
                client.musicPanels.delete(this.guildId);
                this.stopProgressUpdates();
            } else {
                console.error('Error updating music panel:', error.message);
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
client.createQueue = async function(guildId, textChannel, voiceChannel) {
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
        console.error('Voice connection failed:', error);
        throw new Error('Failed to connect to voice channel');
    }

    const queue = new MusicQueue(guildId, textChannel, voiceChannel, connection);
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
client.getQueue = function(guildId) {
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
    // Add timeout to prevent hanging - increased to 60 seconds for mobile devices
    return Promise.race([
        searchSongInternal(query, user),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Search timeout - please try again or use a direct YouTube link')), 60000)
        )
    ]);
}

async function searchSongInternal(query, user) {
    const videoPattern = /^(https?:\/\/)?(www\.)?(m\.|music\.)?(youtube\.com|youtu\.?be)\/.+$/;
    const playlistPattern = /^.*(list=)([^#\&\?]*).*/;
    
    // YouTube Mix playlist patterns (user-specific, cannot be accessed)
    const mixPlaylistPattern = /[?&]list=(RD[A-Za-z0-9_-]+|RDMM[A-Za-z0-9_-]+|RDAMPL[A-Za-z0-9_-]+|RDCLAK[A-Za-z0-9_-]+)/;
    
    // Spotify URL patterns
    const spotifyTrackPattern = /spotify\.com\/track\/([a-zA-Z0-9]+)/;
    const spotifyPlaylistPattern = /spotify\.com\/playlist\/([a-zA-Z0-9]+)/;
    const spotifyAlbumPattern = /spotify\.com\/album\/([a-zA-Z0-9]+)/;
    
    // Check for YouTube Mix playlists first
    if (mixPlaylistPattern.test(query)) {
        throw new Error('❌ **YouTube Mix playlists are not supported**\n\n' +
            '🔒 Mix playlists are personalized and user-specific - they cannot be accessed by bots.\n\n' +
            '💡 **Alternatives:**\n' +
            '• Use a regular YouTube playlist instead\n' +
            '• Search for individual songs\n' +
            '• Create a custom playlist with your favorite tracks');
    }
    
    // Cookie options for yt-dlp
    const cookieOpts = fs.existsSync('./cookies.txt') ? { cookies: './cookies.txt' } : {};
    
    // Handle Spotify Track URLs
    if (spotifyTrackPattern.test(query) && spotifyAPI) {
        try {
            const trackId = SpotifyAPI.extractSpotifyId(query, 'track');
            
            const spotifyTrack = await spotifyAPI.getTrack(trackId);
            
            const youtubeVideo = await YouTubeSearchEngine.findBestMatch(spotifyTrack);
            
            if (!youtubeVideo) {
                // Fallback to direct YouTube search
                const fallbackQuery = `${spotifyTrack.name} ${spotifyTrack.artists[0]?.name}`;
                
                try {
                    const fallbackResult = await youtube.searchOne(fallbackQuery);
                    
                    if (fallbackResult) {
                        const info = await youtubedl(fallbackResult.url, {
                            dumpSingleJson: true,
                            noWarnings: true,
                            noCheckCertificates: true,
                            skipDownload: true,
                            ...cookieOpts
                        });
                        
                        return {
                            type: 'song',
                            name: spotifyTrack.name,
                            url: info.webpage_url || fallbackResult.url,
                            duration: parseInt(info.duration) || fallbackResult.duration || 0,
                            formattedDuration: formatDuration(parseInt(info.duration) || fallbackResult.duration || 0),
                            thumbnail: spotifyTrack.album?.images?.[0]?.url || info.thumbnail,
                            author: spotifyTrack.artists.map(a => a.name).join(', '),
                            user: user,
                            spotifyData: {
                                originalUrl: query,
                                trackId: trackId,
                                isSpotify: true,
                                fallbackUsed: true
                            }
                        };
                    }
                } catch (fallbackError) {
                    // Silent fallback failure
                }
                
                throw new Error('Could not find a matching YouTube video for this Spotify track');
            }
            
            // Get detailed info using yt-dlp
            const info = await youtubedl(youtubeVideo.url, {
                dumpSingleJson: true,
                noWarnings: true,
                noCheckCertificates: true,
                skipDownload: true,
                ...cookieOpts
            });
            
            return {
                type: 'song',
                name: spotifyTrack.name,
                url: info.webpage_url || youtubeVideo.url,
                duration: parseInt(info.duration) || youtubeVideo.correctedDuration || youtubeVideo.duration || 0,
                formattedDuration: formatDuration(parseInt(info.duration) || youtubeVideo.correctedDuration || youtubeVideo.duration || 0),
                thumbnail: spotifyTrack.album?.images?.[0]?.url || info.thumbnail,
                author: spotifyTrack.artists.map(a => a.name).join(', '),
                user: user,
                spotifyData: {
                    originalUrl: query,
                    trackId: trackId,
                    isSpotify: true
                }
            };
        } catch (error) {
            // For single tracks, try fallback search before giving up
            if (error.message.includes('Could not find a matching YouTube video')) {
                try {
                    const trackId = SpotifyAPI.extractSpotifyId(query, 'track');
                    const spotifyTrack = await spotifyAPI.getTrack(trackId);
                    const fallbackQuery = `${spotifyTrack.name} ${spotifyTrack.artists[0]?.name}`;
                    
                    const fallbackResult = await youtube.searchOne(fallbackQuery);
                    if (fallbackResult) {
                        const info = await youtubedl(fallbackResult.url, {
                            dumpSingleJson: true,
                            noWarnings: true,
                            noCheckCertificates: true,
                            skipDownload: true,
                            ...cookieOpts
                        });
                        
                        return {
                            type: 'song',
                            name: spotifyTrack.name,
                            url: info.webpage_url || fallbackResult.url,
                            duration: parseInt(info.duration) || fallbackResult.duration || 0,
                            formattedDuration: formatDuration(parseInt(info.duration) || fallbackResult.duration || 0),
                            thumbnail: spotifyTrack.album?.images?.[0]?.url || info.thumbnail,
                            author: spotifyTrack.artists.map(a => a.name).join(', '),
                            user: user,
                            spotifyData: {
                                originalUrl: query,
                                trackId: trackId,
                                isSpotify: true,
                                fallbackUsed: true
                            }
                        };
                    }
                } catch (fallbackError) {
                    // Silent fallback failure
                }
            }
            throw new Error(`Unable to find this Spotify track on YouTube. Try a different song or search manually.`);
        }
    }
    
    // Handle Spotify Playlist URLs
    if (spotifyPlaylistPattern.test(query) && spotifyAPI) {
        try {
            const playlistId = SpotifyAPI.extractSpotifyId(query, 'playlist');
            
            const { tracks, playlistInfo } = await spotifyAPI.getPlaylistTracks(playlistId);
            
            if (!tracks || tracks.length === 0) {
                throw new Error('Spotify playlist is empty or contains no playable tracks');
            }
            
            // Convert first few tracks immediately, rest in background
            const immediateConversions = Math.min(tracks.length, 3);
            const convertedSongs = [];
            
            for (let i = 0; i < immediateConversions; i++) {
                const track = tracks[i].track;
                console.log(`🎵 Converting track ${i+1}: "${track.name}" by ${track.artists.map(a => a.name).join(', ')}`);
                try {
                    const youtubeVideo = await YouTubeSearchEngine.findBestMatch(track);
                    if (youtubeVideo) {
                        console.log(`✅ Successfully converted: "${track.name}"`);
                        convertedSongs.push({
                            name: track.name,
                            url: youtubeVideo.url,
                            duration: youtubeVideo.duration || 0,
                            formattedDuration: formatDuration(youtubeVideo.duration || 0),
                            thumbnail: track.album?.images?.[0]?.url || youtubeVideo.thumbnail,
                            author: track.artists.map(a => a.name).join(', '),
                            user: user,
                            spotifyData: {
                                originalUrl: track.external_urls?.spotify,
                                trackId: track.id,
                                isSpotify: true
                            }
                        });
                    } else {
                        // Silent failure for immediate conversions
                    }
                } catch (error) {
                    // Silent failure for immediate conversions
                }
            }
            
            if (convertedSongs.length === 0) {
                throw new Error('Could not convert any tracks from the Spotify playlist');
            }
            
            console.log(`✅ Successfully converted ${convertedSongs.length}/${immediateConversions} immediate tracks`);
            
            return {
                type: 'playlist',
                name: playlistInfo.name || 'Spotify Playlist',
                url: query,
                thumbnail: playlistInfo.images?.[0]?.url,
                songs: convertedSongs,
                spotifyData: {
                    playlistId: playlistId,
                    totalTracks: tracks.length,
                    remainingTracks: tracks.slice(immediateConversions),
                    isSpotify: true
                }
            };
        } catch (error) {
            throw new Error(`Failed to process Spotify playlist: ${error.message}`);
        }
    }
    
    // Handle Spotify Album URLs
    if (spotifyAlbumPattern.test(query) && spotifyAPI) {
        try {
            const albumId = SpotifyAPI.extractSpotifyId(query, 'album');
            
            const { tracks, albumInfo } = await spotifyAPI.getAlbumTracks(albumId);
            
            if (!tracks || tracks.length === 0) {
                throw new Error('Spotify album is empty or contains no playable tracks');
            }
            
            const convertedSongs = [];
            const maxConversions = Math.min(tracks.length, 10); // Limit for albums
            
            for (let i = 0; i < maxConversions; i++) {
                const track = tracks[i];
                try {
                    // Add album artist info to track for better matching
                    const trackWithAlbumArtist = {
                        ...track,
                        artists: track.artists.length > 0 ? track.artists : albumInfo.artists
                    };
                    
                    const youtubeVideo = await YouTubeSearchEngine.findBestMatch(trackWithAlbumArtist);
                    if (youtubeVideo) {
                        convertedSongs.push({
                            name: track.name,
                            url: youtubeVideo.url,
                            duration: youtubeVideo.duration || 0,
                            formattedDuration: formatDuration(youtubeVideo.duration || 0),
                            thumbnail: albumInfo.images?.[0]?.url || youtubeVideo.thumbnail,
                            author: track.artists.map(a => a.name).join(', ') || albumInfo.artists.map(a => a.name).join(', '),
                            user: user,
                            spotifyData: {
                                originalUrl: track.external_urls?.spotify,
                                trackId: track.id,
                                isSpotify: true
                            }
                        });
                    }
                } catch (error) {
                    // Silent conversion failure for individual tracks
                }
            }
            
            if (convertedSongs.length === 0) {
                throw new Error('Could not convert any tracks from the Spotify album');
            }
            
            return {
                type: 'playlist',
                name: `${albumInfo.name} - ${albumInfo.artists.map(a => a.name).join(', ')}`,
                url: query,
                thumbnail: albumInfo.images?.[0]?.url,
                songs: convertedSongs,
                spotifyData: {
                    albumId: albumId,
                    totalTracks: tracks.length,
                    isSpotify: true
                }
            };
        } catch (error) {
            throw new Error(`Failed to process Spotify album: ${error.message}`);
        }
    }
    
    // Handle YouTube URLs (existing logic)
    if (videoPattern.test(query) && !playlistPattern.test(query)) {
        const info = await youtubedl(query, {
            dumpSingleJson: true,
            noWarnings: true,
            noCheckCertificates: true,
            skipDownload: true,
            ...cookieOpts
        });
        
        return {
            type: 'song',
            name: info.title,
            url: info.webpage_url || query,
            duration: parseInt(info.duration) || 0,
            formattedDuration: formatDuration(parseInt(info.duration) || 0),
            thumbnail: info.thumbnail,
            author: info.uploader || info.channel || 'Unknown',
            user: user,
        };
    } 
    
    // Handle YouTube Playlists (existing logic)
    else if (playlistPattern.test(query)) {
        try {
            const info = await youtubedl(query, {
                dumpSingleJson: true,
                flatPlaylist: true,
                noWarnings: true,
                skipDownload: true,
                ...cookieOpts
            });
            
            const videos = info.entries || [];
            
            // Check if this is actually a Mix playlist that slipped through
            if (videos.length === 0 && (query.includes('RD') || query.includes('RDMM') || query.includes('RDAMPL'))) {
                throw new Error('❌ **YouTube Mix playlists are not supported**\n\n' +
                    '🔒 Mix playlists are personalized and user-specific - they cannot be accessed by bots.\n\n' +
                    '💡 **Alternatives:**\n' +
                    '• Use a regular YouTube playlist instead\n' +
                    '• Search for individual songs\n' +
                    '• Create a custom playlist with your favorite tracks');
            }
            
            if (videos.length === 0) {
                throw new Error('This playlist is empty or cannot be accessed');
            }
            
            return {
                type: 'playlist',
                name: info.title || 'Playlist',
                url: info.webpage_url || query,
                thumbnail: info.thumbnail || videos[0]?.thumbnail,
                songs: videos.slice(0, 50).map(v => ({ 
                    name: v.title,
                    url: v.url || `https://youtube.com/watch?v=${v.id}`,
                    duration: v.duration || 0,
                    formattedDuration: formatDuration(v.duration || 0),
                    thumbnail: v.thumbnail,
                    author: v.uploader || v.channel || 'Unknown',
                    user: user,
                }))
            };
        } catch (error) {
            // Check if this is a Mix playlist error
            if (error.message.includes('Mix playlists are not supported')) {
                throw error; // Re-throw our custom error
            }
            
            // Check for common Mix playlist error patterns from yt-dlp
            if (error.message.includes('Unable to extract') || 
                error.message.includes('playlist does not exist') ||
                error.message.includes('Private playlist') ||
                (query.includes('RD') && error.message.includes('ERROR'))) {
                throw new Error('❌ **YouTube Mix playlists are not supported**\n\n' +
                    '🔒 Mix playlists are personalized and user-specific - they cannot be accessed by bots.\n\n' +
                    '💡 **Alternatives:**\n' +
                    '• Use a regular YouTube playlist instead\n' +
                    '• Search for individual songs\n' +
                    '• Create a custom playlist with your favorite tracks');
            }
            
            throw new Error(`Failed to process YouTube playlist: ${error.message}`);
        }
    } 
    
    // Handle search queries (existing logic with Spotify search option)
    else {
        // If Spotify is available, try Spotify search first for better results
        if (spotifyAPI && !query.startsWith('youtube:') && !query.startsWith('yt:')) {
            try {
                const spotifyResults = await spotifyAPI.searchTracks(query, 3);
                if (spotifyResults && spotifyResults.length > 0) {
                    const bestSpotifyMatch = spotifyResults[0];
                    const youtubeVideo = await YouTubeSearchEngine.findBestMatch(bestSpotifyMatch);
                    
                    if (youtubeVideo) {
                        const info = await youtubedl(youtubeVideo.url, {
                            dumpSingleJson: true,
                            noWarnings: true,
                            skipDownload: true,
                            ...cookieOpts
                        });
                        
                        return {
                            type: 'song',
                            name: bestSpotifyMatch.name,
                            url: info.webpage_url || youtubeVideo.url,
                            duration: parseInt(info.duration) || youtubeVideo.duration || 0,
                            formattedDuration: formatDuration(parseInt(info.duration) || youtubeVideo.duration || 0),
                            thumbnail: bestSpotifyMatch.album?.images?.[0]?.url || info.thumbnail,
                            author: bestSpotifyMatch.artists.map(a => a.name).join(', '),
                            user: user,
                            spotifyData: {
                                originalUrl: bestSpotifyMatch.external_urls?.spotify,
                                trackId: bestSpotifyMatch.id,
                                isSpotify: true,
                                searchQuery: query
                            }
                        };
                    }
                }
            } catch (error) {
                // Silent Spotify search failure, fallback to YouTube
            }
        }
        
        // Fallback to YouTube search (existing logic)
        const result = await youtube.searchOne(query);
        if (!result) return null;
        
        const url = `https://youtube.com/watch?v=${result.id}`;
        const info = await youtubedl(url, {
            dumpSingleJson: true,
            noWarnings: true,
            skipDownload: true,
            ...cookieOpts
        });
        
        return {
            type: 'song',
            name: info.title,
            url: info.webpage_url || url,
            duration: parseInt(info.duration) || 0,
            formattedDuration: formatDuration(parseInt(info.duration) || 0),
            thumbnail: info.thumbnail,
            author: info.uploader || 'Unknown',
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
async function processSpotifyPlaylistBackground(queue, remainingTracks, textChannel) {
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
                    author: track.artists.map(a => a.name).join(', '),
                    user: queue.songs[0]?.user, // Use same user as first song
                    spotifyData: {
                        originalUrl: track.external_urls?.spotify,
                        trackId: track.id,
                        isSpotify: true
                    }
                };
                
                await queue.addSong(song);
                convertedCount++;
                
                // Send progress update every 10 conversions
                if (convertedCount % 10 === 0) {
                    textChannel.send(`🎵 **Spotify Converter**: Added ${convertedCount}/${remainingTracks.length} tracks to queue`).catch(console.error);
                }
            } else {
                failedCount++;
            }
        } catch (error) {
            failedCount++;
        }
        
        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Check if queue still exists
        if (!client.getQueue(queue.guildId)) {
            break;
        }
    }
    
    if (convertedCount > 0) {
        textChannel.send(`✅ **Spotify Converter Complete**: Added ${convertedCount} tracks, ${failedCount} failed`).catch(console.error);
    }
}

client.processSpotifyPlaylistBackground = processSpotifyPlaylistBackground;

// Load all slash commands from commands directory
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    delete require.cache[require.resolve(filePath)];
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`✅ Loaded command: ${command.data.name}`);
    }
}

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`\n🎵 Remani Music Bot is online!`);
    console.log(`📡 Logged in as ${readyClient.user.tag}`);
    console.log(`🌐 Serving ${readyClient.guilds.cache.size} servers\n`);
    
    try {
        const avatarPath = path.join(__dirname, '..', 'assets', 'avatar.jpg');
        if (fs.existsSync(avatarPath)) {
            await client.user.setAvatar(avatarPath);
            console.log('✅ Avatar updated successfully!');
        }
    } catch (error) {
        if (error.code !== 50035) {
            console.log('ℹ️ Avatar already set or rate limited');
        }
    }
    
    client.user.setActivity('🎵 /play to start', { type: ActivityType.Listening });
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}:`, error);
            
            // Handle specific Discord API errors
            const errorMessage = { content: '❌ There was an error executing this command!', flags: 64 };
            
            try {
                if (error.code === 10062) {
                    // Unknown interaction - interaction expired
                    console.log('Interaction expired - cannot respond');
                    return;
                }
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMessage);
                } else {
                    await interaction.reply(errorMessage);
                }
            } catch (replyError) {
                console.error('Failed to send error message:', replyError);
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
    // Use deferUpdate for button interactions to avoid "thinking" state
    try {
        await interaction.deferUpdate();
    } catch (error) {
        console.error('Failed to defer button interaction:', error.message);
        return;
    }
    
    const queue = client.getQueue(interaction.guildId);
    
    if (!queue) {
        return interaction.followUp({ content: '\u274c Nothing is playing right now.', ephemeral: true });
    }

    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    // Verify user is in the same voice channel as bot
    if (!voiceChannel || voiceChannel.id !== queue.voiceChannel.id) {
        return interaction.followUp({ content: '❌ You need to be in the same voice channel.', ephemeral: true });
    }

    try {
        switch (interaction.customId) {
            case 'music_pause':
                if (queue.paused) {
                    queue.resume();
                    await interaction.editReply({ content: '▶️ Resumed the music.' });
                } else {
                    queue.pause();
                    await interaction.editReply({ content: '⏸️ Paused the music.' });
                }
                break;

            case 'music_skip':
                queue.skip();
                await interaction.editReply({ content: '⏭️ Skipped the current song.' });
                break;

            case 'music_stop':
                queue.stop();
                await interaction.editReply({ content: '⏹️ Stopped the music and cleared the queue.' });
                break;

            case 'music_shuffle':
                queue.shuffle();
                await interaction.editReply({ content: '🔀 Shuffled the queue.' });
                break;

            case 'music_loop':
                const modes = ['Off', 'Song', 'Queue'];
                const nextMode = (queue.repeatMode + 1) % 3;
                queue.setRepeatMode(nextMode);
                await interaction.editReply({ content: `🔁 Loop mode: **${modes[nextMode]}**` });
                break;

            case 'music_previous':
                await interaction.editReply({ content: '⏮️ Previous track not available.' });
                break;

            case 'music_queue':
                const songs = queue.songs.slice(0, 10);
                const queueList = songs.map((song, i) => 
                    `${i === 0 ? '**▶️ Now:**' : `**${i}.**`} [${song.name}](${song.url}) - \`${song.formattedDuration}\``
                ).join('\n');
                await interaction.editReply({ 
                    content: `📋 **Queue** (${queue.songs.length} songs)\n\n${queueList}`
                });
                break;

            case 'music_voldown':
                const newVolDown = Math.max(0, queue.volume - 10);
                queue.setVolume(newVolDown);
                await interaction.editReply({ content: `🔉 Volume: **${newVolDown}%**` });
                break;

            case 'music_volup':
                const newVolUp = Math.min(100, queue.volume + 10);
                queue.setVolume(newVolUp);
                await interaction.editReply({ content: `🔊 Volume: **${newVolUp}%**` });
                break;

            case 'music_refresh':
                await interaction.followUp({ content: '🔄 Music controller refreshed!', ephemeral: true });
                break;

            default:
                await interaction.followUp({ content: '❓ Unknown button action.', ephemeral: true });
        }
        
        // Update the music controller after any action (with error handling)
        await updateMusicController(interaction, queue);
    } catch (error) {
        console.error('Button interaction error:', error);
        try {
            await interaction.followUp({ content: '❌ An error occurred.', ephemeral: true });
        } catch (replyError) {
            console.error('Failed to send error message:', replyError);
        }
    }
}

/**
 * Update the music controller after button interactions
 */
async function updateMusicController(interaction, queue) {
    try {
        // Check if the original message still exists
        if (!interaction.message || !interaction.message.id) {
            console.log('No message to update - interaction message not found');
            return;
        }

        const { createCompleteMusicController } = require('./utils/componentsV2');
        const controller = createCompleteMusicController(queue);
        
        if (controller && interaction.message) {
            // Update the original message with new controller state
            await interaction.message.edit({
                embeds: controller.embeds,
                components: controller.components
            });
        }
    } catch (error) {
        // Handle specific Discord API errors
        if (error.code === 10008) {
            console.log('Message was deleted - cannot update music controller');
            // Clean up the music panel reference
            const panelData = client.musicPanels.get(queue.guildId);
            if (panelData && panelData.message && panelData.message.id === interaction.message.id) {
                client.musicPanels.delete(queue.guildId);
            }
        } else if (error.code === 10062) {
            console.log('Interaction expired - cannot update music controller');
        } else {
            console.error('Error updating music controller:', error.message);
        }
    }
}

async function updateMusicPanel(guildId, client) {
    const queue = client.getQueue(guildId);
    if (!queue) return;
    
    // Use the queue's built-in update method for real-time updates
    await queue.updateMusicPanel();
}

client.on('error', console.error);

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in .env file!');
    process.exit(1);
}

// Validate Spotify credentials if provided
if (process.env.SPOTIFY_CLIENT_ID && !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ SPOTIFY_CLIENT_SECRET is required when SPOTIFY_CLIENT_ID is provided!');
    process.exit(1);
}

if (!process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ SPOTIFY_CLIENT_ID is required when SPOTIFY_CLIENT_SECRET is provided!');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
