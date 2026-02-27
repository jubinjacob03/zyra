require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, ActivityType, EmbedBuilder } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');
const fs = require('fs');
const path = require('path');
const { createMusicPanel, createNowPlayingEmbed, createProgressBar, formatDuration } = require('./utils/embed');
const SpotifyAPI = require('./utils/spotify');

process.on('unhandledRejection', (reason) => {
    if (reason && typeof reason === 'object') {
        if (reason.code === 10008 || reason.code === 10062) return;
    }
    console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
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

// Lavalink connection
const lavalinkNodes = [{
    name: 'main',
    url: process.env.LAVALINK_URL || 'localhost:2333',
    auth: process.env.LAVALINK_PASSWORD || 'remani-lavalink'
}];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), lavalinkNodes, {
    moveOnDisconnect: false,
    resume: true,
    resumeTimeout: 30,
    reconnectTries: 10,
    reconnectInterval: 5
});

shoukaku.on('ready', (name) => console.log(`✅ Lavalink node "${name}" connected`));
shoukaku.on('error', (name, error) => console.error(`❌ Lavalink "${name}" error:`, error));
shoukaku.on('close', (name, code, reason) => console.warn(`⚠️ Lavalink "${name}" closed [${code}]: ${reason}`));
shoukaku.on('disconnect', (name, players, moved) => {
    if (!moved) {
        console.warn(`⚠️ Lavalink "${name}" disconnected. Cleaning up ${players.size} players.`);
        for (const [guildId] of players) {
            const queue = client.queues.get(guildId);
            if (queue) queue.stop();
        }
    }
});

client.shoukaku = shoukaku;

function getNode() {
    const node = shoukaku.options.nodeResolver(shoukaku.nodes);
    if (!node) throw new Error('No Lavalink nodes available. The audio server may be starting up — try again in a moment.');
    return node;
}

let spotifyAPI = null;
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    spotifyAPI = new SpotifyAPI(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
    console.log('✅ Spotify API initialized');
} else {
    console.log('⚠️ Spotify credentials not found — Spotify features disabled');
}

class MusicQueue {
    constructor(guildId, textChannel, voiceChannel, player) {
        this.guildId = guildId;
        this.textChannel = textChannel;
        this.voiceChannel = voiceChannel;
        this.player = player;
        this.songs = [];
        this.volume = 50;
        this.playing = false;
        this.paused = false;
        this.repeatMode = 0; // 0: Off, 1: Song, 2: Queue
        this.progressInterval = null;
        this.position = 0; // Current position in seconds (from Lavalink updates)
        this.currentFilter = 'off';

        this.setupPlayerEvents();
    }

    setupPlayerEvents() {
        this.player.on('end', (data) => {
            if (data.reason === 'finished') {
                this.processQueue();
            } else if (data.reason === 'loadFailed') {
                this.textChannel.send('❌ Failed to load track. Skipping...').catch(console.error);
                this.processQueue();
            }
        });

        this.player.on('exception', (data) => {
            console.error('Player exception:', data);
            this.textChannel.send(`❌ Player error: ${data.message || 'Unknown error'}`).catch(console.error);
            this.processQueue();
        });

        this.player.on('stuck', () => {
            console.warn('Player stuck, skipping...');
            this.textChannel.send('⚠️ Track got stuck, skipping...').catch(console.error);
            this.processQueue();
        });

        this.player.on('closed', (data) => {
            if (data.code === 4014) {
                this.textChannel.send('📤 Disconnected from voice channel.').catch(console.error);
                this.stop();
            }
        });

        this.player.on('update', (data) => {
            if (data.state?.position != null) {
                this.position = Math.floor(data.state.position / 1000);
            }
        });
    }

    async addSong(song, position = -1) {
        if (position === -1 || position >= this.songs.length) {
            this.songs.push(song);
        } else {
            this.songs.splice(position, 0, song);
        }
    }

    async addSongs(songs) {
        this.songs.push(...songs);
    }

    async play() {
        if (this.songs.length === 0) {
            this.stop();
            return;
        }

        const song = this.songs[0];
        this.playing = true;
        this.paused = false;
        this.position = 0;

        try {
            this.player.playTrack({ track: { encoded: song.encoded } });
            this.player.setGlobalVolume(this.volume);

            const { createCompleteMusicController } = require('./utils/componentsV2');
            const controller = createCompleteMusicController(this);
            const message = await this.textChannel.send(controller);

            const oldPanel = client.musicPanels.get(this.guildId);
            if (oldPanel?.message) {
                try { await oldPanel.message.delete(); } catch {}
            }

            client.musicPanels.set(this.guildId, { message, song, startTime: Date.now() });
            console.log('🎵 Now playing:', song.name);

            this.startProgressUpdates();
        } catch (error) {
            console.error(`Error playing ${song.name}:`, error);
            this.textChannel.send(`❌ Error playing **${song.name}**: ${error.message}`).catch(console.error);
            this.songs.shift();
            this.processQueue();
        }
    }

