const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { successEmbed, errorEmbed } = require("../utils/embed");
const { e } = require("../utils/customEmoji");

/**
 * Join command module.
 * Makes the bot join the user's voice channel.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your voice channel"),

  /**
   * Executes the join command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   */
  async execute(interaction) {
    try {
      const member = interaction.member;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({
          ...errorEmbed("You need to be in a voice channel first!"),
          flags: 64,
        });
      }

      const permissions = voiceChannel.permissionsFor(interaction.client.user);
      if (
        !permissions.has(PermissionFlagsBits.Connect) ||
        !permissions.has(PermissionFlagsBits.Speak)
      ) {
        return interaction.reply({
          ...errorEmbed(
            "I need permissions to join and speak in your voice channel!",
          ),
          flags: 64,
        });
      }

      const queue = interaction.client.player.nodes.get(interaction.guildId);

      if (queue) {
        return interaction.reply({
          ...errorEmbed(
            "I'm already in a voice channel! Use `/play` to add songs.",
          ),
          flags: 64,
        });
      }

      await interaction.client.createQueue(
        interaction.guildId,
        interaction.channel,
        voiceChannel,
      );

      await interaction.reply({
        ...successEmbed(
          `${e("SUCCESS")} Joined **${voiceChannel.name}**! Use \`/play\` to start the music.`,
        ),
      });
    } catch (error) {
      console.error("Join command error:", error);
      await interaction.reply({
        ...errorEmbed("Failed to join voice channel. Please try again."),
        flags: 64,
      });
    }
  },
};
