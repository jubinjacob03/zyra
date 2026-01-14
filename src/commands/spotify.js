const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { errorEmbed, infoEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('spotify')
        .setDescription('Test Spotify integration and show status')
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check Spotify API status'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('search')
                .setDescription('Search Spotify for a track')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Search query')
                        .setRequired(true))),

    async execute(interaction, client) {
        const SpotifyAPI = require('../utils/spotify');
        
        if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
            return interaction.reply({ 
                embeds: [errorEmbed('Spotify integration is not configured. Please add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env file.')], 
                flags: 64 
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'status') {
            await interaction.reply({ content: '🔍 Checking Spotify status...', ephemeral: true });

            try {
                const spotifyAPI = new SpotifyAPI(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
                await spotifyAPI.authenticate();

                const embed = new EmbedBuilder()
                    .setColor('#1DB954')
                    .setTitle('🎧 Spotify Integration Status')
                    .addFields(
                        { name: '✅ Authentication', value: 'Connected successfully', inline: true },
                        { name: '🔑 Client ID', value: `${process.env.SPOTIFY_CLIENT_ID.substring(0, 8)}...`, inline: true },
                        { name: '🎵 Features', value: 'Tracks, Playlists, Albums', inline: true }
                    )
                    .setFooter({ text: 'Spotify Web API • Client Credentials Flow' })
                    .setTimestamp();

                await interaction.editReply({ content: null, embeds: [embed] });
            } catch (error) {
                console.error('Spotify status check failed:', error);
                await interaction.editReply({ 
                    content: null,
                    embeds: [errorEmbed(`Spotify authentication failed: ${error.message}`)] 
                });
            }
        }

        if (subcommand === 'search') {
            const query = interaction.options.getString('query');
            await interaction.reply({ content: '🔍 Searching Spotify...', ephemeral: true });

            try {
                const spotifyAPI = new SpotifyAPI(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
                const results = await spotifyAPI.searchTracks(query, 5);

                if (!results || results.length === 0) {
                    return interaction.editReply({ 
                        content: null,
                        embeds: [infoEmbed(`No Spotify results found for: **${query}**`)] 
                    });
                }

                const embed = new EmbedBuilder()
                    .setColor('#1DB954')
                    .setTitle(`🔍 Spotify Search Results`)
                    .setDescription(`Query: **${query}**\n\n${results.map((track, i) => 
                        `**${i + 1}.** [${track.name}](${track.external_urls.spotify})\n` +
                        `*${track.artists.map(a => a.name).join(', ')}* • ${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, '0')}`
                    ).join('\n\n')}`)
                    .setFooter({ text: `Found ${results.length} results` })
                    .setTimestamp();

                await interaction.editReply({ content: null, embeds: [embed] });
            } catch (error) {
                console.error('Spotify search failed:', error);
                await interaction.editReply({ 
                    content: null,
                    embeds: [errorEmbed(`Spotify search failed: ${error.message}`)] 
                });
            }
        }
    },
};
