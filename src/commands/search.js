const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { e } = require('../utils/customEmoji');

/**
 * Search command module.
 * Searches for a song and displays a selection menu.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for a song')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song to search for')
                .setRequired(true)),

    /**
     * Executes the search command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').Client} client - The Discord client.
     */
    async execute(interaction, client) {
        const query = interaction.options.getString('query');
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            const container = new ContainerBuilder().setAccentColor(0xff4444);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} You need to be in a voice channel!`));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | 64 });
        }

        await interaction.reply({ content: `${e("INFO")} Searching...` });

        try {
            const searchResult = await client.player.search(query, {
                requestedBy: interaction.user,
            });

            if (!searchResult || searchResult.isEmpty()) {
                const container = new ContainerBuilder().setAccentColor(0xff4444);
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} No results found.`));
                return interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const results = searchResult.tracks.slice(0, 10);

            const container = new ContainerBuilder().setAccentColor(0x9B59B6);
            let description = `### ${e("INFO")} Search Results\n\n`;
            description += results.map((r, i) => `**${i + 1}.** [${r.title}](${r.url}) - \`${r.duration}\``).join('\n');
            description += `\n\n*Select a song from the dropdown below*`;

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(description)
            );

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('search_select')
                .setPlaceholder('Select a song to play')
                .addOptions(results.map((r, i) => ({
                    label: r.title.slice(0, 100),
                    description: `${r.duration} • ${r.author || 'Unknown'}`.slice(0, 100),
                    value: i.toString(),
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
                    const trackIndex = parseInt(i.values[0]);
                    const track = results[trackIndex];
                    
                    await client.player.play(voiceChannel, track, {
                        nodeOptions: {
                            metadata: {
                                channel: interaction.channel,
                            },
                            leaveOnEmpty: true,
                            leaveOnEmptyCooldown: 300000,
                            leaveOnEnd: false,
                        },
                    });
                    
                    await interaction.deleteReply();
                } catch (error) {
                    const errContainer = new ContainerBuilder().setAccentColor(0xff4444);
                    errContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} Failed to play: ${error.message}`));
                    await interaction.editReply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    const timeoutContainer = new ContainerBuilder().setAccentColor(0xffbb33);
                    timeoutContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("WARNING")} Search timed out.`));
                    await interaction.editReply({ components: [timeoutContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                }
            });
        } catch (error) {
            console.error('Search error:', error);
            const errContainer = new ContainerBuilder().setAccentColor(0xff4444);
            errContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} Search failed.`));
            await interaction.editReply({ content: null, components: [errContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },
};
