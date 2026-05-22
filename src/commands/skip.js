const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ ...errorEmbed('Nothing is playing right now.'), flags: 64 });
        }

        const song = queue.songs[0];
        
        try {
            await queue.skip();
            await interaction.reply({ ...successEmbed(`Skipped **${song.name}**`) });
        } catch (error) {
            await interaction.reply({ ...errorEmbed('No more songs in the queue.') });
        }
    },
};
