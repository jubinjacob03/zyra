const EMOJI_NAMES = {
    r_play: 'PLAY',
    r_pause: 'PAUSE',
    r_stop: 'STOP',
    r_skip: 'SKIP',
    r_previous: 'PREVIOUS',
    r_shuffle: 'SHUFFLE',
    r_loop: 'LOOP',
    r_loopone: 'LOOP_ONE',
    r_volup: 'VOLUP',
    r_voldown: 'VOLDOWN',
    r_queue: 'QUEUE',
    r_music: 'MUSIC',
    r_author: 'AUTHOR',
    r_playlist: 'PLAYLIST',
    r_youtube: 'YOUTUBE',
    r_spotify: 'SPOTIFY',
};

const UNICODE = {
    PLAY: '▶️',
    PAUSE: '⏸️',
    STOP: '⏹️',
    SKIP: '⏭️',
    PREVIOUS: '⏮️',
    SHUFFLE: '🔀',
    LOOP: '🔁',
    LOOP_ONE: '🔂',
    VOLUP: '🔊',
    VOLDOWN: '🔉',
    QUEUE: '📋',
    MUSIC: '🎵',
    AUTHOR: '🎤',
    PLAYLIST: '📑',
    YOUTUBE: '🔴',
    SPOTIFY: '🟢',
};

const resolved = {};

function initEmojis(client) {
    for (const guild of client.guilds.cache.values()) {
        for (const emoji of guild.emojis.cache.values()) {
            const key = EMOJI_NAMES[emoji.name];
            if (key) {
                resolved[key] = {
                    id: emoji.id,
                    name: emoji.name,
                    animated: emoji.animated,
                    full: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
                };
            }
        }
    }
    const count = Object.keys(resolved).length;
    if (count > 0) console.log(`✅ Loaded ${count} custom emojis`);
}

function e(key) {
    if (resolved[key]) return resolved[key].full;
    return UNICODE[key] || '';
}

function btn(key) {
    if (resolved[key]) return { id: resolved[key].id, name: resolved[key].name, animated: resolved[key].animated };
    return UNICODE[key] || '❓';
}

module.exports = { initEmojis, e, btn, UNICODE };