    processQueue() {
        this.stopProgressUpdates();

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
                this.textChannel.send('🎵 Queue finished. Add more songs to keep the party going!').catch(console.error);
                this.stop();
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
        this.playing = false;
        this.stopProgressUpdates();

        try {
            this.player.stopTrack();
            shoukaku.leaveVoiceChannel(this.guildId);
        } catch (error) {
            console.error('Error stopping:', error.message);
        }

        client.queues.delete(this.guildId);
        client.musicPanels.delete(this.guildId);
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

    setVolume(vol) {
        this.volume = vol;
        this.player.setGlobalVolume(vol);
    }

    seek(seconds) {
        if (this.songs[0]?.isSeekable) {
            this.player.seekTo(seconds * 1000);
            this.position = seconds;
        }
    }

    setRepeatMode(mode) {
        this.repeatMode = mode;
        this.updateMusicPanel();
    }

    async setFilter(filterName) {
        const filterConfigs = {
            'off': {},
            'bassboost': {
                equalizer: [
                    { band: 0, gain: 0.6 }, { band: 1, gain: 0.7 },
                    { band: 2, gain: 0.8 }, { band: 3, gain: 0.55 },
                    { band: 4, gain: 0.25 }
                ]
            },
            'nightcore': { timescale: { speed: 1.3, pitch: 1.3, rate: 1.0 } },
            'vaporwave': { timescale: { speed: 0.85, pitch: 0.85, rate: 1.0 } },
            'karaoke': { karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220, filterWidth: 100 } },
            'tremolo': { tremolo: { frequency: 4.0, depth: 0.75 } },
            '3d': { rotation: { rotationHz: 0.2 } },
            'phaser': { vibrato: { frequency: 8.0, depth: 0.5 } },
            'surround': { channelMix: { leftToLeft: 1.0, leftToRight: 0.5, rightToLeft: 0.5, rightToRight: 1.0 } }
        };

        const config = filterConfigs[filterName] || {};
        this.player.setFilters(config);
        this.currentFilter = filterName;
    }

    startProgressUpdates() {
        if (this.progressInterval) clearInterval(this.progressInterval);

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
                clearInterval(this.progressInterval);
                this.progressInterval = null;
            }
        }, 5000);
    }

    async updateMusicPanel() {
        const panelData = client.musicPanels.get(this.guildId);
        if (!panelData?.message || !this.songs[0]) return;

        try {
            await panelData.message.fetch();
            const { embed, components } = createMusicPanel(this);

            const elapsed = this.position;
            const song = this.songs[0];
            const progressBar = createProgressBar(elapsed, song.duration || 100, 15);

            const volumeIcon = this.volume > 66 ? '🔊' : this.volume > 33 ? '🔉' : '🔈';
            const loopModes = ['Off', '🔂 Song', '🔁 Queue'];

            embed.setDescription(
                `**${song.author || 'Unknown Artist'}**\n\n` +
                `⏱️ \`${formatDuration(elapsed)} ${progressBar} ${song.formattedDuration}\`\n` +
                `👤 ${song.user?.displayName || song.user?.username || 'Unknown'}\n` +
                `${volumeIcon} \`${this.volume}%\` • ${loopModes[this.repeatMode]} • \`${this.songs.length} songs\``
            );

            await panelData.message.edit({ embeds: [embed], components });
        } catch (error) {
            if (error.code === 10008 || error.code === 10003) {
                client.musicPanels.delete(this.guildId);
                this.stopProgressUpdates();
            }
        }
    }

    stopProgressUpdates() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
            this.progressInterval = null;
        }
    }

    remove(index) {
        if (index > 0 && index < this.songs.length) {
            return this.songs.splice(index, 1)[0];
        }
        return null;
    }

    get currentSong() {
        return this.songs[0] || null;
    }

    get formattedDuration() {
        const total = this.songs.reduce((acc, s) => acc + (s.duration || 0), 0);
        return formatDuration(total);
    }
}

// Queue management

client.createQueue = async function(guildId, textChannel, voiceChannel) {
    const player = await shoukaku.joinVoiceChannel({
        guildId: guildId,
        channelId: voiceChannel.id,
        shardId: 0
    });

    const queue = new MusicQueue(guildId, textChannel, voiceChannel, player);
    this.queues.set(guildId, queue);
    return queue;
};

client.getQueue = function(guildId) {
    return this.queues.get(guildId);
};

