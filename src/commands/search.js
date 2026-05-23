const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { errorEmbed } = require('../utils/embed');
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
            const node = client.shoukaku.getIdealNode();
            if (!node) throw new Error("Lavalink node is not ready");

            const searchResult = await node.rest.resolve(`ytsearch:${query}`);
            
            if (!searchResult || searchResult.loadType === "empty" || searchResult.loadType === "error") {
                const container = new ContainerBuilder().setAccentColor(0xff4444);
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} No results found.`));
                return interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            let tracks = [];
            if (searchResult.loadType === "playlist") {
                tracks = searchResult.data.tracks;
            } else if (searchResult.loadType === "search") {
                tracks = searchResult.data;
            } else if (searchResult.loadType === "track") {
                tracks = [searchResult.data];
            }

            const results = tracks.slice(0, 10);

            const container = new ContainerBuilder().setAccentColor(0x9B59B6);
            let description = `### ${e("INFO")} Search Results\n\n`;
            description += results.map((r, i) => `**${i + 1}.** [${r.info.title}](${r.info.uri}) - \`${client.formatDuration(Math.round(r.info.length / 1000))}\``).join('\n');
            description += `\n\n*Select a song from the dropdown below*`;

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(description)
            );

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('search_select')
                .setPlaceholder('Select a song to play')
                .addOptions(results.map((r, i) => ({
                    label: r.info.title.slice(0, 100),
                    description: `${client.formatDuration(Math.round(r.info.length / 1000))} • ${r.info.author || 'Unknown'}`.slice(0, 100),
                    value: r.info.uri,
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
