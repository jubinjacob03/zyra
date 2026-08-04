const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { successEmbed, errorEmbed } = require("../utils/embed");
const { e } = require("../utils/customEmoji");

/**
 * Stop command module.
 * Stops the music playback and clears the queue.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop the music and clear the queue"),

  /**
   * Executes the stop command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   * @param {import('discord.js').Client} client - The Discord client.
   */
  async execute(interaction, client) {
    const queue = client.player.nodes.get(interaction.guildId);

    if (!queue) {
      return interaction.reply(errorEmbed("Nothing is playing right now."));
    }

    queue.delete();
    await interaction.reply(
      successEmbed(`${e("STOP")} Stopped the music and cleared the queue.`),
    );
  },
};
