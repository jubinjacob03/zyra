const fs = require('fs');
const path = require('path');

const commandsDir = path.join(__dirname, 'src', 'commands');

const replacements = {
    'client.getQueue(interaction.guildId)': 'client.player.nodes.get(interaction.guildId)',
    'queue.paused': 'queue.node.isPaused()',
    'queue.pause()': 'queue.node.pause()',
    'queue.resume()': 'queue.node.resume()',
    'queue.skip()': 'queue.node.skip()',
    'queue.stop()': 'queue.delete()',
    'queue.shuffle()': 'queue.tracks.shuffle()',
    'queue.setVolume(': 'queue.node.setVolume(',
    'queue.volume': 'queue.node.volume',
    'queue.songs': 'queue.tracks.toArray()',
    'queue.currentSong': 'queue.currentTrack',
    'queue.remove(': 'queue.tracks.removeOne(',
    'queue.clear()': 'queue.tracks.clear()',
};

const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js') && f !== 'play.js' && f !== 'spotify.js');

for (const file of files) {
    const filePath = path.join(commandsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    for (const [oldStr, newStr] of Object.entries(replacements)) {
        content = content.split(oldStr).join(newStr);
    }
    
    // Special handling for queue.js, nowplaying.js, skipto.js, move.js, lyrics.js
    if (file === 'queue.js') {
        content = content.replace(/queue\.tracks\.toArray\(\)\.length/g, 'queue.tracks.size');
        content = content.replace(/song\.name/g, 'song.title');
        content = content.replace(/song\.formattedDuration/g, 'song.duration');
    }
    if (file === 'nowplaying.js') {
        content = content.replace(/song\.name/g, 'song.title');
        content = content.replace(/song\.formattedDuration/g, 'song.duration');
        content = content.replace(/song\.user/g, 'song.requestedBy');
        content = content.replace(/queue\.formattedDuration/g, 'queue.durationFormatted');
    }
    if (file === 'skipto.js') {
        content = content.replace(/queue\.node\.skip\((.*?)\)/g, 'queue.node.skipTo($1)');
    }
    if (file === 'move.js') {
        content = content.replace(/queue\.tracks\.toArray\(\)\.splice/g, 'queue.node.move'); // This might need manual fix
    }
    
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${file}`);
}