// Track search

function trackToSong(track, user) {
    const info = track.info || {};
    return {
        type: 'song',
        name: info.title || 'Unknown',
        url: info.uri || '',
        duration: Math.floor((info.length || 0) / 1000),
        formattedDuration: formatDuration(Math.floor((info.length || 0) / 1000)),
        thumbnail: info.artworkUrl || null,
        author: info.author || 'Unknown',
        user: user,
        encoded: track.encoded,
        isSeekable: info.isSeekable || false,
        sourceName: info.sourceName || 'unknown',
        spotifyData: info.sourceName === 'spotify' ? {
            isSpotify: true,
            originalUrl: info.uri
        } : undefined
    };
}

async function searchSong(query, user) {
    return Promise.race([
        searchSongInternal(query, user),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Search timeout — please try again or use a direct link')), 60000)
        )
    ]);
}

async function searchSongInternal(query, user) {
    const node = getNode();

    // Pattern detection
    const youtubePattern = /^(https?:\/\/)?(www\.)?(m\.|music\.)?(youtube\.com|youtu\.?be)\/.+$/;
    const playlistPattern = /^.*(list=)([^#\&\?]*).*/;
    const spotifyPattern = /spotify\.com\/(track|playlist|album)\//;
    const mixPlaylistPattern = /[?&]list=(RD[A-Za-z0-9_-]+|RDMM[A-Za-z0-9_-]+|RDAMPL[A-Za-z0-9_-]+|RDCLAK[A-Za-z0-9_-]+)/;

    // Block YouTube Mix playlists
    if (mixPlaylistPattern.test(query)) {
        throw new Error('❌ **YouTube Mix playlists are not supported**\n\n' +
            '🔒 Mix playlists are personalized and cannot be accessed by bots.\n\n' +
            '💡 **Alternatives:**\n• Use a regular YouTube playlist\n• Search for individual songs');
    }

    let identifier = query;

    if (spotifyPattern.test(query)) {
        identifier = query;
    } else if (youtubePattern.test(query) || playlistPattern.test(query)) {
        identifier = query;
    } else {
        identifier = `ytmsearch:${query}`;
    }

    // Resolve through Lavalink
    const result = await node.rest.resolve(identifier);
    if (!result) return null;

    switch (result.loadType) {
        case 'track': {
            return trackToSong(result.data, user);
        }

        case 'playlist': {
            const playlist = result.data;
            const tracks = playlist.tracks || [];

            if (tracks.length === 0) {
                throw new Error('Playlist is empty or cannot be accessed');
            }

            return {
                type: 'playlist',
                name: playlist.info?.name || 'Playlist',
                url: query,
                thumbnail: tracks[0]?.info?.artworkUrl || null,
                songs: tracks.slice(0, 200).map(t => trackToSong(t, user)),
                spotifyData: spotifyPattern.test(query) ? {
                    isSpotify: true,
                    totalTracks: tracks.length
                } : undefined
            };
        }

        case 'search': {
            const tracks = result.data;
            if (!tracks || tracks.length === 0) return null;
            return trackToSong(tracks[0], user);
        }

        case 'empty':
            return null;

        case 'error':
            throw new Error(result.data?.message || 'Failed to load track');

        default:
            return null;
    }
}

// Expose search function and utilities to commands and API
client.searchSong = searchSong;
client.formatDuration = formatDuration;

/**
 * Background Spotify playlist converter (fallback for edge cases)
 */
async function processSpotifyPlaylistBackground(queue, remainingTracks, textChannel) {
    if (!remainingTracks || remainingTracks.length === 0) return;

    const node = getNode();
    let convertedCount = 0;
    let failedCount = 0;

    for (const trackData of remainingTracks) {
        const track = trackData.track || trackData;
        const searchQuery = `${track.name} ${track.artists?.[0]?.name || ''}`.trim();

        try {
            const result = await node.rest.resolve(`ytmsearch:${searchQuery}`);
            if (result.loadType === 'search' && result.data.length > 0) {
                const song = trackToSong(result.data[0], queue.songs[0]?.user);
                song.name = track.name;
                song.author = track.artists?.map(a => a.name).join(', ') || song.author;
                song.thumbnail = track.album?.images?.[0]?.url || song.thumbnail;
                await queue.addSong(song);
                convertedCount++;

                if (convertedCount % 10 === 0) {
                    textChannel.send(`🎵 **Converting**: ${convertedCount}/${remainingTracks.length} tracks`).catch(console.error);
                }
            } else {
                failedCount++;
            }
        } catch {
            failedCount++;
        }

        await new Promise(resolve => setTimeout(resolve, 300));
        if (!client.getQueue(queue.guildId)) break;
    }

    if (convertedCount > 0) {
        textChannel.send(`✅ **Complete**: Added ${convertedCount} tracks, ${failedCount} failed`).catch(console.error);
    }
}

client.processSpotifyPlaylistBackground = processSpotifyPlaylistBackground;

// Load slash commands
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
    console.log(`🌐 Serving ${readyClient.guilds.cache.size} servers`);
    console.log(`🎛️ Audio Engine: Lavalink\n`);

    try {
        const avatarPath = path.join(__dirname, '..', 'assets', 'avatar.jpg');
        if (fs.existsSync(avatarPath)) {
            await client.user.setAvatar(avatarPath);
            console.log('✅ Avatar updated');
        }
    } catch (error) {
        if (error.code !== 50035) {
            console.log('ℹ️ Avatar already set or rate limited');
        }
    }

    client.user.setActivity('🎵 /play to start', { type: ActivityType.Listening });

    setInterval(() => {
        console.log(`✅ Bot alive | ${client.guilds.cache.size} servers | ${client.queues.size} active queues`);
    }, 30000);
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
        } catch (error) {
            if (error.code === 10062 || error.code === 40060) return;

            console.error(`Error executing ${interaction.commandName}:`, error);

        try {
            if (interaction.replied) await interaction.followUp(errorMessage);
            else if (interaction.deferred) await interaction.editReply(errorMessage);
            else await interaction.reply(errorMessage);
            } catch (replyError) {
                if (replyError.code !== 10062 && replyError.code !== 40060) {
                    console.error('Failed to send error:', replyError.message);
                }
            }
        }
    }

    if (interaction.isButton()) {
        await handleButtonInteraction(interaction, client);
    }
});

