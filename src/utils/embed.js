const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Modern Material Design inspired color palette for Discord
const COLORS = {
    PRIMARY: 0x000000,     
    SUCCESS: 0x00C851,     
    WARNING: 0xFFBB33,     
    ERROR: 0xFF4444,       
    INFO: 0x33B5E5,        
    MUSIC: 0x1A1A1A,       
    SPOTIFY: 0x1DB954,     
    YOUTUBE: 0xFF0000,     
    ACCENT: 0x6200EA,      
    MUTED: 0x757575,       
};

// Clean, minimal icon set
const ICONS = {
   
    PLAY: '▶️',
    PAUSE: '⏸️', 
    STOP: '⏹️',
    SKIP: '⏭️',
    PREVIOUS: '⏮️',
    SHUFFLE: '🔀',
    REPEAT: '🔁',
    REPEAT_ONE: '🔂',
    
   
    VOLUME_HIGH: '🔊',
    VOLUME_MID: '🔉',
    VOLUME_LOW: '🔈',
    QUEUE: '📋',
    MUSIC_NOTE: '🎵',
    HEADPHONES: '🎧',
    
   
    SUCCESS: '✅',
    ERROR: '❌',
    WARNING: '⚠️',
    INFO: 'ℹ️',
    LIVE: '🔴',
    
   
    SPOTIFY: '🟢',
    YOUTUBE: '🔴',
    
   
    USER: '👤',
    TIME: '⏱️',
    DOT: '•',
    ARROW: '→',
    BAR: '▬',
    CIRCLE: '●',
};

/**
 * Create a modern progress bar using Unicode characters
 */
function createProgressBar(current, total, length = 20) {
    if (!current || !total || total === 0) return '▬'.repeat(length);
    
    const progress = Math.min(current / total, 1);
    const filled = Math.round(progress * length);
    const empty = length - filled;
    
    const filledBar = '█'.repeat(filled);
    const emptyBar = '▬'.repeat(empty);
    
    return `${filledBar}${emptyBar}`;
}

/**
 * Format duration in MM:SS or HH:MM:SS format
 */
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Create a beautiful, Material Design inspired music panel embed
 * This will be the main interactive controller within Discord
 */
