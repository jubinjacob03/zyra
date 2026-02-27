const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

// Lavalink-supported audio filters
const filters = {
    'off': 'off',
    '3d': '3d',
    'bassboost': 'bassboost',
    'karaoke': 'karaoke',
    'nightcore': 'nightcore',
    'vaporwave': 'vaporwave',
    'phaser': 'phaser',
    'tremolo': 'tremolo',
    'surround': 'surround',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('filter')
        .setDescription('Apply audio filters')
        .addStringOption(option =>
            option.setName('filter')
                .setDescription('Filter to apply')
                .setRequired(true)
                .addChoices(
                    { name: 'Off', value: 'off' },
                    { name: '3D', value: '3d' },
                    { name: 'Bass Boost', value: 'bassboost' },
                    { name: 'Karaoke', value: 'karaoke' },
                    { name: 'Nightcore', value: 'nightcore' },
                    { name: 'Vaporwave', value: 'vaporwave' },
                    { name: 'Phaser', value: 'phaser' },
                    { name: 'Tremolo', value: 'tremolo' },
                    { name: 'Surround', value: 'surround' }
                )),

    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);

        if (!queue) {
            return interaction.reply({ embeds: [errorEmbed('Nothing is playing right now.')], flags: 64 });
        }

        const filter = interaction.options.getString('filter');
        await queue.setFilter(filter);

        const filterNames = {
            'off': 'Off', '3d': '3D', 'bassboost': 'Bass Boost',
            'karaoke': 'Karaoke', 'nightcore': 'Nightcore', 'vaporwave': 'Vaporwave',
            'phaser': 'Phaser', 'tremolo': 'Tremolo', 'surround': 'Surround'
        };

        await interaction.reply({ embeds: [successEmbed(`🎛️ Audio filter set to **${filterNames[filter] || filter}**`)] });
    },
};
