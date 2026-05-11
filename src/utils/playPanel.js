const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");

async function ensurePlayMusicPanel(channel, instanceName, clientUserId) {
  if (!channel || typeof channel.send !== "function") return null;

  let existing = null;
  try {
    const pinned = await channel.messages.fetchPins();
    existing = pinned.find(
      (message) =>
        message.author?.id === clientUserId &&
        message.components?.some((row) =>
          row.components?.some(
            (component) => component.customId === "play_song",
          ),
        ),
    );
  } catch {}

  if (existing) return existing;

  const bullet = "\u2022";

  const helpEmbed = new EmbedBuilder()
    .setColor(0x00ffff)
    .setTitle(`Music Player`)
    .setDescription(
      `Click the button below to play music in this VC!\n\n` +
        `**Supports:**\n` +
        `${bullet} Song names\n` +
        `${bullet} YouTube links\n` +
        `${bullet} Spotify links (tracks & playlists)`,
    );

  const playButton = new ButtonBuilder()
    .setCustomId("play_song")
    .setLabel("Play Music")
    .setEmoji("🎵")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(playButton);

  const message = await channel.send({
    embeds: [helpEmbed],
    components: [row],
  });

  await message.pin().catch(() => {});
  return message;
}

module.exports = { ensurePlayMusicPanel };
