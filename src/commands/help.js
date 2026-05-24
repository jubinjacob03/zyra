const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, MessageFlags } = require("discord.js");
const { e } = require("../utils/customEmoji");

/**
 * Help command module.
 * Displays a list of all available commands.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available commands"),

  /**
   * Executes the help command.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object.
   * @param {import('discord.js').Client} client - The Discord client.
   */
  async execute(interaction, client) {
    const commands = [
      { name: "/play", desc: "Play a song or playlist" },
      { name: "/pause", desc: "Pause the music" },
      { name: "/resume", desc: "Resume the music" },
      { name: "/skip", desc: "Skip current song" },
      { name: "/stop", desc: "Stop and clear queue" },
      { name: "/queue", desc: "View the queue" },
      { name: "/nowplaying", desc: "Show current song panel" },
      { name: "/volume", desc: "Adjust volume" },
      { name: "/loop", desc: "Set loop mode" },
      { name: "/shuffle", desc: "Shuffle the queue" },
      { name: "/skipto", desc: "Skip to specific song" },
      { name: "/move", desc: "Move song in queue" },
      { name: "/remove", desc: "Remove song from queue" },
      { name: "/clear", desc: "Clear the queue" },
      { name: "/search", desc: "Search for songs" },
      { name: "/lyrics", desc: "Get song lyrics" },
      { name: "/join", desc: "Join your voice channel" },
      { name: "/spotify", desc: "Test Spotify integration and show status" },
    ];

    const container = new ContainerBuilder().setAccentColor(0x9B59B6);
    
    let description = `### ${e("MUSIC")} Remani Music Bot\nYour premium music experience\n*Supports Spotify, SoundCloud, and YouTube!*\n\n`;
    
    commands.forEach(cmd => {
      description += `**${cmd.name}** - ${cmd.desc}\n`;
    });

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(description)
    );

    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};
