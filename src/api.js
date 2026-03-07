const http = require("node:http");
const { formatDuration } = require("./utils/embed");

module.exports = function attachMusicApi(client) {
  const port = parseInt(process.env.MUSIC_API_PORT) || 3002;
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

    if (apiKey && !path.startsWith("/stream/")) {
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
        const {
          guildId,
          voiceChannelId,
          query,
          userId,
          username,
          fromPlaylist,
        } = await parseBody(req);

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

        let result;

        if (fromPlaylist) {
          try {
            const {
              generateFileId,
              checkCache,
            } = require("./utils/audioCache");
            const fileId = generateFileId(query);
            const cachedUrl = await checkCache(fileId, "playlist-songs");

            if (cachedUrl) {
              const node = client.shoukaku.options.nodeResolver(
                client.shoukaku.nodes,
              );
              if (node) {
                const trackData = await node.rest.resolve(cachedUrl);
                if (trackData?.tracks?.length > 0) {
                  const track = trackData.tracks[0];
                  result = {
                    type: "single",
                    name: track.info.title,
                    url: query,
                    thumbnail: track.info.artworkUrl || "",
                    duration: Math.floor(track.info.length / 1000),
                    formattedDuration: formatDuration(
                      Math.floor(track.info.length / 1000),
                    ),
                    author: track.info.author || "",
                    encoded: track.encoded,
                    fromPlaylist: true,
                    cachedUrl: cachedUrl,
                  };
                }
              }
            }
          } catch (error) {
            console.error("[Playlist Cache Check]", error);
          }
        }

        if (!result) {
          result = await client.searchSong(query, fakeUser);
        }

        if (!result)
          return send(res, 404, { error: "No results found for query" });

        let queue = client.getQueue(guildId);
        const isNewQueue = !queue;

        if (!queue)
          queue = await client.createQueue(guildId, textChannel, voiceChannel);

        if (result.type === "playlist") {
          await queue.addSongs(result.songs);
        } else {
          await queue.addSong(result);
        }

        if (isNewQueue) await queue.play();

        return send(res, 200, {
          success: true,
          isNewQueue,
          added: result.type === "playlist" ? result.songs.length : 1,
          song:
            result.type !== "playlist"
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

      // ── Legacy generic control (kept for backward compat) ────────────────
      if (req.method === "POST" && path === "/control") {
        const { guildId, action, value } = await parseBody(req);
        const queue = client.getQueue(guildId);
        if (!queue) return send(res, 404, { error: "Nothing is playing" });
        switch (action) {
          case "pause":
            queue.pause();
            break;
          case "resume":
            queue.resume();
            break;
          case "toggle":
            queue.paused ? queue.resume() : queue.pause();
            break;
          case "skip":
            queue.skip();
            break;
          case "stop":
            queue.stop();
            break;
          case "shuffle":
            queue.shuffle();
            break;
          case "loop":
            queue.setRepeatMode(value ?? (queue.repeatMode + 1) % 3);
            break;
          case "volume":
            queue.setVolume(Math.max(0, Math.min(100, Number(value) || 50)));
            break;
          case "seek":
            queue.seek(Number(value) || 0);
            break;
          case "remove": {
            const removed = queue.remove(Number(value) || 0);
            if (!removed)
              return send(res, 400, { error: "Invalid queue position" });
            return send(res, 200, {
              success: true,
              action,
              removed: removed.name,
            });
          }
          case "filter":
            await queue.setFilter(value || "off");
            break;
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
          "/seek",
          "/remove",
          "/filter",
        ];
        if (directActions.includes(path)) {
          const body = await parseBody(req);
          const guildId = body.guildId;
          const queue = client.getQueue(guildId);
          if (!queue) return send(res, 404, { error: "Nothing is playing" });

          switch (path) {
            case "/skip":
              queue.skip();
              break;
            case "/pause":
              queue.pause();
              break;
            case "/resume":
              queue.resume();
              break;
            case "/toggle":
              queue.paused ? queue.resume() : queue.pause();
              break;
            case "/stop":
              queue.stop();
              break;
            case "/shuffle":
              queue.shuffle();
              break;
            case "/loop": {
              const mode =
                body.value !== undefined
                  ? Number(body.value)
                  : (queue.repeatMode + 1) % 3;
              queue.setRepeatMode(mode);
              break;
            }
            case "/volume": {
              const vol = Math.max(0, Math.min(100, Number(body.value) || 50));
              queue.setVolume(vol);
              return send(res, 200, { success: true, volume: vol });
            }
            case "/seek": {
              queue.seek(Number(body.value) || 0);
              break;
            }
            case "/remove": {
              const removed = queue.remove(Number(body.value) || 0);
              if (!removed)
                return send(res, 400, { error: "Invalid queue position" });
              return send(res, 200, { success: true, removed: removed.name });
            }
            case "/filter": {
              await queue.setFilter(body.value || "off");
              return send(res, 200, {
                success: true,
                filter: body.value || "off",
              });
            }
          }
          return send(res, 200, { success: true });
        }
      }

      if (req.method === "GET" && path === "/queue") {
        const guildId = url.searchParams.get("guildId");
        const queue = client.getQueue(guildId);
        if (!queue) return send(res, 200, { queue: [], queueLength: 0 });
        return send(res, 200, {
          queue: queue.songs.map((s, i) => ({
            index: i,
            name: s.name,
            url: s.url,
            thumbnail: s.thumbnail,
            formattedDuration: s.formattedDuration,
            author: s.author,
          })),
          queueLength: queue.songs.length,
        });
      }

      if (req.method === "GET" && path === "/status") {
        const guildId = url.searchParams.get("guildId");
        const queue = client.getQueue(guildId);

        if (!queue || !queue.songs.length)
          return send(res, 200, {
            playing: false,
            paused: false,
            song: null,
            queue: [],
            queueLength: 0,
          });

        // queue.position is raw Lavalink ms — divide to match web's seconds-based elapsed
        const elapsed = Math.floor((queue.position ?? 0) / 1000);

        return send(res, 200, {
          playing: queue.playing && !queue.paused,
          paused: queue.paused,
          repeatMode: queue.repeatMode,
          volume: queue.volume,
          elapsed,
          currentFilter: queue.currentFilter || "off",
          song: {
            name: queue.songs[0].name,
            url: queue.songs[0].url,
            thumbnail: queue.songs[0].thumbnail,
            duration: queue.songs[0].duration || 0,
            formattedDuration: queue.songs[0].formattedDuration,
            author: queue.songs[0].author || "Unknown Artist",
          },
          queue: queue.songs.slice(1, 10).map((s, i) => ({
            index: i + 1,
            name: s.name,
            thumbnail: s.thumbnail,
            formattedDuration: s.formattedDuration,
            author: s.author,
          })),
          queueLength: queue.songs.length,
        });
      }

      if (req.method === "POST" && path === "/cache-song") {
        const { youtubeUrl } = await parseBody(req);
        if (!youtubeUrl)
          return send(res, 400, { error: "youtubeUrl is required" });

        try {
          const { getStreamableUrl } = require("./utils/audioCache");
          const streamUrl = await getStreamableUrl(youtubeUrl, true);

          return send(res, 200, {
            success: true,
            streamUrl,
            message: "Song cached permanently",
          });
        } catch (error) {
          console.error("[Cache Song Error]", error);
          return send(res, 500, {
            error: `Failed to cache song: ${error.message}`,
          });
        }
      }

      if (req.method === "DELETE" && path === "/delete-cache") {
        const { youtubeUrl } = await parseBody(req);
        if (!youtubeUrl)
          return send(res, 400, { error: "youtubeUrl is required" });

        try {
          const {
            generateFileId,
            deleteFromSupabase,
          } = require("./utils/audioCache");
          const fileId = generateFileId(youtubeUrl);
          await deleteFromSupabase(fileId, "playlist-songs");

          return send(res, 200, {
            success: true,
            message: "Cached song deleted",
          });
        } catch (error) {
          console.error("[Delete Cache Error]", error);
          return send(res, 500, {
            error: `Failed to delete cached song: ${error.message}`,
          });
        }
      }

      if (req.method === "POST" && path === "/search") {
        const { query, limit } = await parseBody(req);
        if (!query) return send(res, 400, { error: "query is required" });

        const node = client.shoukaku.options.nodeResolver(
          client.shoukaku.nodes,
        );
        if (!node)
          return send(res, 503, { error: "No Lavalink nodes available" });

        const result = await node.rest.resolve(`ytmsearch:${query}`);
        if (!result || result.loadType !== "search" || !result.data?.length)
          return send(res, 200, { results: [] });

        const max = Math.min(Number(limit) || 10, 25);
        const results = result.data.slice(0, max).map((t) => ({
          title: t.info?.title,
          author: t.info?.author,
          duration: Math.floor((t.info?.length || 0) / 1000),
          url: t.info?.uri,
          thumbnail: t.info?.artworkUrl,
          encoded: t.encoded,
        }));

        return send(res, 200, { results });
      }

      if (req.method === "GET" && path.startsWith("/stream/")) {
        const fileIdMatch = path.match(/^\/stream\/([a-f0-9]{16})(?:\.webm)?$/);
        if (!fileIdMatch) {
          return send(res, 400, { error: "Invalid file ID format" });
        }

        const fileId = fileIdMatch[1];
        const bucket = url.searchParams.get("bucket") || "playlist-songs";

        try {
          const { createClient } = require("@supabase/supabase-js");
          const https = require("https");

          if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
            return send(res, 503, { error: "Supabase not configured" });
          }

          const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY,
            {
              auth: {
                autoRefreshToken: false,
                persistSession: false,
              },
            },
          );

          const { data: urlData, error: urlError } = await supabase.storage
            .from(bucket)
            .createSignedUrl(`songs/${fileId}.webm`, 3600);

          if (urlError || !urlData?.signedUrl) {
            return send(res, 404, { error: "Cached file not found" });
          }

          await new Promise((resolve, reject) => {
            https
              .get(urlData.signedUrl, (supabaseRes) => {
                if (supabaseRes.statusCode !== 200) {
                  reject(
                    new Error(`Supabase returned ${supabaseRes.statusCode}`),
                  );
                  return;
                }

                const headers = {
                  "Content-Type": "audio/webm",
                  "Cache-Control": "public, max-age=3600",
                  Connection: "keep-alive",
                  "Accept-Ranges": "bytes",
                };

                // Pass through Content-Length from Supabase response
                if (supabaseRes.headers["content-length"]) {
                  headers["Content-Length"] =
                    supabaseRes.headers["content-length"];
                }

                res.writeHead(200, headers);
                supabaseRes.pipe(res);
                supabaseRes.on("end", resolve);
                supabaseRes.on("error", reject);
              })
              .on("error", reject);
          });

          return;
        } catch (error) {
          console.error("[Stream Error]", error);
          return send(res, 500, { error: `Stream failed: ${error.message}` });
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
  });

  return server;
};
