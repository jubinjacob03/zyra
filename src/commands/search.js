const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for a song')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song to search for')
                .setRequired(true)),

    async execute(interaction, client) {
        const query = interaction.options.getString('query');
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ embeds: [errorEmbed('You need to be in a voice channel!')], flags: 64 });
        }

        await interaction.reply({ content: '🔍 Searching...' });

        try {
            const node = client.shoukaku.options.nodeResolver(client.shoukaku.nodes);
            if (!node) {
                return interaction.editReply({ embeds: [errorEmbed('Audio server not available. Try again in a moment.')] });
            }

            const result = await node.rest.resolve(`ytmsearch:${query}`);

            if (result.loadType !== 'search' || !result.data?.length) {
                return interaction.editReply({ embeds: [errorEmbed('No results found.')] });
            }

            const results = result.data.slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle('🔍 Search Results')
                .setDescription(results.map((r, i) => `**${i + 1}.** [${r.info.title}](${r.info.uri}) - \`${client.formatDuration(Math.floor(r.info.length / 1000))}\``).join('\n'))
                .setFooter({ text: 'Select a song from the dropdown below' })
                .setTimestamp();

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('search_select')
                .setPlaceholder('Select a song to play')
                .addOptions(results.map((r, i) => ({
                    label: (r.info.title || 'Unknown').slice(0, 100),
                    description: `${client.formatDuration(Math.floor(r.info.length / 1000))} • ${r.info.author || 'Unknown'}`.slice(0, 100),
                    value: r.info.uri || `search_${i}`,
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const response = await interaction.editReply({ embeds: [embed], components: [row] });

            const collector = response.createMessageComponentCollector({
                filter: i => i.user.id === interaction.user.id,
                time: 60000,
            });

            collector.on('collect', async i => {
                await i.deferUpdate();
                
                try {
                    const result = await client.searchSong(i.values[0], member);
                    
                    let queue = client.getQueue(interaction.guildId);
                    const isNewQueue = !queue;

                    if (!queue) {
                        queue = await client.createQueue(interaction.guildId, interaction.channel, voiceChannel);
                    }

                    await queue.addSong(result);
                    
                    if (isNewQueue) {
                        await queue.play();
                    }
                    
                    await interaction.deleteReply();
                } catch (error) {
                    await interaction.editReply({ embeds: [errorEmbed(`Failed to play: ${error.message}`)], components: [] });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({ components: [] }).catch(() => {});
                }
            });
        } catch (error) {
            console.error('Search error:', error);
            await interaction.editReply({ embeds: [errorEmbed('Search failed.')] });
        }
    },
};
