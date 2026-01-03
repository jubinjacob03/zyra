const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the current song'),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], flags: 64 });
        }

        if (queue.paused) {
            return interaction.reply({ embeds: [errorEmbed('The music is already paused.')], flags: 64 });
        }

        queue.pause();
        await interaction.reply({ embeds: [successEmbed('Paused the music.')] });
    },
};
