const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, MessageFlags } = require("discord.js");
const { errorEmbed, infoEmbed } = require("../utils/embed");
const { e } = require("../utils/customEmoji");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("spotify")
    .setDescription("Test Spotify integration and show status")
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Check Spotify API status"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("search")
        .setDescription("Search Spotify for a track")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Search query")
            .setRequired(true),
        ),
    ),

  async execute(interaction, client) {
    const SpotifyAPI = require("../utils/spotify");

    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      return interaction.reply(
        errorEmbed(
          "Spotify integration is not configured. Please add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env file.",
        )
      );
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "status") {
      await interaction.reply({
        content: "🔍 Checking Spotify status...",
        flags: 64,
      });

      try {
        const spotifyAPI = new SpotifyAPI(
          process.env.SPOTIFY_CLIENT_ID,
          process.env.SPOTIFY_CLIENT_SECRET,
        );
        await spotifyAPI.authenticate();

        const container = new ContainerBuilder().setAccentColor(0x1DB954);
        let description = `### ${e("HEADPHONES")} Spotify Integration Status\n\n`;
        description += `**${e("SUCCESS")} Authentication:** Connected successfully\n`;
        description += `**🔑 Client ID:** ${process.env.SPOTIFY_CLIENT_ID.substring(0, 8)}...\n`;
        description += `**${e("MUSIC")} Features:** Tracks, Playlists, Albums`;

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(description)
        );

        await interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error("Spotify status check failed:", error);
        await interaction.editReply({
          content: null,
          ...errorEmbed(`Spotify authentication failed: ${error.message}`),
        });
      }
    }

    if (subcommand === "search") {
      const query = interaction.options.getString("query");
      await interaction.reply({
        content: "🔍 Searching Spotify...",
        flags: 64,
      });

      try {
        const spotifyAPI = new SpotifyAPI(
          process.env.SPOTIFY_CLIENT_ID,
          process.env.SPOTIFY_CLIENT_SECRET,
        );
        const results = await spotifyAPI.searchTracks(query, 5);

        if (!results || results.length === 0) {
          return interaction.editReply({
            content: null,
            ...infoEmbed(`No Spotify results found for: **${query}**`),
          });
        }

        const container = new ContainerBuilder().setAccentColor(0x1DB954);
        let description = `### 🔍 Spotify Search Results\nQuery: **${query}**\n\n`;
        
        results.forEach((track, i) => {
          description += `**${i + 1}.** [${track.name}](${track.external_urls.spotify})\n`;
          description += `*${track.artists.map((a) => a.name).join(", ")}* • ${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, "0")}\n\n`;
        });

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(description)
        );

        await interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error("Spotify search failed:", error);
        await interaction.editReply({
          content: null,
          ...errorEmbed(`Spotify search failed: ${error.message}`),
        });
      }
    }
  },
};
