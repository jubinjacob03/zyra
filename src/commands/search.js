const { createLogger } = require("../utils/logger");
const log = createLogger("search");

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { errorEmbed } = require("../utils/embed");
const DiscordPlayer = require("../utils/DiscordPlayer");
const { searchWithPriority } = require("../utils/musicSearch");
const { buildSearchResultsUi } = require("../utils/searchUi");
const MAX_RESULTS = 5;

/**
 * Search command module.
 * Searches for a song and displays a selection menu.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search for a song")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song to search for")
        .setRequired(true),
    ),

  /**
   * Executes the search command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   * @param {import('discord.js').Client} client - The Discord client.
   */
  async execute(interaction, client) {
    const query = interaction.options.getString("query");
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply(
        errorEmbed("You need to be in a voice channel!"),
      );
    }

    await interaction.reply({ content: `${e("INFO")} Searching...` });

    try {
      const results = await searchWithPriority(
        query,
        interaction.user,
        client,
        MAX_RESULTS,
      );

      if (!results.length) {
        return interaction.editReply(errorEmbed("No results found."));
      }

      const container = buildSearchResultsUi(results, "search_select", query);

      const response = await interaction.editReply({
        content: null,
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });

      const collector = response.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 60000,
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate();

        try {
          const selectedUrl = i.values[0];
          await DiscordPlayer.play(
            interaction,
            selectedUrl,
            voiceChannel,
            client,
          );

          await interaction.deleteReply();
        } catch (error) {
          await interaction.editReply(
            errorEmbed(`Failed to play: ${error.message}`),
          );
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          await interaction.editReply({ components: [] }).catch(() => {});
        }
      });
    } catch (error) {
      log.error("Search error:", error);
      await interaction.editReply(errorEmbed("Search failed."));
    }
  },
};
