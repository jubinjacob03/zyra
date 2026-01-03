const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Seek to a position in the song')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Time to seek to (e.g., 1:30, 90)')
                .setRequired(true)),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], flags: 64 });
        }

        const timeStr = interaction.options.getString('time');
        let seconds = 0;

        if (timeStr.includes(':')) {
            const parts = timeStr.split(':').reverse();
            if (parts[0]) seconds += parseInt(parts[0]) || 0;
            if (parts[1]) seconds += (parseInt(parts[1]) || 0) * 60;
            if (parts[2]) seconds += (parseInt(parts[2]) || 0) * 3600;
        } else {
            seconds = parseInt(timeStr) || 0;
        }

        if (seconds < 0 || seconds > queue.songs[0].duration) {
            return interaction.reply({ embeds: [errorEmbed('Invalid seek position.')], flags: 64 });
        }

        await interaction.reply({ embeds: [errorEmbed('Seeking is not currently supported.')] });
    },
};
