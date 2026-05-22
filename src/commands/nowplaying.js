const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { createCompleteMusicController } = require('../utils/componentsV2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the currently playing song'),
    async execute(interaction, client) {
        const queue = client.getQueue(interaction.guildId);
        
        if (!queue || !queue.songs.length) {
            const container = new ContainerBuilder().setAccentColor(0xff4444);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ Nothing is playing right now.'));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | 64 });
        }

        const controller = createCompleteMusicController(queue);
        await interaction.reply({ components: controller.components, flags: MessageFlags.IsComponentsV2 });
    },
};
