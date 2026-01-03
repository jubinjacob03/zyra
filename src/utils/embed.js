const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const COLORS = {
    PRIMARY: 0x9B59B6,
    SUCCESS: 0x2ECC71,
    WARNING: 0xF39C12,
    ERROR: 0xE74C3C,
    INFO: 0x3498DB,
    MUSIC: 0x9B59B6,
};

function createProgressBar(current, total, length = 20) {
    const progress = Math.min(current / total, 1) || 0;
    const filled = Math.round(progress * length);
    const empty = length - filled;
    return '▬'.repeat(filled) + '🔘' + '▬'.repeat(Math.max(0, empty - 1));
}

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

function createMusicPanel(queue) {
    const song = queue.songs[0];
    const loopModes = ['Off', '🔂 Song', '🔁 Queue'];
    
    const embed = new EmbedBuilder()
        .setColor(COLORS.MUSIC)
        .setAuthor({ name: '🎵 MUSIC PANEL', iconURL: song.user?.avatarURL?.() })
        .setTitle(song.name)
        .setURL(song.url)
        .setThumbnail(song.thumbnail)
        .addFields(
            { name: '👤 Requested By', value: `${song.user}`, inline: true },
            { name: '⏱️ Duration', value: song.formattedDuration, inline: true },
            { name: '🎤 Author', value: song.author || 'Unknown', inline: true },
            { name: '🔊 Volume', value: `${queue.volume}%`, inline: true },
            { name: '🔁 Loop', value: loopModes[queue.repeatMode], inline: true },
            { name: '📋 Queue', value: `${queue.songs.length} songs`, inline: true }
        )
        .setFooter({ text: `Zyra Music • 0:00/${song.formattedDuration}` })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_previous').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_pause').setEmoji(queue.paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_voldown').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_volup').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_queue').setEmoji('📋').setStyle(ButtonStyle.Secondary)
    );

    return { embed, components: [row1, row2] };
}

function createNowPlayingEmbed(song, queue, type = 'playing') {
    const title = type === 'added' ? '✅ Added to Queue' : '🎵 Now Playing';
    
    const embed = new EmbedBuilder()
        .setColor(type === 'added' ? COLORS.SUCCESS : COLORS.MUSIC)
        .setTitle(title)
        .setDescription(`**[${song.name}](${song.url})**`)
        .setThumbnail(song.thumbnail)
        .addFields(
            { name: '⏱️ Duration', value: song.formattedDuration, inline: true },
            { name: '👤 Requested by', value: `${song.user}`, inline: true },
            { name: '📋 Position', value: `${queue.songs.length}`, inline: true }
        )
        .setTimestamp();

    return embed;
}

function successEmbed(description) {
    return new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setDescription(`✅ ${description}`)
        .setTimestamp();
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setDescription(`❌ ${description}`)
        .setTimestamp();
}

function infoEmbed(description) {
    return new EmbedBuilder()
        .setColor(COLORS.INFO)
        .setDescription(`ℹ️ ${description}`)
        .setTimestamp();
}

function queueEmbed(queue, page = 0) {
    const songsPerPage = 10;
    const totalPages = Math.ceil(queue.songs.length / songsPerPage) || 1;
    const start = page * songsPerPage;
    const songs = queue.songs.slice(start, start + songsPerPage);

    let description = songs.map((song, i) => {
        const position = start + i;
        const prefix = position === 0 ? '▶️ **Now:**' : `**${position}.**`;
        return `${prefix} [${song.name}](${song.url}) - \`${song.formattedDuration}\``;
    }).join('\n');

    if (!description) description = '📭 Queue is empty';

    return new EmbedBuilder()
        .setColor(COLORS.MUSIC)
        .setTitle('📋 Music Queue')
        .setDescription(description)
        .setFooter({ text: `Page ${page + 1}/${totalPages} • ${queue.songs.length} songs` })
        .setTimestamp();
}

module.exports = {
    COLORS,
    createMusicPanel,
    createNowPlayingEmbed,
    successEmbed,
    errorEmbed,
    infoEmbed,
    queueEmbed,
    formatDuration,
    createProgressBar,
};
