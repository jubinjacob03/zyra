const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { errorEmbed, playlistEmbed, COLORS, ICONS } = require('../utils/embed');
const { createCompleteMusicController } = require('../utils/componentsV2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist from YouTube or Spotify')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name, YouTube URL, or Spotify URL')
                .setRequired(true)),

    async execute(interaction, client) {
        const query = interaction.options.getString('query');
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], ephemeral: true });
        }

        const permissions = voiceChannel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({ embeds: [errorEmbed('I need permissions to join and speak in your voice channel!')], ephemeral: true });
        }

        await interaction.reply({ content: '🔍 Searching...' });

        try {
            const searchStart = Date.now();
            console.log(`🔍 Starting search for: "${query}"`);
            
            const result = await Promise.race([
                client.searchSong(query, member),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Operation timeout - please try a simpler query or direct YouTube link')), 30000)
                )
            ]);
            
            console.log(`✅ Search completed in ${Date.now() - searchStart}ms`);
            
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
                
                const controller = createCompleteMusicController(queue);
                
                try {
                    await interaction.editReply({
                        content: null,
                        embeds: controller.embeds,
                        components: controller.components
                    });
                } catch (editError) {
                    await interaction.channel.send({
                        embeds: controller.embeds,
                        components: controller.components
                    });
                }
                
                if (isNewQueue) {
                    await queue.play();
                }
                
                if (result.spotifyData?.remainingTracks && result.spotifyData.remainingTracks.length > 0) {
                    client.processSpotifyPlaylistBackground(queue, result.spotifyData.remainingTracks, interaction.channel);
                }
            } else {
                await queue.addSong(result);
                
                const controller = createCompleteMusicController(queue);
                
                try {
                    await interaction.editReply({
                        content: null,
                        embeds: controller.embeds,
                        components: controller.components
                    });
                } catch (editError) {
                    await interaction.channel.send({
                        embeds: controller.embeds,
                        components: controller.components
                    });
                }
                
                if (isNewQueue) {
                    await queue.play();
                }
            }
        } catch (error) {
            console.error('Play error:', error);
            
            if (error.message.includes('Mix playlists are not supported')) {
                const embed = new EmbedBuilder()
                    .setColor('#E74C3C')
                    .setTitle('❌ YouTube Mix Playlists Not Supported')
                    .setDescription('Mix playlists are personalized and user-specific - they cannot be accessed by bots.')
                    .addFields(
                        { 
                            name: '💡 Alternatives', 
                            value: '• Use a regular YouTube playlist instead\n• Search for individual songs\n• Create a custom playlist with your favorite tracks',
                            inline: false 
                        },
                        {
                            name: '🔍 How to identify Mix playlists',
                            value: 'URLs containing `RD`, `RDMM`, `RDAMPL`, or `RDCLAK` in the playlist ID',
                            inline: false
                        }
                    )
                    .setFooter({ text: 'Try using a regular playlist or search for songs individually' })
                    .setTimestamp();
                
                try {
                    return await interaction.editReply({ content: null, embeds: [embed] });
                } catch {
                    return await interaction.channel.send({ embeds: [embed] });
                }
            }
            
            if (error.message.includes('timeout')) {
                try {
                    return await interaction.editReply({ 
                        content: null,
                        embeds: [errorEmbed('⏱️ Search took too long. Please try a simpler query or check your internet connection.')] 
                    });
                } catch {
                    return await interaction.channel.send({
                        embeds: [errorEmbed('⏱️ Search took too long. Please try a simpler query or check your internet connection.')]
                    });
                }
            }
            
            try {
                await interaction.editReply({ content: null, embeds: [errorEmbed(`Could not play: ${error.message}`)] });
            } catch {
                await interaction.channel.send({ embeds: [errorEmbed(`Could not play: ${error.message}`)] });
            }
        }
    },
};
