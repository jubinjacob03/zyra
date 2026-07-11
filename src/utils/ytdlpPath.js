const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// Resolve yt-dlp binary path once at startup
let binaryPath = 'yt-dlp';
if (os.platform() === 'win32') {
    const systemYtdlp = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages', 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe');
    if (fs.existsSync(systemYtdlp)) binaryPath = systemYtdlp;
} else {
    const nixYtdlp = '/root/.nix-profile/bin/yt-dlp';
    if (fs.existsSync(nixYtdlp)) binaryPath = nixYtdlp;
}

const SEARCH_TIMEOUT = 15000;

/**
 * Search YouTube via yt-dlp flat-playlist extraction.
 * @param {string} query - Search terms
 * @param {number} [limit=5] - Max results (1-10)
 * @returns {Promise<Array<{title:string, url:string, duration:number, channel:string}>|null>}
 */
function searchYouTube(query, limit = 5) {
    return new Promise((resolve) => {
        const args = [
            `ytsearch${limit}:${query}`,
            '--flat-playlist',
            '--dump-single-json',
            '--no-warnings',
            '--no-check-certificates',
            '--skip-download',
        ];
        execFile(binaryPath, args, { timeout: SEARCH_TIMEOUT }, (err, stdout) => {
            if (err || !stdout) return resolve(null);
            try {
                const data = JSON.parse(stdout);
                const entries = (data.entries || []).filter(e => e && e.title && e.id);
                if (entries.length === 0) return resolve(null);
                resolve(entries.map(e => ({
                    title: e.title,
                    url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
                    duration: e.duration || 0,
                    channel: e.channel || e.uploader || 'Unknown',
                    id: e.id,
                })));
            } catch {
                resolve(null);
            }
        });
    });
}

module.exports = { binaryPath, searchYouTube };
