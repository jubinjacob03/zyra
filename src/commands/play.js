const {
  SlashCommandBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = require("discord.js");
const { errorEmbed } = require("../utils/embed");
const { e } = require("../utils/customEmoji");
const { createLogger } = require("../utils/logger");
const { searchYouTube } = require("../utils/ytdlpPath");

const log = createLogger("play");

const isUrl = (str) => /^https?:\/\//.test(str);

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
        Object.assign(errorEmbed("You need to be in a voice channel!"), { flags: 64 }),
      );
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has("Connect") || !permissions.has("Speak")) {
      return interaction.reply(
        Object.assign(errorEmbed("I need permissions to join and speak in your voice channel!"), { flags: 64 }),
      );
    }

    await interaction.deferReply({ flags: 64 });

    try {
      if (isUrl(query)) {
        return await playDirectly(interaction, client, query, member, voiceChannel);
      }

      log.info(`Searching for: "${query}"`);
      const results = await searchYouTube(query, 5);

      if (!results || results.length === 0) {
        return await playDirectly(interaction, client, query, member, voiceChannel);
      }

      const container = new ContainerBuilder().setAccentColor(0x00ffff);

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### ${e("MUSIC")} Results for "${query}"`,
        ),
      );

      for (const [i, r] of results.entries()) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
        );
        const title = r.title.length > 50 ? r.title.slice(0, 50) + "…" : r.title;
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `\`${i + 1}.\` **${title}**\n-# ${r.channel || "Unknown"} · ${formatDur(r.duration)}`,
          ),
        );
      }

      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      );

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("play_select")
        .setPlaceholder("Select a song to play")
        .addOptions(
          results.map((r, i) => ({
            label: `${i + 1}. ${r.title}`.slice(0, 100),
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
        time: 30000,
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate();
        collector.stop("selected");
        const selectedUrl = i.values[0];
        await playDirectly(interaction, client, selectedUrl, member, voiceChannel);
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          await interaction.editReply(
            errorEmbed("Selection timed out. Use `/play` again."),
          ).catch(() => {});
        }
      });
    } catch (error) {
      log.error("Play error:", error?.message || error);
      try {
        await interaction.editReply(errorEmbed(`Could not play: ${error.message}`));
      } catch {
        await interaction.channel.send(errorEmbed(`Could not play: ${error.message}`));
      }
    }
  },
};

async function playDirectly(interaction, client, query, member, voiceChannel) {
  try {
    const result = await Promise.race([
      client.searchSong(query, member),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Search timeout")), 30000),
      ),
    ]);

    if (!result) {
      return interaction.editReply(errorEmbed("No results found."));
    }

    let queue = client.getQueue(interaction.guildId);
    const isNewQueue = !queue;

    if (!queue) {
      queue = await client.createQueue(interaction.guildId, interaction.channel, voiceChannel);
    }

    if (result.type === "playlist") {
      await queue.addSongs(result.songs);
    } else {
      await queue.addSong(result);
    }

    if (isNewQueue) {
      await queue.play();
    }

    const container = new ContainerBuilder().setAccentColor(0x00ffff);
    const icon = e("MUSIC");

    if (result.type === "playlist") {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${icon} **${result.songs.length} songs** from playlist added to queue`,
        ),
      );
    } else {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${icon} **${result.name}** added to queue`,
        ),
      );
    }

    await interaction.editReply({
      content: null,
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});

    if (result.spotifyData?.remainingTracks?.length > 0) {
      client.processSpotifyPlaylistBackground(queue, result.spotifyData.remainingTracks, interaction.channel);
    }
  } catch (error) {
    await interaction.editReply(errorEmbed(`Could not play: ${error.message}`)).catch(() => {});
  }
}

function formatDur(seconds) {
  if (!seconds) return "0:00";
  if (seconds > 10000) seconds = Math.floor(seconds / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
