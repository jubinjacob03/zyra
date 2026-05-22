const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, MessageFlags } = require("discord.js");
const { errorEmbed, COLORS } = require("../utils/embed");
const { createCompleteMusicController } = require("../utils/componentsV2");
const { e } = require("../utils/customEmoji");

/**
 * Play command module.
 * Handles playing songs or playlists from YouTube or Spotify.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song or playlist from YouTube or Spotify")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("Song name, YouTube URL, or Spotify URL")
        .setRequired(true),
    ),

  /**
   * Executes the play command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   * @param {import('discord.js').Client} client - The Discord client.
   */
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
      await interaction.deferReply();
    }

    try {
      const searchStart = Date.now();
      console.log(`🔍 Starting search for: "${query}"`);

      const result = await Promise.race([
        client.searchSong(query, member),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Operation timeout - please try a simpler query or direct YouTube link",
                ),
              ),
            60000,
          ),
        ),
      ]);

      console.log(`✅ Search completed in ${Date.now() - searchStart}ms`);

      if (!result) {
        const container = new ContainerBuilder().setAccentColor(0xff4444);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("ERROR")} No results found for your query.`));
        return interaction.editReply({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      let queue = client.getQueue(interaction.guildId);
      const isNewQueue = !queue;

      if (!queue) {
        queue = await client.createQueue(
          interaction.guildId,
          interaction.channel,
          voiceChannel,
        );
      }

      if (result.type === "playlist") {
        await queue.addSongs(result.songs);

        if (isNewQueue) {
          const controller = createCompleteMusicController(queue);
          let msg;
          try {
            msg = await interaction.editReply({
              content: null,
              components: controller.components,
              flags: controller.flags,
            });
          } catch (editError) {
            msg = await interaction.channel.send({
              components: controller.components,
              flags: controller.flags,
            });
          }
          client.musicPanels.set(interaction.guildId, {
            message: msg,
            song: queue.songs[0],
            startTime: Date.now(),
          });
          await queue.play();
        } else {
          const container = new ContainerBuilder().setAccentColor(0x0e0e12);
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("MUSIC")} **${result.songs.length} songs** from playlist added to queue`));
          try {
            await interaction.editReply({
              content: null,
              components: [container],
              flags: MessageFlags.IsComponentsV2,
            });
          } catch {
            await interaction.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }
        }
      } else {
        await queue.addSong(result);

        if (isNewQueue) {
          const controller = createCompleteMusicController(queue);
          let msg;
          try {
            msg = await interaction.editReply({
              content: null,
              components: controller.components,
              flags: controller.flags,
            });
          } catch (editError) {
            msg = await interaction.channel.send({
              components: controller.components,
              flags: controller.flags,
            });
          }
          client.musicPanels.set(interaction.guildId, {
            message: msg,
            song: result,
            startTime: Date.now(),
          });
          await queue.play();
        } else {
          const position = queue.songs.length;
          const container = new ContainerBuilder().setAccentColor(0x0e0e12);
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("MUSIC")} **${result.name}** added to queue at position **${position}**`));
          try {
            await interaction.editReply({
              content: null,
              components: [container],
              flags: MessageFlags.IsComponentsV2,
            });
          } catch {
            await interaction.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
          }
        }
      }
    } catch (error) {
      console.error("Play error:", error);

      if (error.message.includes("Mix playlists are not supported")) {
        const container = new ContainerBuilder().setAccentColor(0xE74C3C);
        let description = `### ${e("ERROR")} YouTube Mix Playlists Not Supported\n`;
        description += `Mix playlists are personalized and user-specific - they cannot be accessed by bots.\n\n`;
        description += `**💡 Alternatives**\n• Use a regular YouTube playlist instead\n• Search for individual songs\n• Create a custom playlist with your favorite tracks\n\n`;
        description += `**🔍 How to identify Mix playlists**\nURLs containing \`RD\`, \`RDMM\`, \`RDAMPL\`, or \`RDCLAK\` in the playlist ID`;

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(description)
        );

        try {
          return await interaction.editReply({
            content: null,
            components: [container],
            flags: MessageFlags.IsComponentsV2,
          });
        } catch {
          return await interaction.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
      }

      if (error.message.includes("timeout")) {
        const container = new ContainerBuilder().setAccentColor(0xE74C3C);
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${e("TIME")} Search took too long. Please try a simpler query or check your internet connection.`));
        try {
          return await interaction.editReply({
            content: null,
            components: [container],
            flags: MessageFlags.IsComponentsV2,
          });
        } catch {
          return await interaction.channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
          });
        }
      }

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
