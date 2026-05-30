const { createLogger } = require("./logger");
const log = createLogger("spotify");

const axios = require("axios");

/**
 * @param {string} query
 * @returns {Promise<string>}
 */
async function resolveSpotifyQuery(query) {
  if (!query || typeof query !== "string") return query;
  if (query.startsWith("http://") || query.startsWith("https://")) return query;
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET)
    return query;

  try {
    const tokenResponse = await axios.post(
      "https://accounts.spotify.com/api/token",
      "grant_type=client_credentials",
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
            ).toString("base64"),
        },
      },
    );

    const searchResponse = await axios.get(
      "https://api.spotify.com/v1/search",
      {
        headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` },
        params: { q: query, type: "track", limit: 1 },
      },
    );

    const tracks = searchResponse.data.tracks.items;
    if (tracks.length > 0 && tracks[0].external_urls?.spotify) {
      return tracks[0].external_urls.spotify;
    }
  } catch (e) {
    log.error("Spotify API resolution error:", e.message);
  }

  return query;
}

module.exports = { resolveSpotifyQuery };