function createMusicPanel(queue) {
    const song = queue.songs[0];
    if (!song) return null;

    const loopModes = ['Off', `${ICONS.REPEAT_ONE} Song`, `${ICONS.REPEAT} Queue`];
    const volumeIcon = queue.volume > 66 ? ICONS.VOLUME_HIGH : 
                      queue.volume > 33 ? ICONS.VOLUME_MID : ICONS.VOLUME_LOW;
    
   
    const progressBar = createProgressBar(0, song.duration || 100, 15);
    
   
    const embed = new EmbedBuilder()
        .setColor(song.spotifyData?.isSpotify ? COLORS.SPOTIFY : COLORS.PRIMARY)
        .setAuthor({ 
            name: `${ICONS.LIVE} NOW PLAYING`, 
            iconURL: song.user?.avatarURL?.() 
        })
        .setTitle(`${song.name}`)
        .setURL(song.url)
        .setDescription(`**${song.author || 'Unknown Artist'}**\n\n` +
            `${ICONS.TIME} \`${formatDuration(0)} ${progressBar} ${song.formattedDuration}\`\n` +
            `${ICONS.USER} ${song.user?.displayName || song.user?.username || 'Unknown'}\n` +
            `${volumeIcon} \`${queue.volume}%\` ${ICONS.DOT} ${loopModes[queue.repeatMode]} ${ICONS.DOT} \`${queue.songs.length} songs\``
        )
        .addFields(
            {
                name: `${ICONS.QUEUE} Queue Preview`,
                value: queue.songs.slice(1, 4).map((s, i) => 
                    `\`${i + 2}.\` **${s.name}** - *${s.author}*`
                ).join('\n') || '*No upcoming songs*',
                inline: false
            }
        )
        .setFooter({ 
            text: `Remani Music ${ICONS.DOT} Live Controller ${song.spotifyData?.isSpotify ? ICONS.SPOTIFY : ICONS.YOUTUBE}`,
        })
        .setTimestamp();

   
    if (song.thumbnail && typeof song.thumbnail === 'string') {
        embed.setThumbnail(song.thumbnail);
    }

   
    if (song.spotifyData?.isSpotify) {
        embed.setAuthor({ 
            name: `${ICONS.SPOTIFY} SPOTIFY ${ICONS.ARROW} NOW PLAYING`, 
            iconURL: song.user?.avatarURL?.() 
        });
    }

   
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_shuffle')
            .setEmoji(ICONS.SHUFFLE)
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Shuffle'),
        new ButtonBuilder()
            .setCustomId('music_previous')
            .setEmoji(ICONS.PREVIOUS)
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Previous')
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('music_pause')
            .setEmoji(queue.paused ? ICONS.PLAY : ICONS.PAUSE)
            .setStyle(queue.paused ? ButtonStyle.Success : ButtonStyle.Primary)
            .setLabel(queue.paused ? 'Play' : 'Pause'),
        new ButtonBuilder()
            .setCustomId('music_skip')
            .setEmoji(ICONS.SKIP)
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Skip'),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setEmoji(ICONS.STOP)
            .setStyle(ButtonStyle.Danger)
            .setLabel('Stop')
    );

   
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('music_voldown')
            .setEmoji('🔉')
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Vol -'),
        new ButtonBuilder()
            .setCustomId('music_volup')
            .setEmoji('🔊')
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Vol +'),
        new ButtonBuilder()
            .setCustomId('music_loop')
            .setEmoji(ICONS.REPEAT)
            .setStyle(queue.repeatMode > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setLabel('Loop'),
        new ButtonBuilder()
            .setCustomId('music_queue')
            .setEmoji(ICONS.QUEUE)
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Queue'),
        new ButtonBuilder()
            .setCustomId('music_refresh')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary)
            .setLabel('Refresh')
    );

    return { embed, components: [row1, row2] };
}

/**
 * Create a clean "Now Playing" notification embed
 */
function createNowPlayingEmbed(song, queue, type = 'playing') {
    const isAdded = type === 'added';
    const title = isAdded ? `${ICONS.SUCCESS} Added to Queue` : `${ICONS.MUSIC_NOTE} Now Playing`;
    const color = isAdded ? COLORS.SUCCESS : (song.spotifyData?.isSpotify ? COLORS.SPOTIFY : COLORS.PRIMARY);
    
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`**[${song.name}](${song.url})**\n*${song.author || 'Unknown Artist'}*`)
        .addFields(
            { 
                name: `${ICONS.TIME} Duration`, 
                value: `\`${song.formattedDuration}\``, 
                inline: true 
            },
            { 
                name: `${ICONS.USER} Requested`, 
                value: `${song.user}`, 
                inline: true 
            },
            { 
                name: `${ICONS.QUEUE} Position`, 
                value: `\`#${queue.songs.length}\``, 
                inline: true 
            }
        )
        .setFooter({ 
            text: song.spotifyData?.isSpotify ? 
                `Converted from Spotify ${ICONS.SPOTIFY}` : 
                `YouTube Audio ${ICONS.YOUTUBE}`,
        })
        .setTimestamp();

    if (song.thumbnail && typeof song.thumbnail === 'string') {
        embed.setThumbnail(song.thumbnail);
    }

    return embed;
}

/**
 * Create success embed with Material Design styling
 */
function successEmbed(description, title = null) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setDescription(`${ICONS.SUCCESS} ${description}`)
        .setTimestamp();
    
    if (title) {
        embed.setTitle(`${ICONS.SUCCESS} ${title}`);
        embed.setDescription(description);
    }
    
    return embed;
}

/**
 * Create error embed with Material Design styling
 */
function errorEmbed(description, title = null) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setDescription(`${ICONS.ERROR} ${description}`)
        .setTimestamp();
    
    if (title) {
        embed.setTitle(`${ICONS.ERROR} ${title}`);
        embed.setDescription(description);
    }
    
    return embed;
}

