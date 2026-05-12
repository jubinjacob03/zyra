const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");

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

const findPanelMessage = (messages, clientUserId) =>
  messages.find(
    (message) =>
      (!clientUserId || message.author?.id === clientUserId) &&
      message.components?.some((row) =>
        row.components?.some((component) =>
          isPanelButton(component.customId),
        ),
      ),
  );

async function ensurePlayMusicPanel(channel, instanceName, clientUserId) {
  if (!channel || typeof channel.send !== "function") return null;

  const bullet = "\u2022";

  const helpEmbed = new EmbedBuilder()
    .setColor(0x00ffff)
    .setTitle(`Music Player`)
    .setDescription(
      `Click the button below to play music in this VC !\n\n` +
        `**Supports:**\n` +
        `${bullet} Song names\n` +
        `${bullet} YouTube links\n` +
        `${bullet} Spotify links (tracks & playlists)`,
    );

  const playButton = new ButtonBuilder()
    .setCustomId("play_song")
    .setLabel("Play Music")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(playButton);
  const payload = { embeds: [helpEmbed], components: [row] };

  try {
    const pinned = await channel.messages.fetchPins();
    const existingPinned = findPanelMessage(pinned, clientUserId);
    if (existingPinned) {
      await existingPinned.edit(payload).catch(() => {});
      return existingPinned;
    }
  } catch {}

  try {
    const recent = await channel.messages.fetch({ limit: 100 });
    const existingRecent = findPanelMessage(recent, clientUserId);
    if (existingRecent) {
      await existingRecent.edit(payload).catch(() => {});
      return existingRecent;
    }
  } catch {}

  const message = await channel.send(payload);

  await message.pin().catch(() => {});
  return message;
}

module.exports = { ensurePlayMusicPanel };
