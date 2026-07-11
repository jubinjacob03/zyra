const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const { e, btn } = require("./customEmoji");

const COLORS = {
  PLAYING: 0x00ffff,
  PAUSED: 0x00aaaa,
  SPOTIFY: 0x1db954,
  SOUNDCLOUD: 0xff5500,
  YOUTUBE: 0xff0000,
};

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0)
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function createProgressBar(current, total, length = 18) {
  if (!total || total === 0) return "━".repeat(length);
  const progress = Math.min((current || 0) / total, 1);
  const pos = Math.min(Math.round(progress * (length - 1)), length - 1);
  return "━".repeat(pos) + "●" + "━".repeat(length - pos - 1);
}

function createNowPlayingEmbed(queue) {
  const song = queue?.songs?.[0] || queue?.currentTrack;
  if (!song) return null;

  const isSpotify = song.spotifyData?.isSpotify;
  const isPaused = queue.paused;
  const color = isSpotify
    ? COLORS.SPOTIFY
    : isPaused
      ? COLORS.PAUSED
      : COLORS.YOUTUBE;

  const platformIcon = isSpotify ? e("SPOTIFY") : e("YOUTUBE");
  const platformName = isSpotify ? "Spotify" : "YouTube";
  const duration = song.formattedDuration || formatTime(song.duration || 0);
  const requester = song.user?.displayName || song.user?.username || "Unknown";
  const titleIcon = e("PLAYLIST");

  const title = song.name || song.title || "Unknown";
  const author = song.author || "Unknown Artist";

  const description = `${titleIcon} **${title}**\n\nby **${author}**\n\n${platformIcon} ${platformName} • ${duration} • @${requester}`;

  const container = new ContainerBuilder().setAccentColor(color);

  const thumbnail = song.thumbnail;
  if (thumbnail && typeof thumbnail === "string") {
    try {
      const { ThumbnailBuilder } = require("discord.js");
      const section = new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(description),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail));
      container.addSectionComponents(section);
    } catch {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(description),
      );
    }
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(description),
    );
  }

  return container;
}

function createControlButtons(queue) {
  const isPaused = queue.paused;
  const repeatMode = queue.repeatMode || 0;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_shuffle")
      .setEmoji(btn("SHUFFLE"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_previous")
      .setEmoji(btn("PREVIOUS"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("music_pause")
      .setEmoji(isPaused ? btn("PLAY") : btn("PAUSE"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_skip")
      .setEmoji(btn("SKIP"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setEmoji(btn("STOP"))
      .setStyle(ButtonStyle.Secondary),
  );

  const loopEmoji = repeatMode === 1 ? btn("LOOP_ONE") : btn("LOOP");
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_voldown")
      .setEmoji(btn("VOLDOWN"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_volup")
      .setEmoji(btn("VOLUP"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_loop")
      .setEmoji(loopEmoji)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_queue")
      .setEmoji(btn("QUEUE"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_refresh")
      .setEmoji(btn("REFRESH"))
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

function createCompleteMusicController(queue) {
  const container = createNowPlayingEmbed(queue);
  if (!container) return null;

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Large),
  );

  const buttons = createControlButtons(queue);
  buttons.forEach((row) => container.addActionRowComponents(row));

  const botName = queue.client?.user?.username || "Zyra";

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small),
  );
  const ts = Math.floor(Date.now() / 1000);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${botName} · <t:${ts}:f>`),
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function createIdleMusicController(message, botName) {
  const container = new ContainerBuilder().setAccentColor(0x00ffff);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${e("MUSIC")} ${message}`),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small),
  );
  const ts = Math.floor(Date.now() / 1000);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${botName || "Zyra"} · <t:${ts}:f>`),
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
  createNowPlayingEmbed,
  createControlButtons,
  createCompleteMusicController,
  createIdleMusicController,
  formatTime,
  createProgressBar,
  COLORS,
};
