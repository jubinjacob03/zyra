const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

/**
 * Loop command module.
 * Sets the loop mode for the current queue.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Set loop mode')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Loop mode')
                .setRequired(true)
                .addChoices(
                    { name: 'Off', value: '0' },
                    { name: 'Song', value: '1' },
                    { name: 'Queue', value: '2' }
                )),

    /**
     * Executes the loop command.
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
     * @param {import('discord.js').Client} client - The Discord client.
     */
    async execute(interaction, client) {
        const queue = client.player.nodes.get(interaction.guildId);

        if (!queue) {
            return interaction.reply({ ...errorEmbed('Nothing is playing right now.'), flags: 64 });
        }

        const mode = parseInt(interaction.options.getString('mode'));
        const modeNames = ['Off', 'Song', 'Queue'];
        
        await queue.setRepeatMode(mode);
        await interaction.reply({ ...successEmbed(`Loop mode set to **${modeNames[mode]}**`) });
    },
};
