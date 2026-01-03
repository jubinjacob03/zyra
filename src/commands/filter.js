const { SlashCommandBuilder } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

const filters = {
    '3d': '3d',
    'bassboost': 'bassboost',
    'echo': 'echo',
    'flanger': 'flanger',
    'gate': 'gate',
    'haas': 'haas',
    'karaoke': 'karaoke',
    'nightcore': 'nightcore',
    'reverse': 'reverse',
    'vaporwave': 'vaporwave',
    'mcompand': 'mcompand',
    'phaser': 'phaser',
    'tremolo': 'tremolo',
    'surround': 'surround',
    'earwax': 'earwax',
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
                    { name: 'Echo', value: 'echo' },
                    { name: 'Flanger', value: 'flanger' },
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

        await interaction.reply({ embeds: [errorEmbed('Audio filters are not currently supported.')] });
    },
};
