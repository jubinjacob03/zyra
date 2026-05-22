const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { queueEmbed, errorEmbed } = require('../utils/embed');

/**
 * Queue command module.
 * Displays the current music queue.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View the music queue')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page number')
                .setMinValue(1)),

    /**
     * Executes the queue command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').Client} client - The Discord client.
     */
    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue || !queue.songs.length) {
            return interaction.reply({ ...errorEmbed('The queue is empty.'), flags: 64 });
        }

        const page = (interaction.options.getInteger('page') || 1) - 1;
        const container = queueEmbed(queue, page);
        await interaction.reply({ ...container });
    },
};
