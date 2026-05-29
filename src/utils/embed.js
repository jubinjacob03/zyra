const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = require("discord.js");
const { e, btn } = require("./customEmoji");

/**
 * Appends a dynamic timestamp and branding footer to the provided container.
 * Adjusts branding string intelligently based on provided bot name characteristics.
 * @param {import('discord.js').ContainerBuilder} container
 * @param {string} [botName]
 * @returns {import('discord.js').ContainerBuilder}
 */
function addFooter(container, botName) {
  const ts = Math.floor(Date.now() / 1000);
  let name = botName || "NexKord";
  if (name.toLowerCase().includes("remani")) {
    name = "Remani";
  }

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

const ICONS = {
  PLAY: e("PLAY"),
  PAUSE: e("PAUSE"),
  STOP: e("STOP"),
  SKIP: e("SKIP"),
  PREVIOUS: e("PREVIOUS"),
  SHUFFLE: e("SHUFFLE"),
  REPEAT: e("LOOP"),
  REPEAT_ONE: e("LOOP_ONE"),

  VOLUME_HIGH: e("VOLUP"),
  VOLUME_MID: e("VOLDOWN"),
  VOLUME_LOW: e("VOLDOWN"),
  QUEUE: e("QUEUE"),
  MUSIC_NOTE: e("MUSIC"),
  HEADPHONES: e("HEADPHONES"),

  SUCCESS: e("SUCCESS"),
  ERROR: e("ERROR"),
  WARNING: e("WARNING"),
  INFO: e("INFO"),
  LIVE: e("YOUTUBE"),

  SPOTIFY: e("SPOTIFY"),
  YOUTUBE: e("YOUTUBE"),

  USER: e("USER"),
  TIME: e("TIME"),
  DOT: "•",
  ARROW: "→",
  BAR: "▬",
  CIRCLE: "●",
};

/**
 * Creates a modern progress bar using Unicode characters.
 * @param {number} current - The current progress value.
 * @param {number} total - The total value.
 * @param {number} [length=20] - The length of the progress bar.
 * @returns {string} The progress bar string.
 */
function createProgressBar(current, total, length = 20) {
  if (!current || !total || total === 0) return "▬".repeat(length);

  const progress = Math.min(current / total, 1);
  const filled = Math.round(progress * length);
  const empty = length - filled;

  const filledBar = "█".repeat(filled);
  const emptyBar = "▬".repeat(empty);

  return `${filledBar}${emptyBar}`;
}

/**
 * Formats a duration in seconds to a readable string (MM:SS or HH:MM:SS).
 * @param {number} seconds - The duration in seconds.
 * @returns {string} The formatted time string.
 */
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

/**
 * Creates a beautiful, Material Design inspired music panel embed.
 * This will be the main interactive controller within Discord.
 * @param {import('discord-player').GuildQueue} queue - The music queue object.
 * @returns {Object|null} The message payload containing the components and flags, or null if no song is playing.
 */
function createMusicPanel(queue) {
  const song = queue.currentTrack;
  if (!song) return null;

  const loopModes = [
    "Off",
    `${ICONS.REPEAT_ONE} Song`,
    `${ICONS.REPEAT} Queue`,
    `${ICONS.REPEAT} Autoplay`,
  ];
  const volumeIcon =
    queue.node.volume > 66
      ? ICONS.VOLUME_HIGH
      : queue.node.volume > 33
        ? ICONS.VOLUME_MID
        : ICONS.VOLUME_LOW;

  const progressBar = createProgressBar(
    queue.node.getTimestamp()?.current.value || 0,
    song.durationMS || 100,
    15,
  );
  const isSpotify = song.source === "spotify";
  const isSoundCloud = song.source === "soundcloud";
  const color = isSpotify
    ? COLORS.SPOTIFY
    : isSoundCloud
      ? COLORS.SOUNDCLOUD
      : COLORS.PRIMARY;
  const platformIcon = isSpotify ? ICONS.SPOTIFY : ICONS.LIVE;
  const platformName = isSpotify
    ? "SPOTIFY"
    : isSoundCloud
      ? "SOUNDCLOUD"
      : "NOW PLAYING";

  const container = new ContainerBuilder().setAccentColor(color);

  let description = `### ${platformIcon} ${platformName}\n**[${song.title}](${song.url})**\n**${song.author || "Unknown Artist"}**\n\n`;
  description += `${ICONS.TIME} \`${formatDuration(Math.floor((queue.node.getTimestamp()?.current.value || 0) / 1000))} ${progressBar} ${song.duration}\`\n`;
  description += `${ICONS.USER} ${song.requestedBy?.displayName || song.requestedBy?.username || "Unknown"}\n`;
  description += `${volumeIcon} \`${queue.node.volume}%\` ${ICONS.DOT} ${loopModes[queue.repeatMode]} ${ICONS.DOT} \`${queue.tracks.size} songs\``;

  if (song.thumbnail && typeof song.thumbnail === "string") {
    const { ThumbnailBuilder } = require("discord.js");
    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(description),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(song.thumbnail));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(description),
    );
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_shuffle")
      .setEmoji(btn("SHUFFLE"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_previous")
      .setEmoji(btn("PREVIOUS"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!queue.history.previousTrack),
    new ButtonBuilder()
      .setCustomId("music_pause")
      .setEmoji(queue.node.isPaused() ? btn("PLAY") : btn("PAUSE"))
      .setStyle(
        queue.node.isPaused() ? ButtonStyle.Success : ButtonStyle.Primary,
      ),
    new ButtonBuilder()
      .setCustomId("music_skip")
      .setEmoji(btn("SKIP"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setEmoji(btn("STOP"))
      .setStyle(ButtonStyle.Danger),
  );

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
      .setEmoji(btn("LOOP"))
      .setStyle(
        queue.repeatMode > 0 ? ButtonStyle.Success : ButtonStyle.Secondary,
      ),
    new ButtonBuilder()
      .setCustomId("music_queue")
      .setEmoji(btn("QUEUE"))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_refresh")
      .setEmoji(btn("REFRESH"))
      .setStyle(ButtonStyle.Secondary),
  );

  container.addActionRowComponents(row1);
  container.addActionRowComponents(row2);

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Creates a clean "Now Playing" notification embed.
 * @param {import('discord-player').Track} song - The song object.
 * @param {import('discord-player').GuildQueue} queue - The music queue object.
 * @param {string} [type="playing"] - The type of notification ("playing" or "added").
 * @returns {Object} The message payload containing the components and flags.
 */
function createNowPlayingEmbed(song, queue, type = "playing") {
  const isAdded = type === "added";
  const title = isAdded
    ? `${ICONS.SUCCESS} Added to Queue`
    : `${ICONS.MUSIC_NOTE} Now Playing`;
  const color = isAdded
    ? COLORS.SUCCESS
    : song.source === "spotify"
      ? COLORS.SPOTIFY
      : song.source === "soundcloud"
        ? COLORS.SOUNDCLOUD
        : COLORS.PRIMARY;

  const container = new ContainerBuilder().setAccentColor(color);

  let description = `### ${title}\n**[${song.title}](${song.url})**\n*${song.author || "Unknown Artist"}*\n\n`;
  description += `**${ICONS.TIME} Duration:** \`${song.duration}\`\n`;
  description += `**${ICONS.USER} Requested:** ${song.requestedBy}\n`;
  description += `**${ICONS.QUEUE} Position:** \`#${queue.tracks.size}\``;

  if (song.thumbnail && typeof song.thumbnail === "string") {
    const { ThumbnailBuilder } = require("discord.js");
    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(description),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(song.thumbnail));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(description),
    );
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Creates a success embed with Material Design styling.
 * @param {string} description - The success message description.
 * @param {string|null} [title=null] - An optional title for the embed.
 * @returns {Object} The message payload containing the components and flags.
 */
function successEmbed(description, title = null) {
  const container = new ContainerBuilder().setAccentColor(COLORS.SUCCESS);
  const content = title
    ? `### ${ICONS.SUCCESS} ${title}\n${description}`
    : `${ICONS.SUCCESS} ${description}`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Creates an error embed with Material Design styling.
 * @param {string} description - The error message description.
 * @param {string|null} [title=null] - An optional title for the embed.
 * @returns {Object} The message payload containing the components and flags.
 */
function errorEmbed(description, title = null) {
  const container = new ContainerBuilder().setAccentColor(COLORS.ERROR);
  const content = title
    ? `### ${ICONS.ERROR} ${title}\n${description}`
    : `${ICONS.ERROR} ${description}`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Create info embed with Material Design styling
 */
function infoEmbed(description, title = null) {
  const container = new ContainerBuilder().setAccentColor(COLORS.INFO);
  const content = title
    ? `### ${ICONS.INFO} ${title}\n${description}`
    : `${ICONS.INFO} ${description}`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Create warning embed with Material Design styling
 */
function warningEmbed(description, title = null) {
  const container = new ContainerBuilder().setAccentColor(COLORS.WARNING);
  const content = title
    ? `### ${ICONS.WARNING} ${title}\n${description}`
    : `${ICONS.WARNING} ${description}`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Create beautiful queue display embed
 */
function queueEmbed(queue, page = 0) {
  const songsPerPage = 8;
  const totalPages = Math.ceil(queue.tracks.size / songsPerPage) || 1;
  const start = page * songsPerPage;
  const songs = queue.tracks.toArray().slice(start, start + songsPerPage);

  let description = songs
    .map((song, i) => {
      const position = start + i + 1;
      const prefix = `\`${position.toString().padStart(2, "0")}.\``;

      const spotifyIcon = song.source === "spotify" ? ` ${ICONS.SPOTIFY}` : "";
      return (
        `${prefix} **[${song.title}](${song.url})**${spotifyIcon}\n` +
        `${ICONS.DOT} *${song.author || "Unknown"}* ${ICONS.DOT} \`${song.duration}\``
      );
    })
    .join("\n\n");

  if (queue.currentTrack && page === 0) {
    const current = queue.currentTrack;
    const spotifyIcon = current.source === "spotify" ? ` ${ICONS.SPOTIFY}` : "";
    description =
      `${ICONS.PLAY} **Now:** **[${current.title}](${current.url})**${spotifyIcon}\n${ICONS.DOT} *${current.author || "Unknown"}* ${ICONS.DOT} \`${current.duration}\`\n\n` +
      description;
  }

  if (!description) {
    description = `${ICONS.INFO} Queue is empty\n\nUse \`/play\` to add some music!`;
  }

  const totalDuration = queue.tracks
    .toArray()
    .reduce((acc, song) => acc + (song.durationMS || 0), 0);

  const container = new ContainerBuilder().setAccentColor(COLORS.MUSIC);
  const content = `### ${ICONS.QUEUE} Music Queue\n${description}\n\n**${ICONS.INFO} Queue Stats**\n**Songs:** \`${queue.tracks.size}\` ${ICONS.DOT} **Duration:** \`${formatDuration(Math.floor(totalDuration / 1000))}\` ${ICONS.DOT} **Page:** \`${page + 1}/${totalPages}\``;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Create playlist embed for Spotify/YouTube playlists
 */
function playlistEmbed(playlist, isSpotify = false) {
  const color = isSpotify ? COLORS.SPOTIFY : COLORS.YOUTUBE;
  const icon = isSpotify ? ICONS.SPOTIFY : ICONS.YOUTUBE;
  const platform = isSpotify ? "Spotify" : "YouTube";

  const container = new ContainerBuilder().setAccentColor(color);

  let description = `### ${ICONS.SUCCESS} Added ${platform} Playlist\n**[${playlist.title}](${playlist.url})**\n\n`;
  description += `**${ICONS.MUSIC_NOTE} Songs:** \`${playlist.tracks.length}\`\n`;
  description += `**${ICONS.USER} Requested by:** ${playlist.tracks[0]?.requestedBy}\n`;
  description += `**${icon} Platform:** \`${platform}\``;

  if (playlist.thumbnail && typeof playlist.thumbnail === "string") {
    const { ThumbnailBuilder } = require("discord.js");
    const section = new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(description),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(playlist.thumbnail));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(description),
    );
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
  COLORS,
  ICONS,
  createMusicPanel,
  createNowPlayingEmbed,
  successEmbed,
  errorEmbed,
  infoEmbed,
  warningEmbed,
  queueEmbed,
  playlistEmbed,
  formatDuration,
  createProgressBar,
  addFooter,
};
