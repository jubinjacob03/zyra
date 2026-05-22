const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  MessageFlags,
} = require("discord.js");
const { e, btn } = require("./customEmoji");

const COLORS = {
  PLAYING: 0xff0000,
  PAUSED: 0xaa0000,
  SPOTIFY: 0x1db954,
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
  const song = queue?.songs?.[0];
  if (!song) return null;

  const isSpotify = song.spotifyData?.isSpotify;
  const isPaused = queue.paused;
  const color = isSpotify
    ? COLORS.SPOTIFY
    : isPaused
      ? COLORS.PAUSED
      : COLORS.PLAYING;

  const platformIcon = isSpotify ? e("SPOTIFY") || "🟢" : e("YOUTUBE") || "🔴";
  const platformName = isSpotify ? "Spotify" : "YouTube";
  const duration = song.formattedDuration || formatTime(song.duration || 0);
  const requester = song.user?.displayName || song.user?.username || "Unknown";
  const authorIcon = e("AUTHOR");
  const titleIcon = e("PLAYLIST");

  const description = `${titleIcon} **${song.name}**\n\nby **${song.author || "Unknown Artist"}**\n\n${platformIcon} ${platformName} • ${duration} • ${authorIcon} @${requester}`;

  const container = new ContainerBuilder().setAccentColor(color);
  
  if (song.thumbnail && typeof song.thumbnail === "string") {
    const { ThumbnailBuilder } = require("discord.js");
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(song.thumbnail));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
  }

  return container;
}

function createControlButtons(queue) {
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
      .setEmoji(queue?.paused ? btn("PLAY") : btn("PAUSE"))
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

  const loopEmoji = queue?.repeatMode === 1 ? btn("LOOP_ONE") : btn("LOOP");
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
  );

  return [row1, row2];
}

function createCompleteMusicController(queue) {
  const container = createNowPlayingEmbed(queue);
  if (!container) return null;
  
  const { SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
  );
  
  const buttons = createControlButtons(queue);
  buttons.forEach(row => container.addActionRowComponents(row));
  
  const { addFooter } = require("./embed");
  addFooter(container);

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
  createNowPlayingEmbed,
  createControlButtons,
  createCompleteMusicController,
  formatTime,
  createProgressBar,
};
