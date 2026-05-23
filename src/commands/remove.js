const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

/**
 * Remove command module.
 * Removes a specific song from the queue by its position.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a song from the queue')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position of the song to remove')
                .setRequired(true)
                .setMinValue(1)),

    /**
     * Executes the remove command.
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

        const removed = queue.tracks.removeOne(position - 1);
        await interaction.reply({ ...successEmbed(`Removed **${removed.title}** from the queue.`) });
    },
};
