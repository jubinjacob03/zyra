const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a song from the queue')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position of the song to remove')
                .setRequired(true)
                .setMinValue(1)),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], flags: 64 });
        }

        const position = interaction.options.getInteger('position');

        if (position > queue.songs.length) {
            return interaction.reply({ embeds: [errorEmbed(`Invalid position. Queue has ${queue.songs.length} songs.`)], flags: 64 });
        }

        const removed = queue.songs.splice(position, 1)[0];
        await interaction.reply({ embeds: [successEmbed(`Removed **${removed.name}** from the queue.`)] });
    },
};
