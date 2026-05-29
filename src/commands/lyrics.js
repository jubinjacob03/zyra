const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  MessageFlags,
} = require("discord.js");
const { errorEmbed } = require("../utils/embed");
const { e } = require("../utils/customEmoji");
const Genius = require("genius-lyrics");
const genius = new Genius.Client();

/**
 * Lyrics command module.
 * Fetches and displays lyrics for the current song or a search query.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription("Get lyrics for the current song or search")
    .addStringOption((option) =>
      option.setName("query").setDescription("Song name to search (optional)"),
    ),

  /**
   * Executes the lyrics command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   * @param {import('discord.js').Client} client - The Discord client.
   */
  async execute(interaction, client) {
    let searchQuery = interaction.options.getString("query");

    if (!searchQuery) {
      const queue = client.player.nodes.get(interaction.guildId);
      if (!queue || !queue.currentTrack) {
        const container = new ContainerBuilder().setAccentColor(0xff4444);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${e("ERROR")} No song playing. Please provide a search query.`,
          ),
        );
        return interaction.reply({
          components: [container],
          flags: MessageFlags.IsComponentsV2 | 64,
        });
      }
      searchQuery = queue.currentTrack.title;
    }

    await interaction.reply({
      content: `${e("INFO")} Searching for lyrics...`,
      flags: 64,
    });

    try {
      const searches = await genius.songs.search(searchQuery);

      if (!searches.length) {
        const container = new ContainerBuilder().setAccentColor(0xff4444);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${e("ERROR")} No lyrics found for this song.`,
          ),
        );
        return interaction.editReply({
          content: null,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const song = searches[0];
      const lyrics = await song.lyrics();

      if (!lyrics) {
        const container = new ContainerBuilder().setAccentColor(0xff4444);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${e("ERROR")} No lyrics found for this song.`,
          ),
        );
        return interaction.editReply({
          content: null,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const container = new ContainerBuilder().setAccentColor(0x00ffff);
      let description = `### ${e("AUTHOR")} [${song.title}](${song.url})\n*Artist: ${song.artist.name}*\n\n`;

      const lyricsText =
        lyrics.length > 3800
          ? lyrics.substring(0, 3800) +
            "...\n\n*(Lyrics truncated due to length)*"
          : lyrics;
      description += lyricsText;

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(description),
      );

      await interaction.editReply({
        content: null,
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (error) {
      console.error("Lyrics error:", error);
      const container = new ContainerBuilder().setAccentColor(0xff4444);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${e("ERROR")} Failed to fetch lyrics.`,
        ),
      );
      await interaction.editReply({
        content: null,
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    }
  },
};
