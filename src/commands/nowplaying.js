const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { createMusicPanel } = require('../utils/embed');
const { errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the currently playing song'),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue || !queue.songs[0]) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], flags: 64 });
        }

        const { embed, components } = createMusicPanel(queue);
        await interaction.reply({ embeds: [embed], components });
    },
};
