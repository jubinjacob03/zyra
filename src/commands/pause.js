const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

/**
 * Pause command module.
 * Pauses the currently playing song.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the current song'),

    /**
     * Executes the pause command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').Client} client - The Discord client.
     */
    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ ...errorEmbed('Nothing is playing right now.'), flags: 64 });
        }

        if (queue.paused) {
            return interaction.reply({ ...errorEmbed('The music is already paused.'), flags: 64 });
        }

        queue.pause();
        await interaction.reply({ ...successEmbed('Paused the music.') });
    },
};
