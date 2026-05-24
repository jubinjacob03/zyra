const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
const { e } = require("../utils/customEmoji");
const { resolveSpotifyQuery } = require("../utils/spotify");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or playlist from Spotify, SoundCloud, etc.")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name, Spotify URL, or SoundCloud URL")
        .setRequired(true)
    ),

  async execute(interaction, client) {
    const query = interaction.options.getString("query");
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      const container = new ContainerBuilder().setAccentColor(0xff4444);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} You need to be in a voice channel!`));
      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | 64,
      });
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has("Connect") || !permissions.has("Speak")) {
      const container = new ContainerBuilder().setAccentColor(0xff4444);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} I need permissions to join and speak in your voice channel!`));
      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | 64,
      });
    }

    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply({ ephemeral: true });
    }

    try {
      console.log(`🔍 Starting search for: "${query}"`);

      const { QueryType } = require("discord-player");
      
      const DiscordPlayer = require("../utils/DiscordPlayer");
      
      const { isPlaylist, count, track } = await DiscordPlayer.play(interaction, query, voiceChannel, client);

      const container = new ContainerBuilder().setAccentColor(0x00ffff);
      if (isPlaylist) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("MUSIC")} **${count} songs** from playlist added to queue`));
      } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("MUSIC")} **${track.title}** added to queue`));
      }

      try {
        await interaction.editReply({
          content: null,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch {
        await interaction.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
      }
    } catch (error) {
      console.error("Play error:", error);

      const container = new ContainerBuilder().setAccentColor(0xE74C3C);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} Could not play: ${error.message}`));
      try {
        await interaction.editReply({
          content: null,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch {
        await interaction.channel.send({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    }
  },
};