/**
 * Create info embed with Material Design styling
 */
function infoEmbed(description, title = null) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setDescription(`${ICONS.INFO} ${description}`)
        .setTimestamp();
    
    if (title) {
        embed.setTitle(`${ICONS.INFO} ${title}`);
        embed.setDescription(description);
    }
    
    return embed;
}

/**
 * Create warning embed with Material Design styling
 */
function warningEmbed(description, title = null) {
    const embed = new EmbedBuilder()
        .setColor(COLORS.WARNING)
        .setDescription(`${ICONS.WARNING} ${description}`)
        .setTimestamp();
    
    if (title) {
        embed.setTitle(`${ICONS.WARNING} ${title}`);
        embed.setDescription(description);
    }
    
    return embed;
}

/**
 * Create beautiful queue display embed
 */
function queueEmbed(queue, page = 0) {
    const songsPerPage = 8;
    const totalPages = Math.ceil(queue.songs.length / songsPerPage) || 1;
    const start = page * songsPerPage;
    const songs = queue.songs.slice(start, start + songsPerPage);

    let description = songs.map((song, i) => {
        const position = start + i;
        const prefix = position === 0 ? 
            `${ICONS.PLAY} **Now:**` : 
            `\`${position.toString().padStart(2, '0')}.\``;
        
        const spotifyIcon = song.spotifyData?.isSpotify ? ` ${ICONS.SPOTIFY}` : '';
        return `${prefix} **[${song.name}](${song.url})**${spotifyIcon}\n` +
               `${ICONS.DOT} *${song.author || 'Unknown'}* ${ICONS.DOT} \`${song.formattedDuration}\``;
    }).join('\n\n');

    if (!description) {
        description = `${ICONS.INFO} Queue is empty\n\nUse \`/play\` to add some music!`;
    }

    const totalDuration = queue.songs.reduce((acc, song) => acc + (song.duration || 0), 0);
    
    return new EmbedBuilder()
        .setColor(COLORS.MUSIC)
        .setTitle(`${ICONS.QUEUE} Music Queue`)
        .setDescription(description)
        .addFields({
            name: `${ICONS.INFO} Queue Stats`,
            value: `**Songs:** \`${queue.songs.length}\` ${ICONS.DOT} **Duration:** \`${formatDuration(totalDuration)}\` ${ICONS.DOT} **Page:** \`${page + 1}/${totalPages}\``,
            inline: false
        })
        .setFooter({ text: `Remani Music ${ICONS.DOT} Page ${page + 1} of ${totalPages}` })
        .setTimestamp();
}

/**
 * Create playlist embed for Spotify/YouTube playlists
 */
function playlistEmbed(playlist, isSpotify = false) {
    const color = isSpotify ? COLORS.SPOTIFY : COLORS.YOUTUBE;
    const icon = isSpotify ? ICONS.SPOTIFY : ICONS.YOUTUBE;
    const platform = isSpotify ? 'Spotify' : 'YouTube';
    
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(`${ICONS.SUCCESS} Added ${platform} Playlist`)
        .setDescription(`**[${playlist.name}](${playlist.url})**`)
        .addFields(
            { 
                name: `${ICONS.MUSIC_NOTE} Songs`, 
                value: `\`${playlist.songs.length}\``, 
                inline: true 
            },
            { 
                name: `${ICONS.USER} Requested by`, 
                value: `${playlist.user}`, 
                inline: true 
            },
            { 
                name: `${icon} Platform`, 
                value: `\`${platform}\``, 
                inline: true 
            }
        )
        .setThumbnail(playlist.thumbnail)
        .setFooter({ text: `${platform} Playlist ${ICONS.DOT} ${playlist.songs.length} tracks added` })
        .setTimestamp();
}

module.exports = {
    COLORS,
    ICONS,
    createMusicPanel,
    createNowPlayingEmbed,
    successEmbed,
    errorEmbed,
    infoEmbed,
    warningEmbed,
    queueEmbed,
    playlistEmbed,
    formatDuration,
    createProgressBar,
};
