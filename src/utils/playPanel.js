const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const { getPlayPanel, setPlayPanel } = require("./panelStore");

/**
 * Checks if a custom ID belongs to the play music panel button.
 * @param {string} customId - The custom ID to check.
 * @returns {boolean} True if it's the play panel button.
 */
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

/**
 * Checks if a message is editable by the client.
 * @param {import('discord.js').Message} message - The message to check.
 * @param {string} clientUserId - The client's user ID.
 * @returns {boolean} True if the message is editable by the client.
 */
const isEditableByClient = (message, clientUserId) => {
  if (!message) return false;
  if (typeof message.editable === "boolean") return message.editable;
  if (!clientUserId) return true;
  return message.author?.id === clientUserId;
};

/**
 * Finds a panel message in a collection of messages.
 * @param {import('discord.js').Collection<string, import('discord.js').Message>} messages - The messages to search.
 * @param {string} clientUserId - The client's user ID.
 * @returns {import('discord.js').Message|undefined} The found panel message, or undefined.
 */
const findPanelMessage = (messages, clientUserId) =>
  messages.find(
    (message) =>
      isEditableByClient(message, clientUserId) &&
      hasPanelButton(message.components),
  );

/**
 * Ensures that the play music panel exists in the specified channel.
 * Creates a new panel if one doesn't exist, or updates the existing one.
 * @param {import('discord.js').TextChannel} channel - The channel to ensure the panel in.
 * @param {string} instanceName - The name of the bot instance.
 * @param {string} clientUserId - The client's user ID.
 * @returns {Promise<import('discord.js').Message|null>} The panel message, or null if failed.
 */
async function ensurePlayMusicPanel(channel, instanceName, clientUserId) {
  if (!channel || typeof channel.send !== "function") return null;

  const bullet = "\u2022";

  const container = new ContainerBuilder().setAccentColor(0x00ffff);
  const { SectionBuilder, ThumbnailBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require("discord.js");
  
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🎵 Music Player\nClick the button below to play music in this VC!\n-# \u200B\n**Supports:**`
      )
    );
    
  if (channel.client?.user) {
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(channel.client.user.displayAvatarURL({ extension: 'png' })));
  }
  container.addSectionComponents(section);
  
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${bullet} Song names\n` +
      `${bullet} Tracks (YouTube, Spotify, SoundCloud)\n` +
      `${bullet} Playlists (YouTube - no Mix, Spotify, SoundCloud)`
    )
  );

  const playButton = new ButtonBuilder()
    .setCustomId("play_song")
    .setLabel("Play Music")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(playButton);
  container.addActionRowComponents(row);

  const { addFooter } = require("./embed");
  addFooter(container);

  const payload = { components: [container], flags: MessageFlags.IsComponentsV2 };

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
  } catch {}

  try {
    const recent = await channel.messages.fetch({ limit: 100 });
    const existingRecent = findPanelMessage(recent, clientUserId);
    if (existingRecent) {
      await existingRecent.edit(payload).catch(() => {});
      setPlayPanel(channel.id, existingRecent.id);
      return existingRecent;
    }
  } catch {}

  const message = await channel.send(payload);

  await message.pin().catch(() => {});
  setPlayPanel(channel.id, message.id);
  return message;
}

module.exports = { ensurePlayMusicPanel };
