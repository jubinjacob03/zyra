const {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const { e } = require("./customEmoji");

const COLORS = {
  PRIMARY: 0xff0000,
  SUCCESS: 0x00ffff,
  WARNING: 0x00ffff,
  ERROR: 0xff0000,
  INFO: 0x00ffff,
  MUSIC: 0x00ffff,
  SPOTIFY: 0x1db954,
  YOUTUBE: 0xff0000,
  SOUNDCLOUD: 0xff5500,
  PLAYING: 0x00ffff,
  PAUSED: 0x757575,
  ACCENT: 0x00ffff,
  MUTED: 0x757575,
};

function addFooter(container, botName) {
  const ts = Math.floor(Date.now() / 1000);
  let name = botName || "Zyra";
  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${name} · <t:${ts}:f>`),
  );
  return container;
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function createProgressBar(current, total, length = 20) {
  if (!current || !total || total === 0) return "▬".repeat(length);
  const progress = Math.min(current / total, 1);
  const filled = Math.round(progress * length);
  const empty = length - filled;
  return `${"█".repeat(filled)}${"▬".repeat(empty)}`;
}

function successEmbed(description, title = null) {
  const container = new ContainerBuilder().setAccentColor(COLORS.SUCCESS);
  const icon = e("SUCCESS");
  const content = title
    ? `### ${icon} ${title}\n${description}`
    : `${icon} ${description}`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function errorEmbed(description, title = null) {
  const container = new ContainerBuilder().setAccentColor(COLORS.ERROR);
  const icon = e("ERROR");
  const content = title
    ? `### ${icon} ${title}\n${description}`
    : `${icon} ${description}`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 | 64 };
}

function infoEmbed(description, title = null) {
  const container = new ContainerBuilder().setAccentColor(COLORS.INFO);
  const icon = e("INFO");
  const content = title
    ? `### ${icon} ${title}\n${description}`
    : `${icon} ${description}`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function warningEmbed(description, title = null) {
  const container = new ContainerBuilder().setAccentColor(COLORS.WARNING);
  const icon = e("WARNING");
  const content = title
    ? `### ${icon} ${title}\n${description}`
    : `${icon} ${description}`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 | 64 };
}

function queueEmbed(queue, page = 0) {
  const songsPerPage = 8;
  const songs = queue.songs || [];
  const totalPages = Math.ceil(songs.length / songsPerPage) || 1;
  const start = page * songsPerPage;
  const pageSongs = songs.slice(start, start + songsPerPage);

  const playIcon = e("PLAY");
  const queueIcon = e("QUEUE");
  const infoIcon = e("INFO");
  const spotifyIcon = e("SPOTIFY");

  let description = pageSongs
    .map((song, i) => {
      const position = start + i;
      const prefix =
        position === 0
          ? `${playIcon} **Now:**`
          : `\`${position.toString().padStart(2, "0")}.\``;
      const sIcon = song.spotifyData?.isSpotify ? ` ${spotifyIcon}` : "";
      return (
        `${prefix} **${song.name || song.title}**${sIcon}\n` +
        `• *${song.author || "Unknown"}* • \`${song.formattedDuration || formatDuration(song.duration)}\``
      );
    })
    .join("\n\n");

  if (!description) {
    description = `${infoIcon} Queue is empty\n\nUse \`/play\` to add some music!`;
  }

  const totalDuration = songs.reduce((acc, s) => acc + (s.duration || 0), 0);

  const container = new ContainerBuilder().setAccentColor(COLORS.MUSIC);
  const content = `### ${queueIcon} Music Queue\n${description}\n\n**${infoIcon} Queue Stats**\n**Songs:** \`${songs.length}\` • **Duration:** \`${formatDuration(totalDuration)}\` • **Page:** \`${page + 1}/${totalPages}\``;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
  COLORS,
  addFooter,
  successEmbed,
  errorEmbed,
  infoEmbed,
  warningEmbed,
  queueEmbed,
  formatDuration,
  createProgressBar,
};
