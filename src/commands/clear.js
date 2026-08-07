const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear the queue'),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply(errorEmbed('Nothing is playing right now.'));
        }

        const count = queue.songs.length - 1;
        queue.songs.splice(1);
        await interaction.reply(successEmbed(`Cleared **${count}** songs from the queue.`));
    },
};
