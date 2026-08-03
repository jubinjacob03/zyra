const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = require("discord.js");
const { e } = require("./customEmoji");
const { formatDuration } = require("./musicSearch");

function buildSearchResultsUi(results, customId, query) {
  const icon = e("MUSIC");
  const container = new ContainerBuilder().setAccentColor(0x00ffff);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`### ${icon} Results for "${query}"`),
  );

  results.forEach((result, index) => {
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
        `\`${index + 1}.\` **${title}**\n-# ${result.author || "Unknown"} · ${formatDuration(result.duration)}`,
      ),
    );
  });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `*Select a song from the dropdown below*`,
    ),
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Select a song to play")
    .addOptions(
      results.map((result) => ({
        label: result.title.slice(0, 100),
        description:
          `${formatDuration(result.duration)} • ${result.author || "Unknown"}`.slice(
            0,
            100,
          ),
        value: result.url,
      })),
    );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(selectMenu),
  );

  return container;
}

module.exports = {
  buildSearchResultsUi,
};
