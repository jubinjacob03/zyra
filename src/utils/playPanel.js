const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const { getPlayPanel, setPlayPanel } = require("./panelStore");

const isPanelButton = (customId) => {
  if (!customId || typeof customId !== "string") return false;
  if (customId === "play_song") return true;
  if (customId.startsWith("music_")) return true;
  return [
    "pause",
    "skip",
    "stop",
    "voldown",
    "volup",
    "loop",
    "queue",
    "shuffle",
    "previous",
  ].includes(customId);
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
      message.components?.some((row) =>
        row.components?.some((component) =>
          isPanelButton(component.customId),
        ),
      ),
  );

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
      `${bullet} YouTube links\n` +
      `${bullet} Spotify links (tracks & playlists)`
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
