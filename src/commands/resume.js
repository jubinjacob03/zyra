const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

/**
 * Resume command module.
 * Resumes the currently paused song.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused song'),

    /**
     * Executes the resume command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').Client} client - The Discord client.
     */
    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ ...errorEmbed('Nothing is playing right now.'), flags: 64 });
        }

        if (!queue.paused) {
            return interaction.reply({ ...errorEmbed('The music is not paused.'), flags: 64 });
        }

        queue.resume();
        await interaction.reply({ ...successEmbed('Resumed the music.') });
    },
};
