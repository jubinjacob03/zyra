const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
const { e } = require("../utils/customEmoji");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or playlist from Spotify, SoundCloud, etc.")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name, Spotify URL, or SoundCloud URL")
        .setRequired(true),
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

      const result = await client.player.search(query, {
        requestedBy: interaction.user,
      });

      if (!result || result.isEmpty()) {
        const container = new ContainerBuilder().setAccentColor(0xff4444);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} No results found for your query.`));
        return interaction.editReply({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const { track } = await client.player.play(voiceChannel, result, {
        nodeOptions: {
          metadata: {
            channel: interaction.channel,
          },
          leaveOnEmpty: true,
          leaveOnEmptyCooldown: 300000,
          leaveOnEnd: true,
          leaveOnStop: true,
        },
      });

      const container = new ContainerBuilder().setAccentColor(0x0e0e12);
      if (result.hasPlaylist()) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("MUSIC")} **${result.playlist.tracks.length} songs** from playlist added to queue`));
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
