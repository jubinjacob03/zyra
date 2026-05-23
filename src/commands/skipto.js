const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

/**
 * SkipTo command module.
 * Skips to a specific song in the queue by its position.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('skipto')
        .setDescription('Skip to a specific song in the queue')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position of the song to skip to')
                .setRequired(true)
                .setMinValue(1)),

    /**
     * Executes the skipto command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').Client} client - The Discord client.
     */
    async execute(interaction, client) {
        const queue = client.player.nodes.get(interaction.guildId);

        if (!queue) {
            return interaction.reply({ ...errorEmbed('Nothing is playing right now.'), flags: 64 });
        }

        const position = interaction.options.getInteger('position');

        if (position > queue.tracks.size) {
            return interaction.reply({ ...errorEmbed(`Invalid position. Queue has ${queue.tracks.size} songs.`), flags: 64 });
        }

        queue.node.skipTo(position - 1);
        await interaction.reply({ ...successEmbed(`Skipped to position **${position}**`) });
    },
};
