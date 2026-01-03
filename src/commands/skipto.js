const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skipto')
        .setDescription('Skip to a specific song in the queue')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position of the song to skip to')
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

        queue.songs.splice(0, position - 1);
        queue.skip();
        await interaction.reply({ embeds: [successEmbed(`Skipped to position **${position}**`)] });
    },
};
