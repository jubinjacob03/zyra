const { getWatchdog } = require("./watchdog");

async function searchWithPriority(query, user, client, limit = 25) {
  const cappedLimit = Math.max(1, Math.min(25, Number(limit) || 25));
  const lavalink = await searchWithLavalink(query, user, client, cappedLimit);
  return lavalink;
}

async function searchWithLavalink(query, user, client, limit) {
  const watchdog = getWatchdog(client);
  if (!watchdog || !watchdog.isNodeAvailable()) return [];

  const nodes = Array.from(watchdog.shoukaku.nodes.values()).filter(
    (node) => node.state === 1,
  );
  if (!nodes.length) return [];

  const prefixes = ["ytmsearch", "ytsearch"];

  let result;
  for (const prefix of prefixes) {
    const searchStr = `${prefix}:${query}`;
    const attempts = nodes.map((node) =>
      Promise.race([
        node.rest.resolve(searchStr),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("resolve timeout")), 5000),
        ),
      ]),
    );

    try {
      const candidate = await Promise.any(attempts);
      const hasData =
        candidate &&
        ((candidate.loadType === "search" && Array.isArray(candidate.data)) ||
          (candidate.loadType === "track" && candidate.data) ||
          (candidate.loadType === "playlist" && candidate.data?.info?.tracks));
      if (hasData) {
        result = candidate;
        break;
      }
    } catch {}
  }

  if (!result) return [];

  if (!result || !result.data) return [];

  let tracks = [];
  if (result.loadType === "search" && Array.isArray(result.data)) {
    tracks = result.data;
  } else if (result.loadType === "track" && result.data) {
    tracks = [result.data];
  } else if (result.loadType === "playlist" && result.data.info?.tracks) {
    tracks = result.data.info.tracks;
  }

  return tracks
    .map((t) => ({
      title: t.info?.title || "Unknown",
      url: getTrackUrl(t),
      duration: t.info?.length || 0,
      author: t.info?.author || "Unknown",
      requestedBy: user,
    }))
    .filter((t) => isYouTubeUrl(t.url))
    .slice(0, limit);
}

function isYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(
    String(url || ""),
  );
}

function getTrackUrl(track) {
  const uri = track?.info?.uri;
  if (uri) return uri;

  const id = String(track?.info?.identifier || "");
  if (/^[a-zA-Z0-9_-]{6,}$/.test(id)) {
    return `https://www.youtube.com/watch?v=${id}`;
  }

  return "";
}

function formatDuration(duration) {
  if (!duration) return "0:00";
  const seconds = duration > 10000 ? Math.floor(duration / 1000) : duration;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

module.exports = {
  searchWithPriority,
  formatDuration,
};
