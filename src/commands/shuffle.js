const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the queue'),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], flags: 64 });
        }

        if (queue.songs.length < 3) {
            return interaction.reply({ embeds: [errorEmbed('Need at least 3 songs to shuffle.')], flags: 64 });
        }

        await queue.shuffle();
        await interaction.reply({ embeds: [successEmbed(`Shuffled ${queue.songs.length} songs.`)] });
    },
};
