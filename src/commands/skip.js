const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], flags: 64 });
        }

        const song = queue.songs[0];
        
        try {
            await queue.skip();
            await interaction.reply({ embeds: [successEmbed(`Skipped **${song.name}**`)] });
        } catch (error) {
            await interaction.reply({ embeds: [errorEmbed('No more songs in the queue.')] });
        }
    },
};
