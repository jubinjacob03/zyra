const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

const player = new Player(client, {
    blockExtractors: ['YouTubeExtractor', 'YoutubeExtractor'],
    blockStreamFrom: ['YouTubeExtractor', 'YoutubeExtractor']
});

async function test() {
    await player.extractors.loadMulti(DefaultExtractors);
    
    const res = await player.search('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
    const track = res.tracks[0];
    console.log('Search result:', track.title, 'by', track.author);
    
    try {
        const stream = await player.extractors.context.provide(
            {
                id: 'test',
                attemptedExtractors: new Set(),
                bridgeAttemptedExtractors: new Set()
            },
            async () => {
                const result = await player.extractors.run(async (ext) => {
                    if (player.options.blockStreamFrom?.includes(ext.identifier)) return false;
                    return ext.validate(track.url, track.queryType) || ext.validate(track.url, 'arbitrary');
                });
                if (!result) return null;
                return result.extractor.stream(track);
            }
        );
        console.log('Stream extracted successfully!');
    } catch (e) {
        console.error('Stream extraction failed:', e);
    }
    
    console.log('Test complete');
    process.exit(0);
}

test();
