const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { errorEmbed } = require('../utils/embed');
const play = require('play-dl');

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
            const container = new ContainerBuilder().setAccentColor(0xff4444);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ You need to be in a voice channel!'));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | 64 });
        }

        await interaction.reply({ content: '🔍 Searching...' });

        try {
            const results = await play.search(query, { limit: 10 });

            if (!results.length) {
                const container = new ContainerBuilder().setAccentColor(0xff4444);
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ No results found.'));
                return interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = new ContainerBuilder().setAccentColor(0x9B59B6);
            let description = `### 🔍 Search Results\n\n`;
            description += results.map((r, i) => `**${i + 1}.** [${r.title}](${r.url}) - \`${client.formatDuration(r.durationInSec)}\``).join('\n');
            description += `\n\n*Select a song from the dropdown below*`;

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(description)
            );

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('search_select')
                .setPlaceholder('Select a song to play')
                .addOptions(results.map((r, i) => ({
                    label: r.title.slice(0, 100),
                    description: `${client.formatDuration(r.durationInSec)} • ${r.channel?.name || 'Unknown'}`.slice(0, 100),
                    value: r.url,
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);
            container.addActionRowComponents(row);

            const response = await interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });

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
                    const errContainer = new ContainerBuilder().setAccentColor(0xff4444);
                    errContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`❌ Failed to play: ${error.message}`));
                    await interaction.editReply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const timeoutContainer = new ContainerBuilder().setAccentColor(0xffbb33);
                    timeoutContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`⚠️ Search timed out.`));
                    await interaction.editReply({ components: [timeoutContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                }
            });
        } catch (error) {
            console.error('Search error:', error);
            const errContainer = new ContainerBuilder().setAccentColor(0xff4444);
            errContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ Search failed.'));
            await interaction.editReply({ content: null, components: [errContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },
};
