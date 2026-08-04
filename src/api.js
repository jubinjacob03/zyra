const http = require("node:http");
const crypto = require("node:crypto");
const { createLogger } = require("./utils/logger");

const log = createLogger("api");

/**
 * Compares two strings in constant time to avoid leaking length/content via timing.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

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
  const allowedOrigin = process.env.MUSIC_API_ALLOWED_ORIGIN || "*";

  const host = process.env.MUSIC_API_HOST || (apiKey ? "0.0.0.0" : "127.0.0.1");
  if (!apiKey) {
    log.warn(
      "MUSIC_API_KEY is not set — API authentication is disabled and the server " +
        "will bind to 127.0.0.1 only. Set MUSIC_API_KEY to expose it safely.",
    );
  }

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
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
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
    const rawPath = url.pathname;
    const path = rawPath.startsWith("/api/music/")
      ? "/" + rawPath.slice("/api/music/".length)
      : rawPath;

    if (apiKey) {
      const auth = req.headers.authorization || "";
      if (!safeEqual(auth, `Bearer ${apiKey}`)) {
        return send(res, 401, { error: "Unauthorized" });
      }
    }

    try {
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

      if (
        req.method === "POST" &&
        (path === "/control" || directActions.includes(path))
      ) {
        const body = await parseBody(req);
        const guildId = body.guildId;
        const action = path === "/control" ? body.action : path.substring(1);
        const value = body.value;

        const DiscordPlayer = require("./utils/DiscordPlayer");
        const isLavalink = DiscordPlayer.isUsingLavalink(client, guildId);
        const isDP = DiscordPlayer.isUsingDiscordPlayer(client, guildId);

        if (!isLavalink && !isDP) {
          return send(res, 404, { error: "Nothing is playing" });
        }

        try {
          switch (action) {
            case "pause":
            case "resume":
            case "toggle":
              if (isLavalink) {
                const lq = DiscordPlayer.lavalinkQueues.get(
                  DiscordPlayer.getQueueKey(client, guildId),
                );
                if (!lq) return send(res, 404, { error: "Nothing is playing" });
                if (action === "toggle") lq.paused = !lq.paused;
                else lq.paused = action === "pause";
                await lq.player.setPaused(lq.paused);
              } else {
                const q = client.player.nodes.get(guildId);
                if (!q) return send(res, 404, { error: "Nothing is playing" });
                if (action === "toggle") {
                  q.node.isPaused() ? q.node.resume() : q.node.pause();
                } else if (action === "pause") {
                  q.node.pause();
                } else {
                  q.node.resume();
                }
              }
              break;
            case "skip":
              await DiscordPlayer.skip(guildId, client);
              break;
            case "stop":
              await DiscordPlayer.stop(guildId, client);
              break;
            case "shuffle":
              await DiscordPlayer.shuffle(guildId, client);
              break;
            case "loop": {
              const mode = value !== undefined ? Number(value) : null;
              await DiscordPlayer.loop(guildId, client, mode);
              break;
            }
            case "volume": {
              const vol = await DiscordPlayer.setVolume(
                guildId,
                client,
                Number(value) || 50,
              );
              await DiscordPlayer.triggerUpdate(guildId, client);
              return send(res, 200, { success: true, volume: vol });
            }
            case "remove": {
              const idx = Number(value) || 0;
              let removedTitle = "Unknown";
              if (isLavalink) {
                const lq = DiscordPlayer.lavalinkQueues.get(
                  DiscordPlayer.getQueueKey(client, guildId),
                );
                if (!lq) return send(res, 404, { error: "Nothing is playing" });
                if (idx < 0 || idx >= lq.tracks.length) {
                  return send(res, 400, { error: "Invalid queue position" });
                }
                removedTitle = lq.tracks.splice(idx, 1)[0].info.title;
              } else {
                const q = client.player.nodes.get(guildId);
                if (!q) return send(res, 404, { error: "Nothing is playing" });
                const removed = q.tracks.removeOne(idx);
                if (!removed) {
                  return send(res, 400, { error: "Invalid queue position" });
                }
                removedTitle = removed.title;
              }
              await DiscordPlayer.triggerUpdate(guildId, client);
              return send(res, 200, { success: true, removed: removedTitle });
            }
            default:
              return send(res, 400, { error: `Unknown action: ${action}` });
          }

          await DiscordPlayer.triggerUpdate(guildId, client);
          return send(res, 200, { success: true, action });
        } catch (e) {
          return send(res, 500, { error: e.message });
        }
      }

      if (req.method === "GET" && path === "/queue") {
        const guildId = url.searchParams.get("guildId");
        const DiscordPlayer = require("./utils/DiscordPlayer");
        if (DiscordPlayer.isUsingLavalink(client, guildId)) {
          const lq = DiscordPlayer.lavalinkQueues.get(
            DiscordPlayer.getQueueKey(client, guildId),
          );
          if (!lq) return send(res, 200, { queue: [], queueLength: 0 });
          return send(res, 200, {
            queue: lq.tracks.map((s, i) => ({
              index: i,
              name: s.info.title,
              url: s.info.uri,
              thumbnail:
                s.info.artworkUrl ||
                `https://img.youtube.com/vi/${s.info.identifier}/hqdefault.jpg`,
              formattedDuration: DiscordPlayer.formatLavalinkDuration(
                s.info.length,
              ),
              author: s.info.author,
            })),
            queueLength: lq.tracks.length,
          });
        }
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
        const DiscordPlayer = require("./utils/DiscordPlayer");

        if (DiscordPlayer.isUsingLavalink(client, guildId)) {
          const lq = DiscordPlayer.lavalinkQueues.get(
            DiscordPlayer.getQueueKey(client, guildId),
          );
          if (!lq || !lq.current) {
            return send(res, 200, {
              playing: false,
              paused: false,
              song: null,
              queue: [],
              queueLength: 0,
            });
          }

          const elapsed = lq.player.position || 0;
          return send(res, 200, {
            playing: !lq.paused,
            paused: lq.paused,
            repeatMode: lq.loopMode,
            volume: lq.volume,
            elapsed,
            song: {
              name: lq.current.info.title,
              url: lq.current.info.uri,
              thumbnail:
                lq.current.info.artworkUrl ||
                `https://img.youtube.com/vi/${lq.current.info.identifier}/hqdefault.jpg`,
              duration: lq.current.info.length || 0,
              formattedDuration: DiscordPlayer.formatLavalinkDuration(
                lq.current.info.length,
              ),
              author: lq.current.info.author || "Unknown Artist",
            },
            queue: lq.tracks.slice(0, 10).map((s, i) => ({
              index: i + 1,
              name: s.info.title,
              url: s.info.uri,
              thumbnail:
                s.info.artworkUrl ||
                `https://img.youtube.com/vi/${s.info.identifier}/hqdefault.jpg`,
              formattedDuration: DiscordPlayer.formatLavalinkDuration(
                s.info.length,
              ),
              author: s.info.author,
            })),
            queueLength: lq.tracks.length,
          });
        }

        const queue = client.player.nodes.get(guildId);
        if (!queue || !queue.currentTrack) {
          return send(res, 200, {
            playing: false,
            paused: false,
            song: null,
            queue: [],
            queueLength: 0,
          });
        }

        const elapsed = queue.node.getTimestamp()?.current?.value || 0;

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
          queue: queue.tracks
            .toArray()
            .slice(0, 10)
            .map((s, i) => ({
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
        const body = await parseBody(req);
        const query = body.query || "";
        const limit = body.limit || 24;
        if (!query) return send(res, 400, { error: "Missing query" });

        const { searchWithPriority } = require("./utils/musicSearch");
        const fakeUser = { id: "api", username: "WebDashboard" };
        const results = await searchWithPriority(
          query,
          fakeUser,
          client,
          limit,
        );

        return send(res, 200, {
          results: results.map((t) => ({
            id: t.url?.split("v=")[1] || "",
            title: t.title,
            author: t.author,
            thumbnail: t.url
              ? `https://img.youtube.com/vi/${t.url.split("v=")[1]}/hqdefault.jpg`
              : "",
            duration:
              t.duration > 10000 ? Math.floor(t.duration / 1000) : t.duration,
            url: t.url,
          })),
        });
      }

      if (req.method === "GET" && path === "/trending") {
        const { getWatchdog } = require("./utils/watchdog");
        const watchdog = getWatchdog(client);
        if (!watchdog || !watchdog.isNodeAvailable()) {
          return send(res, 503, { error: "No Lavalink nodes available" });
        }

        const nodes = Array.from(watchdog.shoukaku.nodes.values()).filter(
          (node) => node.state === 1,
        );
        if (!nodes.length) {
          return send(res, 503, { error: "No online Lavalink nodes" });
        }

        const trendingQueries = [
          "ytmsearch:top hits 2026",
          "ytmsearch:trending music",
          "ytmsearch:popular songs today",
        ];

        const allTracks = [];
        const seenIds = new Set();
        const node = nodes[0];

        for (const searchStr of trendingQueries) {
          if (allTracks.length >= 24) break;
          try {
            const result = await Promise.race([
              node.rest.resolve(searchStr),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), 5000),
              ),
            ]);
            if (result?.loadType === "search" && Array.isArray(result.data)) {
              for (const track of result.data) {
                const id = track.info?.identifier;
                if (!id || seenIds.has(id)) continue;
                seenIds.add(id);
                allTracks.push(track);
                if (allTracks.length >= 24) break;
              }
            }
          } catch {}
        }

        return send(res, 200, {
          results: allTracks.map((t) => ({
            id: t.info?.identifier || "",
            title: t.info?.title || "Unknown",
            author: t.info?.author || "Unknown",
            thumbnail:
              t.info?.artworkUrl ||
              `https://img.youtube.com/vi/${t.info?.identifier}/hqdefault.jpg`,
            duration: t.info?.length ? Math.floor(t.info.length / 1000) : 0,
            url:
              t.info?.uri ||
              `https://www.youtube.com/watch?v=${t.info?.identifier}`,
          })),
        });
      }

      if (req.method === "POST" && path === "/play") {
        const body = await parseBody(req);
        const { guildId, voiceChannelId, query, userId, username } = body;
        if (!guildId || !voiceChannelId || !query) {
          return send(res, 400, {
            error: "Missing guildId, voiceChannelId, or query",
          });
        }

        const DiscordPlayer = require("./utils/DiscordPlayer");
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return send(res, 404, { error: "Guild not found" });

        const voiceChannel = guild.channels.cache.get(voiceChannelId);
        if (!voiceChannel)
          return send(res, 404, { error: "Voice channel not found" });

        const fakeInteraction = {
          user: {
            id: userId || "api",
            username: username || "WebDashboard",
            displayName: username || "WebDashboard",
          },
          channelId: null,
          guild,
        };

        try {
          const result = await DiscordPlayer.play(
            fakeInteraction,
            query,
            voiceChannel,
            client,
          );
          return send(res, 200, {
            success: true,
            song: { title: result.track?.title || "Unknown" },
            added: result.count || 1,
            isPlaylist: result.isPlaylist || false,
          });
        } catch (e) {
          return send(res, 500, { error: e.message });
        }
      }

      return send(res, 404, { error: "Not found" });
    } catch (err) {
      log.error("Unhandled API error:", err?.message || err);
      return send(res, 500, { error: "Internal server error" });
    }
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  server
    .listen(port, host, () => {
      log.info(`Remani Music API listening on ${host}:${port}`);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        log.error(
          `Port ${port} is already in use. API server could not start.`,
        );
      } else {
        log.error("API server error:", err?.message || err);
      }
    });

  return server;
};
