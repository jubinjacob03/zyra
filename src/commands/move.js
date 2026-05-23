const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

/**
 * Move command module.
 * Moves a song to a different position in the queue.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a song in the queue')
        .addIntegerOption(option =>
            option.setName('from')
                .setDescription('Current position of the song')
                .setRequired(true)
                .setMinValue(1))
        .addIntegerOption(option =>
            option.setName('to')
                .setDescription('New position for the song')
                .setRequired(true)
                .setMinValue(1)),

    /**
     * Executes the move command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').Client} client - The Discord client.
     */
    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ ...errorEmbed('Nothing is playing right now.'), flags: 64 });
        }

        const from = interaction.options.getInteger('from');
        const to = interaction.options.getInteger('to');

        if (from >= queue.songs.length || to >= queue.songs.length) {
            return interaction.reply({ ...errorEmbed(`Invalid positions. Queue has ${queue.songs.length - 1} upcoming songs.`), flags: 64 });
        }

        const song = queue.songs.splice(from, 1)[0];
        queue.songs.splice(to, 0, song);

        await interaction.reply({ ...successEmbed(`Moved **${song.name}** from position ${from} to ${to}`) });
    },
};
