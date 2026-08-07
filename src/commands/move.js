const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a song in the queue')
        .addIntegerOption(option =>
            option.setName('from')
                .setDescription('Current position of the song')
                .setRequired(true)
                .setMinValue(1))
        .addIntegerOption(option =>
            option.setName('to')
                .setDescription('New position for the song')
                .setRequired(true)
                .setMinValue(1)),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply(errorEmbed('Nothing is playing right now.'));
        }

        const from = interaction.options.getInteger('from');
        const to = interaction.options.getInteger('to');

        if (from > queue.songs.length || to > queue.songs.length) {
            return interaction.reply(errorEmbed(`Invalid positions. Queue has ${queue.songs.length} songs.`));
        }

        const song = queue.songs.splice(from, 1)[0];
        queue.songs.splice(to, 0, song);

        await interaction.reply(successEmbed(`Moved **${song.name}** from position ${from} to ${to}`));
    },
};
