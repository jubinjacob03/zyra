const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { successEmbed, errorEmbed } = require("../utils/embed");

/**
 * Clear command module.
 * Clears all songs from the queue except the currently playing one.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clear the queue"),

  /**
   * Executes the clear command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   * @param {import('discord.js').Client} client - The Discord client.
   */
  async execute(interaction, client) {
    const queue = client.player.nodes.get(interaction.guildId);

    if (!queue) {
      return interaction.reply({
        ...errorEmbed("Nothing is playing right now."),
        flags: 64,
      });
    }

    const count = queue.tracks.size;
    queue.tracks.clear();
    await interaction.reply({
      ...successEmbed(`Cleared **${count}** songs from the queue.`),
    });
  },
};
