const http = require("node:http");

/**
 * Attaches the Music API server to the Discord client.
 * Provides endpoints for external control and status monitoring.
 * 
 * @param {import('discord.js').Client} client - The Discord client instance.
 * @param {number|null} [customPort=null] - Optional custom port to listen on.
 * @returns {http.Server} The created HTTP server.
 */
module.exports = function attachMusicApi(client, customPort = null) {
  const port = customPort || parseInt(process.env.MUSIC_API_PORT) || 8000;
  const apiKey = process.env.MUSIC_API_KEY;

  const send = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      Connection: "keep-alive",
    });
    res.end(JSON.stringify(data));
  };

  const parseBody = (req) =>
    new Promise((resolve) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve({});
        }
      });
    });

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;

    if (apiKey) {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${apiKey}`) {
        return send(res, 401, { error: "Unauthorized" });
      }
    }

    try {
      if (req.method === "GET" && path === "/health") {
        return send(res, 200, {
          ok: true,
          uptime: Math.floor(process.uptime()),
        });
      }

      if (req.method === "POST" && path === "/play") {
        const { guildId, voiceChannelId, query, userId, username } =
          await parseBody(req);

        if (!guildId || !voiceChannelId || !query)
          return send(res, 400, {
            error: "guildId, voiceChannelId, query are required",
          });

        const guild = client.guilds.cache.get(guildId);
        if (!guild)
          return send(res, 404, { error: "Bot is not in this guild" });

        const voiceChannel = guild.channels.cache.get(voiceChannelId);
        if (!voiceChannel)
          return send(res, 404, { error: "Voice channel not found" });

        const textChannel =
          guild.channels.cache.get("1473105751575760917") ||
          guild.systemChannel ||
          guild.channels.cache.find(
            (c) =>
              c.type === 0 &&
              c.permissionsFor(guild.members.me)?.has("SendMessages"),
          );
        if (!textChannel)
          return send(res, 500, {
            error: "No accessible text channel in guild",
          });

        const fakeUser = {
          id: userId || "api",
          displayName: username || "API Player",
          username: username || "api",
        };

        const result = await client.player.search(query, {
          requestedBy: fakeUser,
        });

        if (!result || result.isEmpty())
          return send(res, 404, { error: "No results found for query" });

        const queue = client.player.nodes.get(guildId);
        const isNewQueue = !queue;

        const isInstance = !!client.INSTANCE_NAME;

        await client.player.play(voiceChannel, result, {
          nodeOptions: {
            metadata: {
              channel: textChannel,
            },
            leaveOnEmpty: !isInstance,
            leaveOnEmptyCooldown: 300000,
            leaveOnEnd: !isInstance,
            leaveOnStop: !isInstance,
          },
        });

        return send(res, 200, {
          success: true,
          isNewQueue,
          added: result.hasPlaylist() ? result.playlist.tracks.length : 1,
          song:
            !result.hasPlaylist()
              ? {
                  name: result.tracks[0].title,
                  url: result.tracks[0].url,
                  thumbnail: result.tracks[0].thumbnail,
                  formattedDuration: result.tracks[0].duration,
                  author: result.tracks[0].author,
                }
              : null,
        });
      }

      // ── Legacy generic control (kept for backward compat) ────────────────
      if (req.method === "POST" && path === "/control") {
        const { guildId, action, value } = await parseBody(req);
        const queue = client.player.nodes.get(guildId);
        if (!queue) return send(res, 404, { error: "Nothing is playing" });
        switch (action) {
          case "pause":
            queue.node.pause();
            break;
          case "resume":
            queue.node.resume();
            break;
          case "toggle":
            queue.node.isPaused() ? queue.node.resume() : queue.node.pause();
            break;
          case "skip":
            queue.node.skip();
            break;
          case "stop":
            queue.delete();
            break;
          case "shuffle":
            queue.tracks.shuffle();
            break;
          case "loop":
            queue.setRepeatMode(value ?? (queue.repeatMode + 1) % 4);
            break;
          case "volume":
            queue.node.setVolume(Math.max(0, Math.min(100, Number(value) || 50)));
            break;
          case "remove": {
            const removed = queue.tracks.removeOne(Number(value) || 0);
            if (!removed)
              return send(res, 400, { error: "Invalid queue position" });
            return send(res, 200, {
              success: true,
              action,
              removed: removed.title,
            });
          }
          default:
            return send(res, 400, { error: `Unknown action: ${action}` });
        }
        return send(res, 200, { success: true, action });
      }

      // ── Direct per-action endpoints (zero-overhead, no switch dispatch) ──
      if (req.method === "POST") {
        const directActions = [
          "/skip",
          "/pause",
          "/resume",
          "/toggle",
          "/stop",
          "/shuffle",
          "/loop",
          "/volume",
          "/remove",
        ];
        if (directActions.includes(path)) {
          const body = await parseBody(req);
          const guildId = body.guildId;
          const queue = client.player.nodes.get(guildId);
          if (!queue) return send(res, 404, { error: "Nothing is playing" });

          switch (path) {
            case "/skip":
              queue.node.skip();
              break;
            case "/pause":
              queue.node.pause();
              break;
            case "/resume":
              queue.node.resume();
              break;
            case "/toggle":
              queue.node.isPaused() ? queue.node.resume() : queue.node.pause();
              break;
            case "/stop":
              queue.delete();
              break;
            case "/shuffle":
              queue.tracks.shuffle();
              break;
            case "/loop": {
              const mode =
                body.value !== undefined
                  ? Number(body.value)
                  : (queue.repeatMode + 1) % 4;
              queue.setRepeatMode(mode);
              break;
            }
            case "/volume": {
              const vol = Math.max(0, Math.min(100, Number(body.value) || 50));
              queue.node.setVolume(vol);
              return send(res, 200, { success: true, volume: vol });
            }
            case "/remove": {
              const removed = queue.tracks.removeOne(Number(body.value) || 0);
              if (!removed)
                return send(res, 400, { error: "Invalid queue position" });
              return send(res, 200, { success: true, removed: removed.title });
            }
          }
          return send(res, 200, { success: true });
        }
      }

      if (req.method === "GET" && path === "/queue") {
        const guildId = url.searchParams.get("guildId");
        const queue = client.player.nodes.get(guildId);
        if (!queue) return send(res, 200, { queue: [], queueLength: 0 });
        return send(res, 200, {
          queue: queue.tracks.toArray().map((s, i) => ({
            index: i,
            name: s.title,
            url: s.url,
            thumbnail: s.thumbnail,
            formattedDuration: s.duration,
            author: s.author,
          })),
          queueLength: queue.tracks.size,
        });
      }

      if (req.method === "GET" && path === "/status") {
        const guildId = url.searchParams.get("guildId");
        const queue = client.player.nodes.get(guildId);

        if (!queue || !queue.currentTrack)
          return send(res, 200, {
            playing: false,
            paused: false,
            song: null,
            queue: [],
            queueLength: 0,
          });

        const elapsed = queue.node.getTimestamp()?.current.value || 0;

        return send(res, 200, {
          playing: queue.isPlaying() && !queue.node.isPaused(),
          paused: queue.node.isPaused(),
          repeatMode: queue.repeatMode,
          volume: queue.node.volume,
          elapsed,
          song: {
            name: queue.currentTrack.title,
            url: queue.currentTrack.url,
            thumbnail: queue.currentTrack.thumbnail,
            duration: queue.currentTrack.durationMS || 0,
            formattedDuration: queue.currentTrack.duration,
            author: queue.currentTrack.author || "Unknown Artist",
          },
          queue: queue.tracks.toArray().slice(0, 10).map((s, i) => ({
            index: i + 1,
            name: s.title,
            url: s.url,
            thumbnail: s.thumbnail,
            formattedDuration: s.duration,
            author: s.author,
          })),
          queueLength: queue.tracks.size,
        });
      }

      if (req.method === "POST" && path === "/search") {
        const { query, limit } = await parseBody(req);
        if (!query) return send(res, 400, { error: "query is required" });

        try {
          const searchResult = await client.player.search(query);
          
          if (!searchResult || searchResult.isEmpty()) {
            return send(res, 200, { results: [] });
          }

          const maxResults = Math.min(Number(limit) || 10, 25);
          const results = searchResult.tracks.slice(0, maxResults).map((video) => ({
            title: video.title || "Untitled",
            author: video.author || "Unknown",
            duration: Math.floor((video.durationMS || 0) / 1000),
            url: video.url,
            thumbnail: video.thumbnail,
            id: video.id || "",
          }));

          return send(res, 200, { results });
        } catch (error) {
          console.error("[Search Error]", error);
          return send(res, 200, { results: [], error: "Search failed" });
        }
      }

      return send(res, 404, { error: "Not found" });
    } catch (err) {
      console.error("[MusicAPI Error]", err.message);
      return send(res, 500, { error: err.message });
    }
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server.listen(port, "0.0.0.0", () => {
    console.log(`🎵 Remani Music API listening on port ${port}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use. API server could not start.`);
    } else {
      console.error(`❌ API server error:`, err);
    }
  });

  return server;
};
