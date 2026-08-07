const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused song'),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply(errorEmbed('Nothing is playing right now.'));
        }

        if (!queue.paused) {
            return interaction.reply(errorEmbed('The music is not paused.'));
        }

        queue.resume();
        await interaction.reply(successEmbed('Resumed the music.'));
    },
};
