const { 
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');

/**
 * Format time in MM:SS format
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Create progress bar that matches the web UI design with moving dot
 */
function createWebUIProgressBar(progress, elapsed, duration) {
    const barLength = 30;
    const position = Math.floor((progress / 100) * barLength);
    
   
    let bar = '';
    for (let i = 0; i < barLength; i++) {
        if (i === position) {
            bar += 'o';
        } else {
            bar += '─';
        }
    }
    
    return `\`${formatTime(elapsed)}\` ${bar} \`${formatTime(duration)}\``;
}

/**
 * Create volume bar that matches the web UI slider with moving dot
 */
function createVolumeSlider(volume) {
    const sliderLength = 20;
    const position = Math.floor((volume / 100) * sliderLength);
    
   
    let slider = '';
    for (let i = 0; i < sliderLength; i++) {
        if (i === position) {
            slider += 'o';
        } else {
            slider += '─';
        }
    }
    
    return `🔊 ${slider} \`${volume}%\``;
}

/**
 * Create Discord embed that exactly matches the web UI layout
 */
function createWebUIEmbed(queue) {
    const song = queue?.songs?.[0];
    
   
    const elapsed = queue?.playing && !queue?.paused ? 
        Math.floor((Date.now() - (queue.startTime || Date.now())) / 1000) : 0;
    const duration = song?.duration || 0;
    const progress = duration > 0 ? (elapsed / duration) * 100 : 0;
    
   
    const songTitle = song?.name || 'No song playing';
    const artistName = song?.author || 'Unknown artist';
    const connectionStatus = queue ? 'Connected to music bot...' : 'Connecting to music bot...';
    
   
    const progressBar = createWebUIProgressBar(progress, elapsed, duration);
    
   
    const volumeSlider = createVolumeSlider(queue?.volume || 50);
    
   
    const platformIcon = song?.spotifyData?.isSpotify ? '🟢' : '🔴';
    const platformText = song?.spotifyData?.isSpotify ? 'Spotify' : 'YouTube';
    
   
    const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setAuthor({ 
            name: 'Remani Music 🎵'
        })
        .setDescription(connectionStatus)
        .setThumbnail(typeof song?.thumbnail === 'object' ? song?.thumbnail?.url : song?.thumbnail)
        .addFields(
            {
                name: '\u200b',
                value: `# ${songTitle}\n## ${artistName}`,
                inline: false
            },
            {
                name: '\u200b',
                value: progressBar,
                inline: false
            },
            {
                name: '\u200b',
                value: volumeSlider,
                inline: false
            }
        );
    
   
    if (song) {
        embed.addFields({
            name: '\u200b',
            value: `${platformIcon} **${platformText}** • Requested by **${song.user?.displayName || song.user?.username || 'Unknown'}**`,
            inline: false
        });
    }
    
   
    if (queue?.songs?.length > 1) {
        embed.addFields({
            name: 'Up Next',
            value: queue.songs.slice(1, 3).map((s, i) => 
                `**${i + 2}.** ${s.name} - *${s.author}*`
            ).join('\n') || '*No upcoming songs*',
            inline: false
        });
    }
    
    return embed;
}

/**
 * Create control buttons that match the web UI layout
 */
function createWebUIButtons(queue) {
   
    const mainControls = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_shuffle')
                .setEmoji('🔀')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_previous')
                .setEmoji('⏮️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_pause')
                .setEmoji(queue?.paused ? '▶️' : '⏸️')
                .setStyle(queue?.paused ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('music_skip')
                .setEmoji('⏭️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_loop')
                .setEmoji(queue?.repeatMode > 0 ? '🔂' : '🔁')
                .setStyle(queue?.repeatMode > 0 ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    
   
    const secondaryControls = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('music_voldown')
                .setLabel('Vol -')
                .setEmoji('🔉')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_volup')
                .setLabel('Vol +')
                .setEmoji('🔊')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_queue')
                .setLabel('Queue')
                .setEmoji('📋')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('music_stop')
                .setLabel('Stop')
                .setEmoji('⏹️')
                .setStyle(ButtonStyle.Danger)
        );
    
    return [mainControls, secondaryControls];
}

/**
 * Create complete web UI style music controller
 */
function createCompleteMusicController(queue) {
    const embed = createWebUIEmbed(queue);
    const buttons = createWebUIButtons(queue);
    
    return {
        embeds: [embed],
        components: buttons
    };
}

module.exports = {
    createWebUIEmbed,
    createWebUIButtons,
    createCompleteMusicController,
    formatTime
};
