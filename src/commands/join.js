const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { successEmbed, errorEmbed } = require("../utils/embed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Join your voice channel"),

  async execute(interaction, client) {
    try {
      const member = interaction.member;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply(errorEmbed("You need to be in a voice channel first!"));
      }

      const permissions = voiceChannel.permissionsFor(interaction.client.user);
      if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
        return interaction.reply(errorEmbed("I need permissions to join and speak in your voice channel!"));
      }

      const queue = client.getQueue(interaction.guildId);
      if (queue) {
        return interaction.reply(errorEmbed("I'm already in a voice channel! Use `/play` to add songs."));
      }

      await client.createQueue(interaction.guildId, interaction.channel, voiceChannel);
      await interaction.reply(successEmbed(`Joined **${voiceChannel.name}**! Use \`/play\` to start the music.`));
    } catch (error) {
      await interaction.reply(errorEmbed("Failed to join voice channel. Please try again."));
    }
  },
};
