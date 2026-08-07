const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");
const { errorEmbed } = require("../utils/embed");
const { e } = require("../utils/customEmoji");
const { searchYouTube } = require("../utils/ytdlpPath");

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

  async execute(interaction, client) {
    const query = interaction.options.getString("query");
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply(errorEmbed("You need to be in a voice channel!"));
    }

    await interaction.reply({ content: `${e("INFO")} Searching...` });

    try {
      const results = await searchYouTube(query, 10);

      if (!results || !results.length) {
        return interaction.editReply(errorEmbed("No results found."));
      }

      const formatDur = (s) => { if (!s) return "0:00"; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };
      const icon = e("INFO");
      const description = results
        .map((r, i) => `**${i + 1}.** [${r.title}](${r.url}) - \`${formatDur(r.duration)}\``)
        .join("\n");

      const container = new ContainerBuilder().setAccentColor(0x00ffff);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${icon} Search Results\n\n${description}\n\n*Select a song from the dropdown below*`,
        ),
      );

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("search_select")
        .setPlaceholder("Select a song to play")
        .addOptions(
          results.map((r) => ({
            label: r.title.slice(0, 100),
            description: `${formatDur(r.duration)} • ${r.channel || "Unknown"}`.slice(0, 100),
            value: r.url,
          })),
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);
      container.addActionRowComponents(row);

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
          const result = await client.searchSong(i.values[0], member);
          let queue = client.getQueue(interaction.guildId);
          const isNewQueue = !queue;
          if (!queue) {
            queue = await client.createQueue(interaction.guildId, interaction.channel, voiceChannel);
          }
          await queue.addSong(result);
          if (isNewQueue) await queue.play();
          await interaction.deleteReply();
        } catch (error) {
          await interaction.editReply(errorEmbed(`Failed to play: ${error.message}`));
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          await interaction.editReply({ components: [] }).catch(() => {});
        }
      });
    } catch (error) {
      await interaction.editReply(errorEmbed("Search failed."));
    }
  },
};
