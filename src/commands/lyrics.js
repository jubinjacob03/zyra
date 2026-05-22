const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, MessageFlags } = require('discord.js');
const { errorEmbed } = require('../utils/embed');
const Genius = require('genius-lyrics');
const genius = new Genius.Client();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Get lyrics for the current song or search')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name to search (optional)')),

    async execute(interaction, client) {
        let searchQuery = interaction.options.getString('query');

        if (!searchQuery) {
            const queue = client.getQueue(interaction.guildId);
            if (!queue || !queue.songs[0]) {
                const container = new ContainerBuilder().setAccentColor(0xff4444);
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ No song playing. Please provide a search query.'));
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | 64 });
            }
            searchQuery = queue.songs[0].name;
        }

        await interaction.reply({ content: '🔍 Searching for lyrics...', flags: 64 });

        try {
            const searches = await genius.songs.search(searchQuery);

            if (!searches.length) {
                const container = new ContainerBuilder().setAccentColor(0xff4444);
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ No lyrics found for this song.'));
                return interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const song = searches[0];
            const lyrics = await song.lyrics();

            if (!lyrics) {
                const container = new ContainerBuilder().setAccentColor(0xff4444);
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ No lyrics found for this song.'));
                return interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = new ContainerBuilder().setAccentColor(0x9B59B6);
            let description = `### 🎤 [${song.title}](${song.url})\n*Artist: ${song.artist.name}*\n\n`;
            
            const lyricsText = lyrics.length > 3800 ? lyrics.substring(0, 3800) + '...\n\n*(Lyrics truncated due to length)*' : lyrics;
            description += lyricsText;

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(description)
            );

            await interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error) {
            console.error('Lyrics error:', error);
            const container = new ContainerBuilder().setAccentColor(0xff4444);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ Failed to fetch lyrics.'));
            await interaction.editReply({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },
};
