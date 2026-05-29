const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { successEmbed, errorEmbed } = require("../utils/embed");

/**
 * Shuffle command module.
 * Randomizes the order of songs in the queue.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("shuffle")
    .setDescription("Shuffle the queue"),

  /**
   * Executes the shuffle command.
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

    if (queue.tracks.toArray().length < 3) {
      return interaction.reply({
        ...errorEmbed("Need at least 3 songs to shuffle."),
        flags: 64,
      });
    }

    await queue.tracks.shuffle();
    await interaction.reply({
      ...successEmbed(`Shuffled ${queue.tracks.toArray().length} songs.`),
    });
  },
};
