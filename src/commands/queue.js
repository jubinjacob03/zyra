const { SlashCommandBuilder } = require("discord.js");
const { queueEmbed, errorEmbed } = require("../utils/embed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("View the music queue")
    .addIntegerOption((option) =>
      option.setName("page").setDescription("Page number").setMinValue(1),
    ),

  async execute(interaction, client) {
    const queue = client.getQueue(interaction.guildId);

    if (!queue || !queue.songs.length) {
      return interaction.reply(errorEmbed("The queue is empty."));
    }

    const page = (interaction.options.getInteger("page") || 1) - 1;
    await interaction.reply(queueEmbed(queue, page));
  },
};
