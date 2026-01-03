require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, ActivityType } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    NoSubscriberBehavior
} = require('@discordjs/voice');
const play = require('play-dl');
const youtubedlExec = require('youtube-dl-exec');
const youtube = require('youtube-sr').default;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createMusicPanel, createNowPlayingEmbed } = require('./utils/embed');

// Cross-platform yt-dlp configuration
// Windows: Use WinGet system installation (no spaces in path)
// Linux/Mac (Render/Railway): Use bundled binary from youtube-dl-exec
let youtubedl;
if (os.platform() === 'win32') {
    // Windows: Try system installation first
    const systemYtdlp = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe');
    if (fs.existsSync(systemYtdlp)) {
        youtubedl = youtubedlExec.create(systemYtdlp);
        console.log('✅ Using system yt-dlp (Windows)');
    } else {
        // Fallback for Windows without WinGet installation
        youtubedl = youtubedlExec;
        console.log('⚠️ Using bundled yt-dlp');
    }
} else {
    // Linux/Mac: Use bundled binary (works on Render/Railway)
    youtubedl = youtubedlExec;
    console.log('✅ Using bundled yt-dlp (Linux/Mac)');
}

const ffmpegPath = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegPath;

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
        this.repeatMode = 0; // 0: Off, 1: Single, 2: Queue
        this.player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Play }
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
        // Handle song completion and queue progression
        this.player.on(AudioPlayerStatus.Idle, () => {
            this.processQueue();
        });

        // Handle playback errors gracefully
        this.player.on('error', error => {
            console.error('Player error:', error);
            this.textChannel.send(`❌ Player error: ${error.message}`);
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
            // Extract stream URL using yt-dlp (bypasses YouTube restrictions)
            const ytdlpOptions = {
                dumpSingleJson: true,
                noCheckCertificates: true,
                noWarnings: true,
                preferFreeFormats: true,
                youtubeSkipDashManifest: true,
                format: 'bestaudio[ext=webm]/bestaudio/best',
                addHeader: [
                    'referer:youtube.com',
                    'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ],
                extractorArgs: 'youtube:player_client=android,web;player_skip=webpage,configs',
                noPlaylist: true,
                // Add geo bypass
                geoBypass: true,
                // Use OAuth if available
                username: 'oauth2',
                password: ''
            };
            
            const streamUrl = await youtubedl(song.url, ytdlpOptions).then(info => {
                // Prefer audio-only format for better performance
                const format = info.formats.find(f => f.acodec !== 'none' && !f.vcodec) || 
                              info.formats.find(f => f.acodec !== 'none');
                return format?.url || info.url;
            });
            
            console.log('✅ Stream URL obtained from yt-dlp');
            
            // Create audio resource with volume control
            this.currentResource = createAudioResource(streamUrl, {
                metadata: song,
                inlineVolume: true
            });
            this.currentResource.volume.setVolume(this.volume / 100);
            
            console.log('✅ Playing audio resource...');
            this.player.play(this.currentResource);
            
            // Send or update music panel UI
            console.log('✅ Sending music panel...');
            const { embed, components } = createMusicPanel(this);
            const message = await this.textChannel.send({ embeds: [embed], components });
            
            // Clean up old music panel
            const oldPanel = client.musicPanels.get(this.guildId);
            if (oldPanel?.message) {
                try { await oldPanel.message.delete(); } catch {}
            }
            client.musicPanels.set(this.guildId, { message, song });
            console.log('🎵 Now playing:', song.name);
            
        } catch (error) {
            console.error('Play error:', error);
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
            // Repeat single song
            this.play();
        } else {
            if (this.repeatMode === 2 && this.songs.length > 0) {
                // Queue repeat: move current song to end
                this.songs.push(this.songs.shift());
            } else {
                // Normal mode: remove played song
                this.songs.shift();
            }
            
            if (this.songs.length === 0) {
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
        
        // Only destroy connection if it's not already destroyed
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
 * Format seconds into human-readable duration
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (HH:MM:SS or MM:SS)
 */
function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
    
    // Handle network disconnections with automatic reconnection
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
        } catch {
            // Connection couldn't be re-established, clean up
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
 * Search for YouTube videos or playlists
 * Handles direct URLs, playlists, and search queries
 * @param {string} query - YouTube URL or search term
 * @param {GuildMember} user - User who requested the song
 * @returns {Promise<Object|null>} Song/playlist object or null
 */
async function searchSong(query, user) {
    const videoPattern = /^(https?:\/\/)?(www\.)?(m\.|music\.)?(youtube\.com|youtu\.?be)\/.+$/;
    const playlistPattern = /^.*(list=)([^#\&\?]*).*/;
    
    // Direct YouTube video URL
    if (videoPattern.test(query) && !playlistPattern.test(query)) {
        const songInfo = await play.video_basic_info(query);
        
        return {
            type: 'song',
            name: songInfo.video_details.title,
            url: songInfo.video_details.url,
            duration: parseInt(songInfo.video_details.durationInSec),
            formattedDuration: formatDuration(parseInt(songInfo.video_details.durationInSec)),
            thumbnail: songInfo.video_details.thumbnails[0]?.url,
            author: songInfo.video_details.channel?.name || 'Unknown',
            user: user,
        };
    } else if (playlistPattern.test(query)) {
        // YouTube playlist URL
        const playlist = await play.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();
        return {
            type: 'playlist',
            name: playlist.title,
            url: playlist.url,
            thumbnail: playlist.thumbnail?.url,
            songs: videos.map(v => ({
                name: v.title,
                url: v.url,
                duration: v.durationInSec,
                formattedDuration: formatDuration(v.durationInSec),
                thumbnail: v.thumbnails[0]?.url,
                author: v.channel?.name || 'Unknown',
                user: user,
            }))
        };
    } else {
        // Search query - use youtube-sr for searching
        const result = await youtube.searchOne(query);
        if (!result) return null;
        
        // Get full video info
        const songInfo = await play.video_basic_info(`https://youtube.com/watch?v=${result.id}`);
        
        return {
            type: 'song',
            name: songInfo.video_details.title,
            url: songInfo.video_details.url,
            duration: parseInt(songInfo.video_details.durationInSec),
            formattedDuration: formatDuration(parseInt(songInfo.video_details.durationInSec)),
            thumbnail: songInfo.video_details.thumbnails[0]?.url,
            author: songInfo.video_details.channel?.name || 'Unknown',
            user: user,
        };
    }
}

// Attach helper functions to client for global access
client.searchSong = searchSong;
client.formatDuration = formatDuration;

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
    console.log(`\n🎵 Zyra Music Bot is online!`);
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
            const errorMessage = { content: '❌ There was an error executing this command!', flags: 64 };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    }

    // Handle music panel button interactions
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
    const queue = client.getQueue(interaction.guildId);
    
    if (!queue) {
        return interaction.reply({ content: '\u274c Nothing is playing right now.', flags: 64 });
    }

    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    // Verify user is in the same voice channel as bot
    if (!voiceChannel || voiceChannel.id !== queue.voiceChannel.id) {
        return interaction.reply({ content: '❌ You need to be in the same voice channel.', flags: 64 });
    }

    try {
        switch (interaction.customId) {
            case 'music_pause':
                if (queue.paused) {
                    queue.resume();
                    await interaction.reply({ content: '▶️ Resumed the music.', flags: 64 });
                } else {
                    queue.pause();
                    await interaction.reply({ content: '⏸️ Paused the music.', flags: 64 });
                }
                break;

            case 'music_skip':
                queue.skip();
                await interaction.reply({ content: '⏭️ Skipped the current song.', flags: 64 });
                break;

            case 'music_stop':
                queue.stop();
                await interaction.reply({ content: '⏹️ Stopped the music and cleared the queue.', flags: 64 });
                break;

            case 'music_shuffle':
                queue.shuffle();
                await interaction.reply({ content: '🔀 Shuffled the queue.', flags: 64 });
                break;

            case 'music_loop':
                const modes = ['Off', 'Song', 'Queue'];
                const nextMode = (queue.repeatMode + 1) % 3;
                queue.setRepeatMode(nextMode);
                await interaction.reply({ content: `🔁 Loop mode: **${modes[nextMode]}**`, flags: 64 });
                break;

            case 'music_previous':
                await interaction.reply({ content: '⏮️ Previous track not available.', flags: 64 });
                break;

            case 'music_queue':
                const songs = queue.songs.slice(0, 10);
                const queueList = songs.map((song, i) => 
                    `${i === 0 ? '**▶️ Now:**' : `**${i}.**`} [${song.name}](${song.url}) - \`${song.formattedDuration}\``
                ).join('\n');
                await interaction.reply({ 
                    content: `📋 **Queue** (${queue.songs.length} songs)\n\n${queueList}`, 
                    flags: 64 
                });
                break;

            case 'music_voldown':
                const newVolDown = Math.max(0, queue.volume - 10);
                queue.setVolume(newVolDown);
                await interaction.reply({ content: `🔉 Volume: **${newVolDown}%**`, flags: 64 });
                break;

            case 'music_volup':
                const newVolUp = Math.min(100, queue.volume + 10);
                queue.setVolume(newVolUp);
                await interaction.reply({ content: `🔊 Volume: **${newVolUp}%**`, flags: 64 });
                break;

            default:
                await interaction.reply({ content: '❓ Unknown button action.', flags: 64 });
        }
        
        await updateMusicPanel(interaction.guildId, client);
    } catch (error) {
        console.error('Button interaction error:', error);
        if (!interaction.replied) {
            await interaction.reply({ content: '❌ An error occurred.', flags: 64 });
        }
    }
}

async function updateMusicPanel(guildId, client) {
    const panelData = client.musicPanels.get(guildId);
    const queue = client.getQueue(guildId);
    
    if (!panelData || !queue || !queue.currentSong) return;

    try {
        const { embed, components } = createMusicPanel(queue);
        await panelData.message.edit({ embeds: [embed], components });
    } catch (error) {
        client.musicPanels.delete(guildId);
    }
}

client.on('error', console.error);
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));

// Simple HTTP server for Render health checks (required for free tier)
const http = require('http');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            bot: client.user?.tag || 'Starting...',
            uptime: process.uptime(),
            guilds: client.guilds.cache.size 
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
    
    // Self-ping every 10 minutes to keep alive 24/7
    if (process.env.RENDER_EXTERNAL_URL) {
        const https = require('https');
        const selfPingUrl = process.env.RENDER_EXTERNAL_URL;
        
        setInterval(() => {
            https.get(`${selfPingUrl}/health`, (res) => {
                console.log(`🏓 Self-ping: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error('Self-ping error:', err.message);
            });
        }, 10 * 60 * 1000); 
        
        console.log('⏰ Self-ping enabled: keeping service alive 24/7');
    }
});

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in .env file!');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
