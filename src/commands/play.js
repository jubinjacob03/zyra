const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist from YouTube')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name or YouTube URL')
                .setRequired(true)),

    async execute(interaction, client) {
        const query = interaction.options.getString('query');
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], flags: 64 });
        }

        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({ embeds: [errorEmbed('I need permissions to join and speak in your voice channel!')], flags: 64 });
        }

        await interaction.deferReply();

        try {
            const result = await client.searchSong(query, member);
            
            if (!result) {
                return interaction.editReply({ embeds: [errorEmbed('No results found for your query.')] });
            }

            let queue = client.getQueue(interaction.guildId);
            const isNewQueue = !queue;

            if (!queue) {
                queue = await client.createQueue(interaction.guildId, interaction.channel, voiceChannel);
            }

            if (result.type === 'playlist') {
                await queue.addSongs(result.songs);
                
                const embed = new EmbedBuilder()
                    .setColor('#9B59B6')
                    .setTitle('✅ Added Playlist')
                    .setDescription(`**[${result.name}](${result.url})**`)
                    .addFields(
                        { name: '🎵 Songs', value: `${result.songs.length}`, inline: true },
                        { name: '👤 Requested by', value: `${member}`, inline: true }
                    )
                    .setThumbnail(result.thumbnail || result.songs[0]?.thumbnail)
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
                
                if (isNewQueue) {
                    await queue.play();
                }
            } else {
                await queue.addSong(result);
                
                if (isNewQueue) {
                    await queue.play();
                    await interaction.deleteReply();
                } else {
                    const embed = new EmbedBuilder()
                        .setColor('#9B59B6')
                        .setTitle('✅ Added to Queue')
                        .setDescription(`**[${result.name}](${result.url})**`)
                        .addFields(
                            { name: '⏱️ Duration', value: result.formattedDuration, inline: true },
                            { name: '👤 Requested by', value: `${member}`, inline: true },
                            { name: '📋 Position', value: `${queue.songs.length}`, inline: true }
                        )
                        .setThumbnail(result.thumbnail)
                        .setTimestamp();
                    
                    await interaction.editReply({ embeds: [embed] });
                }
            }
        } catch (error) {
            console.error('Play error:', error);
            await interaction.editReply({ embeds: [errorEmbed(`Could not play: ${error.message}`)] });
        }
    },
};
