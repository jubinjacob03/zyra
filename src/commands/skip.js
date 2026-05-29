const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { successEmbed, errorEmbed } = require("../utils/embed");

/**
 * Skip command module.
 * Skips the currently playing song.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song"),

  /**
   * Executes the skip command.
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

    const song = queue.tracks.toArray()[0];

    try {
      await queue.node.skip();
      await interaction.reply({ ...successEmbed(`Skipped **${song.name}**`) });
    } catch (error) {
      await interaction.reply({ ...errorEmbed("No more songs in the queue.") });
    }
  },
};
