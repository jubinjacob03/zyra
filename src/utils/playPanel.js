const {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const { getPlayPanel, setPlayPanel } = require("./panelStore");
const { createLogger } = require("./logger");
const { e } = require("./customEmoji");

const log = createLogger("playPanel");

const isPanelButton = (customId) => {
  if (!customId || typeof customId !== "string") return false;
  return customId === "play_song" || customId.startsWith("music_");
};

const hasPanelButton = (components) => {
  if (!Array.isArray(components)) return false;
  for (const comp of components) {
    if (isPanelButton(comp.customId)) return true;
    if (comp.components && hasPanelButton(comp.components)) return true;
  }
  return false;
};

const isEditableByClient = (message, clientUserId) => {
  if (!message) return false;
  if (typeof message.editable === "boolean") return message.editable;
  if (!clientUserId) return true;
  return message.author?.id === clientUserId;
};

const findPanelMessage = (messages, clientUserId) =>
  messages.find(
    (message) =>
      isEditableByClient(message, clientUserId) &&
      hasPanelButton(message.components),
  );

async function ensurePlayMusicPanel(channel, instanceName, clientUserId) {
  if (!channel || typeof channel.send !== "function") return null;

  const bullet = "\u2022";

  const container = new ContainerBuilder().setAccentColor(0x00ffff);
  const { ThumbnailBuilder } = require("discord.js");

  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### 🎵 Music Player\nClick the button below to play music in this VC!\n-# \u200B\n**Supports:**`,
    ),
  );

  if (channel.client?.user) {
    section.setThumbnailAccessory(
      new ThumbnailBuilder().setURL(
        channel.client.user.displayAvatarURL({ extension: "png" }),
      ),
    );
  }
  container.addSectionComponents(section);

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${bullet} Song names\n` +
        `${bullet} Tracks (YouTube, Spotify, SoundCloud)\n` +
        `${bullet} Playlists (YouTube, Spotify)`,
    ),
  );

  const playButton = new ButtonBuilder()
    .setCustomId("play_song")
    .setLabel("Play Music")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(playButton);
  container.addActionRowComponents(row);

  container.addSeparatorComponents(
    new SeparatorBuilder()
      .setDivider(true)
      .setSpacing(SeparatorSpacingSize.Small),
  );
  const ts = Math.floor(Date.now() / 1000);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${channel.client?.user?.username || "Zyra"} · <t:${ts}:f>`,
    ),
  );

  const payload = {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };

  const storedId = getPlayPanel(channel.id);
  if (storedId && channel.messages?.fetch) {
    try {
      const stored = await channel.messages.fetch(storedId);
      if (stored && isEditableByClient(stored, clientUserId)) {
        await stored.edit(payload).catch(() => {});
        return stored;
      }
    } catch (error) {
      if (error?.code === 10008 || error?.code === 10003) {
        setPlayPanel(channel.id, null);
      }
    }
  }

  try {
    const pinned = await channel.messages.fetchPins();
    const existingPinned = findPanelMessage(pinned, clientUserId);
    if (existingPinned) {
      await existingPinned.edit(payload).catch(() => {});
      setPlayPanel(channel.id, existingPinned.id);
      return existingPinned;
    }
  } catch (err) {
    log.debug("Pinned-message panel lookup failed:", err?.message || err);
  }

  try {
    const recent = await channel.messages.fetch({ limit: 100 });
    const existingRecent = findPanelMessage(recent, clientUserId);
    if (existingRecent) {
      await existingRecent.edit(payload).catch(() => {});
      setPlayPanel(channel.id, existingRecent.id);
      return existingRecent;
    }
  } catch (err) {
    log.debug("Recent-message panel lookup failed:", err?.message || err);
  }

  const message = await channel.send(payload);
  await message.pin().catch(() => {});
  setPlayPanel(channel.id, message.id);
  return message;
}

module.exports = { ensurePlayMusicPanel };
