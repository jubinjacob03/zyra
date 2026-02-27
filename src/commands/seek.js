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

        if (seconds < 0 || seconds > (queue.songs[0]?.duration || 0)) {
            return interaction.reply({ embeds: [errorEmbed('Invalid seek position.')], flags: 64 });
        }

        if (!queue.songs[0]?.isSeekable) {
            return interaction.reply({ embeds: [errorEmbed('This track cannot be seeked.')], flags: 64 });
        }

        queue.seek(seconds);
        const { formatDuration } = require('../utils/embed');
        await interaction.reply({ embeds: [successEmbed(`⏩ Seeked to **${formatDuration(seconds)}**`)] });
    },
};
