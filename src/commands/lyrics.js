const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { errorEmbed } = require('../utils/embed');
const Genius = require('genius-lyrics');
const genius = new Genius.Client();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Get lyrics for the current song or search')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name to search (optional)')),

    async execute(interaction, client) {
        await interaction.deferReply();

        let searchQuery = interaction.options.getString('query');

        if (!searchQuery) {
            const queue = client.distube.getQueue(interaction.guildId);
            if (!queue || !queue.songs[0]) {
                return interaction.editReply({ embeds: [errorEmbed('No song playing. Please provide a search query.')] });
            }
            searchQuery = queue.songs[0].name;
        }

        try {
            const searches = await genius.songs.search(searchQuery);

            if (!searches.length) {
                return interaction.editReply({ embeds: [errorEmbed('No lyrics found for this song.')] });
            }

            const song = searches[0];
            const lyrics = await song.lyrics();

            if (!lyrics) {
                return interaction.editReply({ embeds: [errorEmbed('No lyrics found for this song.')] });
            }

            const chunks = lyrics.match(/[\s\S]{1,4000}/g) || [];

            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle(`🎤 ${song.title}`)
                .setURL(song.url)
                .setThumbnail(song.thumbnail)
                .setDescription(chunks[0])
                .setFooter({ text: `Artist: ${song.artist.name} • Powered by Genius` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            for (let i = 1; i < chunks.length; i++) {
                const followUpEmbed = new EmbedBuilder()
                    .setColor('#9B59B6')
                    .setDescription(chunks[i]);
                await interaction.followUp({ embeds: [followUpEmbed] });
            }
        } catch (error) {
            console.error('Lyrics error:', error);
            await interaction.editReply({ embeds: [errorEmbed('Failed to fetch lyrics.')] });
        }
    },
};
