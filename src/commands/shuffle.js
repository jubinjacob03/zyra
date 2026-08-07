const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the queue'),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply(errorEmbed('Nothing is playing right now.'));
        }

        if (queue.songs.length < 3) {
            return interaction.reply(errorEmbed('Need at least 3 songs to shuffle.'));
        }

        await queue.shuffle();
        await interaction.reply(successEmbed(`Shuffled ${queue.songs.length} songs.`));
    },
};
