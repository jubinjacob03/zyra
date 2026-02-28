const http = require('http');

module.exports = function attachMusicApi(client) {
  const port = parseInt(process.env.MUSIC_API_PORT) || 3002;
  const apiKey = process.env.MUSIC_API_KEY;

  const send = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const parseBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve({}); }
      });
    });

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (apiKey) {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${apiKey}`) {
        return send(res, 401, { error: 'Unauthorized' });
      }
    }

    const url  = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;

    try {
      if (req.method === 'POST' && path === '/play') {
        const { guildId, voiceChannelId, query, userId, username } = await parseBody(req);

        if (!guildId || !voiceChannelId || !query)
          return send(res, 400, { error: 'guildId, voiceChannelId, query are required' });

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return send(res, 404, { error: 'Bot is not in this guild' });

        const voiceChannel = guild.channels.cache.get(voiceChannelId);
        if (!voiceChannel) return send(res, 404, { error: 'Voice channel not found' });

        const textChannel =
          guild.systemChannel ||
          guild.channels.cache.find(
            (c) => c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages'),
          );
        if (!textChannel)
          return send(res, 500, { error: 'No accessible text channel in guild' });

        const fakeUser = {
          id: userId || 'web',
          displayName: username || 'Web Player',
          username: username || 'web',
        };

        const result = await client.searchSong(query, fakeUser);
        if (!result) return send(res, 404, { error: 'No results found for query' });

        let queue      = client.getQueue(guildId);
        const isNewQueue = !queue;

        if (!queue) queue = await client.createQueue(guildId, textChannel, voiceChannel);

        if (result.type === 'playlist') {
          await queue.addSongs(result.songs);
        } else {
          await queue.addSong(result);
        }

        if (isNewQueue) await queue.play();

        return send(res, 200, {
          success: true,
          isNewQueue,
          added: result.type === 'playlist' ? result.songs.length : 1,
          song:
            result.type !== 'playlist'
              ? {
                  name: result.name,
                  url: result.url,
                  thumbnail: result.thumbnail,
                  formattedDuration: result.formattedDuration,
                  author: result.author,
                }
              : null,
        });
      }

      if (req.method === 'POST' && path === '/control') {
        const { guildId, action, value } = await parseBody(req);

        const queue = client.getQueue(guildId);
        if (!queue) return send(res, 404, { error: 'Nothing is playing' });

        switch (action) {
          case 'pause':   queue.pause();   break;
          case 'resume':  queue.resume();  break;
          case 'toggle':  queue.paused ? queue.resume() : queue.pause(); break;
          case 'skip':    queue.skip();    break;
          case 'stop':    queue.stop();    break;
          case 'shuffle': queue.shuffle(); break;
          case 'loop':    queue.setRepeatMode(value ?? (queue.repeatMode + 1) % 3); break;
          case 'volume':  queue.setVolume(Math.max(0, Math.min(100, Number(value) || 50))); break;
          default:        return send(res, 400, { error: `Unknown action: ${action}` });
        }

        return send(res, 200, { success: true, action });
      }

      if (req.method === 'GET' && path === '/status') {
        const guildId = url.searchParams.get('guildId');
        const queue   = client.getQueue(guildId);

        if (!queue || !queue.songs.length)
          return send(res, 200, { playing: false, paused: false, song: null, queue: [], queueLength: 0 });

        const elapsed = queue.position ?? 0;

        return send(res, 200, {
          playing:    queue.playing && !queue.paused,
          paused:     queue.paused,
          repeatMode: queue.repeatMode,
          volume:     queue.volume,
          elapsed,
          song: {
            name:             queue.songs[0].name,
            url:              queue.songs[0].url,
            thumbnail:        queue.songs[0].thumbnail,
            duration:         queue.songs[0].duration || 0,
            formattedDuration: queue.songs[0].formattedDuration,
            author:           queue.songs[0].author || 'Unknown Artist',
          },
          queue: queue.songs.slice(1, 8).map((s, i) => ({
            index:            i + 1,
            name:             s.name,
            thumbnail:        s.thumbnail,
            formattedDuration: s.formattedDuration,
            author:           s.author,
          })),
          queueLength: queue.songs.length,
        });
      }

      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('[MusicAPI Error]', err.message);
      return send(res, 500, { error: err.message });
    }
  });

  server.listen(port, () => {
    console.log(`🎵 Remani Music API listening on port ${port}`);
  });

  return server;
};
