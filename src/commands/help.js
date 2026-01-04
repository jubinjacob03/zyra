const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands'),

    async execute(interaction, client) {
        const commands = [
            { name: '/play', desc: 'Play a song or playlist' },
            { name: '/pause', desc: 'Pause the music' },
            { name: '/resume', desc: 'Resume the music' },
            { name: '/skip', desc: 'Skip current song' },
            { name: '/stop', desc: 'Stop and clear queue' },
            { name: '/queue', desc: 'View the queue' },
            { name: '/nowplaying', desc: 'Show current song panel' },
            { name: '/volume', desc: 'Adjust volume' },
            { name: '/loop', desc: 'Set loop mode' },
            { name: '/shuffle', desc: 'Shuffle the queue' },
            { name: '/seek', desc: 'Seek to position' },
            { name: '/skipto', desc: 'Skip to specific song' },
            { name: '/move', desc: 'Move song in queue' },
            { name: '/remove', desc: 'Remove song from queue' },
            { name: '/clear', desc: 'Clear the queue' },
            { name: '/search', desc: 'Search for songs' },
            { name: '/lyrics', desc: 'Get song lyrics' },
            { name: '/filter', desc: 'Apply audio filters' },
        ];

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('🎵 Remani Music Bot')
            .setDescription('Your premium music experience')
            .addFields(
                commands.map(cmd => ({
                    name: cmd.name,
                    value: cmd.desc,
                    inline: true,
                }))
            )
            .setFooter({ text: 'Made with ❤️ by God BlazXx' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
