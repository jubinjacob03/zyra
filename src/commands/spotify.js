const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const { errorEmbed, infoEmbed } = require("../utils/embed");
const { e } = require("../utils/customEmoji");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("spotify")
    .setDescription("Test Spotify integration and show status")
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Check Spotify API status"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("search")
        .setDescription("Search Spotify for a track")
        .addStringOption((option) =>
          option.setName("query").setDescription("Search query").setRequired(true),
        ),
    ),

  async execute(interaction) {
    const SpotifyAPI = require("../utils/spotify");

    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      return interaction.reply(
        errorEmbed("Spotify integration is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env."),
      );
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "status") {
      await interaction.reply({ content: `${e("INFO")} Checking Spotify status...`, flags: 64 });

      try {
        const spotifyAPI = new SpotifyAPI(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
        await spotifyAPI.authenticate();

        const icon = e("SPOTIFY");
        const container = new ContainerBuilder().setAccentColor(0x1db954);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### ${icon} Spotify Integration Status\n\n` +
              `**Authentication:** Connected\n` +
              `**Client ID:** ${process.env.SPOTIFY_CLIENT_ID.substring(0, 8)}...\n` +
              `**Features:** Tracks, Playlists, Albums`,
          ),
        );

        await interaction.editReply({
          content: null,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (error) {
        await interaction.editReply(errorEmbed(`Spotify authentication failed: ${error.message}`));
      }
    }

    if (subcommand === "search") {
      const query = interaction.options.getString("query");
      await interaction.reply({ content: `${e("INFO")} Searching Spotify...`, flags: 64 });

      try {
        const spotifyAPI = new SpotifyAPI(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET);
        const results = await spotifyAPI.searchTracks(query, 5);

        if (!results || results.length === 0) {
          return interaction.editReply(infoEmbed(`No Spotify results found for: **${query}**`));
        }

        const list = results
          .map((track, i) => {
            const dur = `${Math.floor(track.duration_ms / 60000)}:${String(Math.floor((track.duration_ms % 60000) / 1000)).padStart(2, "0")}`;
            return `**${i + 1}.** [${track.name}](${track.external_urls.spotify})\n*${track.artists.map((a) => a.name).join(", ")}* • ${dur}`;
          })
          .join("\n\n");

        const container = new ContainerBuilder().setAccentColor(0x1db954);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### ${e("INFO")} Spotify Search Results\n**Query:** ${query}\n\n${list}`,
          ),
        );

        await interaction.editReply({
          content: null,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (error) {
        await interaction.editReply(errorEmbed(`Spotify search failed: ${error.message}`));
      }
    }
  },
};
