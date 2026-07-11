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
        return interaction.reply(
          Object.assign(errorEmbed("You need to be in a voice channel first!"), { flags: 64 }),
        );
      }

      const permissions = voiceChannel.permissionsFor(interaction.client.user);
      if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
        return interaction.reply(
          Object.assign(errorEmbed("I need permissions to join and speak in your voice channel!"), { flags: 64 }),
        );
      }

      const queue = client.getQueue(interaction.guildId);
      if (queue) {
        return interaction.reply(
          Object.assign(errorEmbed("I'm already in a voice channel! Use `/play` to add songs."), { flags: 64 }),
        );
      }

      await client.createQueue(interaction.guildId, interaction.channel, voiceChannel);
      await interaction.reply(successEmbed(`Joined **${voiceChannel.name}**! Use \`/play\` to start the music.`));
    } catch (error) {
      await interaction.reply(
        Object.assign(errorEmbed("Failed to join voice channel. Please try again."), { flags: 64 }),
      );
    }
  },
};
