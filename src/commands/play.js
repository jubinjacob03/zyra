const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const { errorEmbed } = require("../utils/embed");
const { e } = require("../utils/customEmoji");
const { createLogger } = require("../utils/logger");
const DiscordPlayer = require("../utils/DiscordPlayer");
const { searchWithPriority, formatDuration } = require("../utils/musicSearch");

const log = createLogger("play");
const isUrl = (value) => /^https?:\/\//i.test(value);
const MAX_RESULTS = 5;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or playlist from YouTube or Spotify")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name, YouTube URL, or Spotify URL")
        .setRequired(true),
    ),

  async execute(interaction, client) {
    const query = interaction.options.getString("query");
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply(
        Object.assign(errorEmbed("You need to be in a voice channel!"), {
          flags: 64,
        }),
      );
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has("Connect") || !permissions.has("Speak")) {
      return interaction.reply(
        Object.assign(
          errorEmbed(
            "I need permissions to join and speak in your voice channel!",
          ),
          { flags: 64 },
        ),
      );
    }

    await interaction.deferReply({ flags: 64 });

    try {
      if (isUrl(query)) {
        await playDirectly(interaction, client, query, voiceChannel);
        return;
      }

      log.info(`Searching for: "${query}"`);
      const results = await searchWithPriority(
        query,
        interaction.user,
        client,
        MAX_RESULTS,
      );

      if (!results.length) {
        await interaction.editReply(
          errorEmbed(
            "No YouTube search results found right now. Try again in a moment or use a direct YouTube URL.",
          ),
        );
        return;
      }

      const uiResults = results.slice(0, MAX_RESULTS);

      const container = new ContainerBuilder().setAccentColor(0x00ffff);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${e("MUSIC")} Results for "${query}"`,
        ),
      );

      for (const [i, result] of uiResults.entries()) {
        container.addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small),
        );
        const title =
          result.title.length > 50
            ? `${result.title.slice(0, 50)}...`
            : result.title;
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `\`${i + 1}.\` **${title}**\n-# ${result.author || "Unknown"} · ${formatDuration(result.duration)}`,
          ),
        );
      }

      container.addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      );

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("play_select")
        .setPlaceholder("Select a song to play")
        .addOptions(
          uiResults.map((result, i) => ({
            label: `${i + 1}. ${result.title}`.slice(0, 100),
            description:
              `${formatDuration(result.duration)} • ${result.author || "Unknown"}`.slice(
                0,
                100,
              ),
            value: result.url,
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
        time: 30000,
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate();
        collector.stop("selected");
        const selectedUrl = i.values[0];
        await playDirectly(interaction, client, selectedUrl, voiceChannel);
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          await interaction
            .editReply(errorEmbed("Selection timed out. Use /play again."))
            .catch(() => {});
        }
      });
    } catch (error) {
      log.error("Play error:", error?.message || error);
      try {
        await interaction.editReply(
          errorEmbed(`Could not play: ${error.message}`),
        );
      } catch {
        await interaction.channel.send(
          errorEmbed(`Could not play: ${error.message}`),
        );
      }
    }
  },
};

async function playDirectly(interaction, client, query, voiceChannel) {
  const { isPlaylist, count, track } = await DiscordPlayer.play(
    interaction,
    query,
    voiceChannel,
    client,
  );

  const container = new ContainerBuilder().setAccentColor(0x00ffff);
  if (isPlaylist) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${e("MUSIC")} **${count} songs** from playlist added to queue`,
      ),
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${e("MUSIC")} **${track.title}** added to queue`,
      ),
    );
  }

  await interaction
    .editReply({
      content: null,
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    })
    .catch(async () => {
      await interaction.channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    });
}
