const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { UNICODE } = require("../utils/customEmoji");

/**
 * Emoji Debug command module.
 * Debugs the loading and availability of custom emojis in the server.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("emoji-debug")
    .setDescription("Debug custom emoji loading"),
  
  /**
   * Executes the emoji-debug command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   */
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return interaction.reply({
        content: "This command only works in servers",
        flags: 64,
      });
    }

    const allEmojis = guild.emojis.cache.map((e) => e.name);
    const rEmojis = allEmojis.filter((name) => name.startsWith("r_"));

    const { e } = require("../utils/customEmoji");
    const testEmojis = [
      "PLAY",
      "PAUSE",
      "STOP",
      "SKIP",
      "PREVIOUS",
      "SHUFFLE",
      "LOOP",
      "LOOP_ONE",
      "VOLUP",
      "VOLDOWN",
      "QUEUE",
      "MUSIC",
      "HEADPHONES",
      "AUTHOR",
      "PLAYLIST",
      "YOUTUBE",
      "SPOTIFY",
      "SUCCESS",
      "ERROR",
      "WARNING",
      "INFO",
      "REFRESH",
      "USER",
      "TIME",
    ];

    const loaded = testEmojis.map((key) => {
      const emoji = e(key);
      const isCustom = emoji.startsWith("<:");
      return `${key}: ${isCustom ? "✅" : "❌"} ${emoji}`;
    });

    const customCount = loaded.filter((line) => line.includes("✅")).length;
    const unicodeCount = loaded.filter((line) => line.includes("❌")).length;

    await interaction.reply({
      content:
        `**Discord Server Emojis:**\n` +
        `Total: ${allEmojis.length} | r_* emojis: ${rEmojis.length}\n` +
        `Names: ${rEmojis.slice(0, 10).join(", ")}${rEmojis.length > 10 ? "..." : ""}\n\n` +
        `**Bot Status:** ${customCount}/24 custom, ${unicodeCount}/24 fallback\n\n` +
        loaded.join("\n"),
      flags: 64,
    });
  },
};
