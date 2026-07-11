const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require("discord.js");
const { e } = require("../utils/customEmoji");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all available commands"),

  async execute(interaction) {
    const commands = [
      { name: "/play", desc: "Play a song or playlist" },
      { name: "/search", desc: "Search for songs" },
      { name: "/pause", desc: "Pause the music" },
      { name: "/resume", desc: "Resume the music" },
      { name: "/skip", desc: "Skip current song" },
      { name: "/skipto", desc: "Skip to specific song" },
      { name: "/stop", desc: "Stop and clear queue" },
      { name: "/queue", desc: "View the queue" },
      { name: "/nowplaying", desc: "Show current song panel" },
      { name: "/volume", desc: "Adjust volume" },
      { name: "/loop", desc: "Set loop mode" },
      { name: "/shuffle", desc: "Shuffle the queue" },
      { name: "/move", desc: "Move song in queue" },
      { name: "/remove", desc: "Remove song from queue" },
      { name: "/clear", desc: "Clear the queue" },
      { name: "/lyrics", desc: "Get song lyrics" },
      { name: "/join", desc: "Join voice channel" },
    ];

    const icon = e("MUSIC");
    const list = commands.map((cmd) => `**${cmd.name}** — ${cmd.desc}`).join("\n");

    const container = new ContainerBuilder().setAccentColor(0x00ffff);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${icon} Zyra Music Bot\n\n${list}\n\n-# Made with ❤️ by God BlazXx`,
      ),
    );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
