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
    const path = url.pathname;

    if (apiKey) {
      const auth = req.headers.authorization || "";
      if (!safeEqual(auth, `Bearer ${apiKey}`)) {
        return send(res, 401, { error: "Unauthorized" });
      }
    }

    try {
      if (req.method === "GET" && (path === "/" || path === "/index.html" || path === "/netflix" || path === "/netflix.html")) {
        const fs = require("fs");
        const fp = require("path");
        try {
          const file = fs.readFileSync(fp.join(__dirname, "../zyra-activity/out/index.html"));
          res.writeHead(200, { "Content-Type": "text/html" });
          return res.end(file);
        } catch (err) {
          log.error("Could not read React index.html:", err.message);
          return send(res, 500, { error: "Could not load activity interface" });
        }
      }

      // Serve Next.js static assets (_next folder)
      if (req.method === "GET" && path.startsWith("/_next/")) {
        const fs = require("fs");
        const fp = require("path");
        try {
          const filePath = fp.join(__dirname, "../zyra-activity/out", path);
          if (fs.existsSync(filePath)) {
            const ext = fp.extname(filePath);
            let contentType = "text/plain";
            if (ext === ".js") contentType = "application/javascript";
            else if (ext === ".css") contentType = "text/css";
            else if (ext === ".json") contentType = "application/json";
            
            const file = fs.readFileSync(filePath);
            res.writeHead(200, { "Content-Type": contentType });
            return res.end(file);
          }
        } catch (err) {
          log.error("Could not read static asset:", err.message);
        }
      }

      if (req.method === "GET" && path === "/health") {
        return send(res, 200, {
          ok: true,
          uptime: Math.floor(process.uptime()),
        });
      }

      if (req.method === "POST" && path === "/play") {
        const {
          guildId,
          voiceChannelId,
          query,
          userId,
          username,
          fallbackQuery,
        } = await parseBody(req);

        if (!guildId || !voiceChannelId || !query)
          return send(res, 400, {
            error: "guildId, voiceChannelId, query are required",
          });

        const guild = client.guilds.cache.get(guildId);
        if (!guild)
          return send(res, 404, { error: "Bot is not in this guild" });

        const voiceChannel = client.channels.cache.get(voiceChannelId);
        if (!voiceChannel)
          return send(res, 404, { error: "Voice channel not found" });

        let textChannel = null;
        if (client.INSTANCE_VOICE_CHANNEL_ID) {
          textChannel = voiceChannel;
        }
        if (!textChannel || typeof textChannel.send !== "function") {
          const fallbackId = process.env.FALLBACK_TEXT_CHANNEL_ID;
          textChannel =
            (fallbackId ? guild.channels.cache.get(fallbackId) : null) ||
            guild.systemChannel ||
            guild.channels.cache.find(
              (c) =>
                c.type === 0 &&
                c.permissionsFor(guild.members.me)?.has("SendMessages"),
            );
        }
        if (!textChannel)
          return send(res, 500, {
            error: "No accessible text channel in guild",
          });

        const webApiUser = {
          id: userId || "api",
          displayName: username || "API Player",
          username: username || "api",
        };

        const apiFallback = fallbackQuery ? ` fallback=${fallbackQuery}` : "";
        log.info(
          `API /play: guild=${guildId} vc=${voiceChannelId} user=${webApiUser.id} query=${query}${apiFallback}`,
        );

        const webApiInteraction = {
          user: webApiUser,
          member: { voice: { channel: voiceChannel } },
          channel: textChannel,
        };

        const DiscordPlayer = require("./utils/DiscordPlayer");
        try {
          const playResult = await DiscordPlayer.play(
            webApiInteraction,
            query,
            voiceChannel,
            client,
            fallbackQuery,
          );

          log.info(
            `API /play success: guild=${guildId} added=${playResult.count} playlist=${playResult.isPlaylist ? "yes" : "no"}`,
          );

          return send(res, 200, {
            success: true,
            isNewQueue: true,
            added: playResult.count,
            song: playResult.isPlaylist
              ? null
              : {
                  name:
                    playResult.track.title ||
                    playResult.track.name ||
                    "Unknown",
                  url: playResult.track.url || playResult.track.uri || query,
                  thumbnail: playResult.track.thumbnail || "",
                  formattedDuration: playResult.track.duration || "0:00",
                  author: playResult.track.author || "Unknown Artist",
                },
          });
        } catch (e) {
          log.warn(
            "API /play failed:",
            e?.message || e,
            `guild=${guildId}`,
            `vc=${voiceChannelId}`,
          );
          return send(res, 404, {
            error: e.message || "No results found for query",
          });
        }
      }

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
                if (action === "toggle")
                  q.node.isPaused() ? q.node.resume() : q.node.pause();
                else action === "pause" ? q.node.pause() : q.node.resume();
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
                if (idx < 0 || idx >= lq.tracks.length)
                  return send(res, 400, { error: "Invalid queue position" });
                removedTitle = lq.tracks.splice(idx, 1)[0].info.title;
              } else {
                const q = client.player.nodes.get(guildId);
                if (!q) return send(res, 404, { error: "Nothing is playing" });
                const removed = q.tracks.removeOne(idx);
                if (!removed)
                  return send(res, 400, { error: "Invalid queue position" });
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
          if (!lq || !lq.current)
            return send(res, 200, {
              playing: false,
              paused: false,
              song: null,
              queue: [],
              queueLength: 0,
            });
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
        if (!queue || !queue.currentTrack)
          return send(res, 200, {
            playing: false,
            paused: false,
            song: null,
            queue: [],
            queueLength: 0,
          });

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
        const { query, limit } = await parseBody(req);
        if (!query) return send(res, 400, { error: "query is required" });

        try {
          const { getWatchdog } = require("./utils/watchdog");
          const watchdog = getWatchdog(client);
          let results = [];
          const maxResults = Math.min(Number(limit) || 10, 25);

          if (watchdog && watchdog.isNodeAvailable()) {
            const node = watchdog.shoukaku.options.nodeResolver(
              watchdog.shoukaku.nodes,
            );
            if (node) {
              const searchStr =
                query.startsWith("http") || query.startsWith("ytsearch:")
                  ? query
                  : `ytsearch:${query}`;
              const searchResult = await node.rest.resolve(searchStr);
              if (searchResult && searchResult.data) {
                let tracks =
                  searchResult.data.tracks ||
                  (Array.isArray(searchResult.data)
                    ? searchResult.data
                    : [searchResult.data]);
                if (!Array.isArray(tracks)) tracks = [];
                results = tracks.slice(0, maxResults).map((track) => {
                  const t = track.info;
                  return {
                    title: t.title || "Untitled",
                    author: t.author || "Unknown",
                    duration: Math.floor((t.length || 0) / 1000),
                    url: t.uri || "",
                    thumbnail:
                      t.artworkUrl ||
                      (t.uri && t.identifier
                        ? `https://i.ytimg.com/vi/${t.identifier}/hqdefault.jpg`
                        : ""),
                    id: t.identifier || "",
                  };
                });
              }
            }
          }

          if (results.length === 0) {
            const searchResult = await client.player.search(query);
            if (searchResult && !searchResult.isEmpty()) {
              results = searchResult.tracks
                .slice(0, maxResults)
                .map((video) => ({
                  title: video.title || "Untitled",
                  author: video.author || "Unknown",
                  duration: Math.floor((video.durationMS || 0) / 1000),
                  url: video.url,
                  thumbnail: video.thumbnail,
                  id: video.id || "",
                }));
            }
          }

          return send(res, 200, { results });
        } catch (error) {
          log.error("Search error:", error?.message || error);
          return send(res, 200, { results: [], error: "Search failed" });
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

  try {
    const { Server } = require("socket.io");
    const io = new Server(server, { cors: { origin: "*" } });
    
    io.on("connection", (socket) => {
      log.debug(`Activity sync client connected: ${socket.id}`);
      
      socket.on("join_channel", (channelId) => {
        socket.join(channelId);
        log.debug(`Socket ${socket.id} joined VC room: ${channelId}`);
      });
      
      socket.on("video_state_change", (data) => {
        if (data && data.channelId) {
          socket.to(data.channelId).emit("sync_video", data);
        }
      });
      
      socket.on("user_action", (data) => {
        if (data && data.action) {
          log.info(`[Activity Log] User: ${data.user || "Unknown"} | Channel: ${data.channelId} | Action: ${data.action} | Details: ${data.details || ""}`);
        }
      });
    });
    log.info("Activity Sync WebSocket server initialized.");
  } catch (e) {
    log.error("Failed to initialize Socket.io for Activity Sync:", e?.message || e);
  }

  server
    .listen(port, host, () => {
      log.info(`Remani Music API listening on ${host}:${port}`);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        log.error(`Port ${port} is already in use. API server could not start.`);
      } else {
        log.error("API server error:", err?.message || err);
      }
    });

  return server;
};
