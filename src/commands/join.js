const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join your voice channel'),
    
    async execute(interaction) {
        try {
            const member = interaction.member;
            const voiceChannel = member.voice.channel;

            if (!voiceChannel) {
                return interaction.reply({ 
                    embeds: [errorEmbed('You need to be in a voice channel first!')], 
                    flags: 64 
                });
            }

            const permissions = voiceChannel.permissionsFor(interaction.client.user);
            if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
                return interaction.reply({ 
                    embeds: [errorEmbed('I need permissions to join and speak in your voice channel!')], 
                    flags: 64 
                });
            }

            const queue = interaction.client.getQueue(interaction.guildId);
            
            if (queue) {
                return interaction.reply({ 
                    embeds: [errorEmbed('I\'m already in a voice channel! Use `/play` to add songs.')], 
                    flags: 64 
                });
            }

            await interaction.client.createQueue(
                interaction.guildId,
                interaction.channel,
                voiceChannel
            );

            await interaction.reply({ 
                embeds: [successEmbed(`✅ Joined **${voiceChannel.name}**! Use \`/play\` to start the music.`)] 
            });

        } catch (error) {
            console.error('Join command error:', error);
            await interaction.reply({ 
                embeds: [errorEmbed('Failed to join voice channel. Please try again.')], 
                flags: 64 
            });
        }
    },
};