async function handleButtonInteraction(interaction, client) {
    try {
        await interaction.deferUpdate();
    } catch {
        return;
    }

    const queue = client.getQueue(interaction.guildId);
    if (!queue) {
        return interaction.followUp({ content: '❌ Nothing is playing right now.', ephemeral: true });
    }

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel || voiceChannel.id !== queue.voiceChannel.id) {
        return interaction.followUp({ content: '❌ You need to be in the same voice channel.', ephemeral: true });
    }

    try {
        switch (interaction.customId) {
            case 'music_pause':
                if (queue.paused) { queue.resume(); }
                else { queue.pause(); }
                break;

            case 'music_skip':
                queue.skip();
                break;

            case 'music_stop':
                queue.stop();
                break;

            case 'music_shuffle':
                queue.shuffle();
                break;

            case 'music_loop': {
                const nextMode = (queue.repeatMode + 1) % 3;
                queue.setRepeatMode(nextMode);
                break;
            }

            case 'music_previous':
                await interaction.followUp({ content: '⏮️ Previous track not available.', ephemeral: true });
                break;

            case 'music_queue': {
                const songs = queue.songs.slice(0, 10);
                const queueList = songs.map((song, i) =>
                    `${i === 0 ? '**▶️ Now:**' : `**${i}.**`} [${song.name}](${song.url}) - \`${song.formattedDuration}\``
                ).join('\n');
                await interaction.editReply({
                    content: `📋 **Queue** (${queue.songs.length} songs)\n\n${queueList}`
                });
                break;
            }

            case 'music_voldown': {
                const vol = Math.max(0, queue.volume - 10);
                queue.setVolume(vol);
                break;
            }

            case 'music_volup': {
                const vol = Math.min(100, queue.volume + 10);
                queue.setVolume(vol);
                break;
            }

            case 'music_refresh':
                await interaction.followUp({ content: '🔄 Refreshed!', ephemeral: true });
                break;

            default:
                await interaction.followUp({ content: '❓ Unknown action.', ephemeral: true });
        }

        await updateMusicController(interaction, queue);
    } catch (error) {
        console.error('Button error:', error.message);
    }
}

async function updateMusicController(interaction, queue) {
    try {
        if (!interaction.message?.id) return;

        const { createCompleteMusicController } = require('./utils/componentsV2');
        const controller = createCompleteMusicController(queue);

        if (controller && interaction.message) {
            await interaction.message.edit({
                embeds: controller.embeds,
                components: controller.components
            });
        }
    } catch (error) {
        if (error.code === 10008) {
            client.musicPanels.delete(queue.guildId);
        }
    }
}

client.on('error', console.error);

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in .env file!');
    process.exit(1);
}

if (process.env.SPOTIFY_CLIENT_ID && !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ SPOTIFY_CLIENT_SECRET is required when SPOTIFY_CLIENT_ID is provided!');
    process.exit(1);
}

require('./api')(client);

client.login(process.env.DISCORD_TOKEN);
