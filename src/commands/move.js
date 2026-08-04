const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { successEmbed, errorEmbed } = require("../utils/embed");

/**
 * Move command module.
 * Moves a song to a different position in the queue.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move a song in the queue")
    .addIntegerOption((option) =>
      option
        .setName("from")
        .setDescription("Current position of the song")
        .setRequired(true)
        .setMinValue(1),
    )
    .addIntegerOption((option) =>
      option
        .setName("to")
        .setDescription("New position for the song")
        .setRequired(true)
        .setMinValue(1),
    ),

  /**
   * Executes the move command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   * @param {import('discord.js').Client} client - The Discord client.
   */
  async execute(interaction, client) {
    const queue = client.player.nodes.get(interaction.guildId);

    if (!queue) {
      return interaction.reply(errorEmbed("Nothing is playing right now."));
    }

    const from = interaction.options.getInteger("from") - 1;
    const to = interaction.options.getInteger("to") - 1;

    if (from >= queue.tracks.size || to >= queue.tracks.size) {
      return interaction.reply(
        errorEmbed(`Invalid positions. Queue has ${queue.tracks.size} songs.`),
      );
    }

    const song = queue.tracks.toArray()[from];
    queue.node.move(from, to);

    await interaction.reply(
      successEmbed(
        `Moved **${song.title}** from position ${from + 1} to ${to + 1}`,
      ),
    );
  },
};
