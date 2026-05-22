const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

/**
 * Volume command module.
 * Adjusts the playback volume of the current queue.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set the volume')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Volume level (0-100)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(100)),

    /**
     * Executes the volume command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').Client} client - The Discord client.
     */
    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ ...errorEmbed('Nothing is playing right now.'), flags: 64 });
        }

        const volume = interaction.options.getInteger('level');
        await queue.setVolume(volume);
        await interaction.reply({ ...successEmbed(`Volume set to **${volume}%**`) });
    },
};
