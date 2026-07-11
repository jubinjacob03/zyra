const { SlashCommandBuilder } = require("discord.js");
const { createCompleteMusicController } = require("../utils/componentsV2");
const { errorEmbed } = require("../utils/embed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show the currently playing song"),

  async execute(interaction, client) {
    const queue = client.getQueue(interaction.guildId);

    if (!queue || !queue.songs[0]) {
      return interaction.reply(
        Object.assign(errorEmbed("Nothing is playing right now."), { flags: 64 }),
      );
    }

    const controller = createCompleteMusicController(queue);
    if (!controller) {
      return interaction.reply(
        Object.assign(errorEmbed("Nothing is playing right now."), { flags: 64 }),
      );
    }

    await interaction.reply(controller);
  },
};
