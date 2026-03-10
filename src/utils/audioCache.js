const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

let supabase = null;

function initSupabase() {
  if (
    !supabase &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_KEY
  ) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }
  return supabase;
}

const TEMP_BUCKET = "music-cache";
const PLAYLIST_BUCKET = "playlist-songs";
const SONGS_PREFIX = "songs/";
const AUDIO_FORMAT = "ogg";
const STREAM_BASE_URL = "http://localhost:8000/stream";

/**
 * Generate a unique file ID from YouTube URL
 */
function generateFileId(youtubeUrl) {
  return crypto
    .createHash("md5")
    .update(youtubeUrl)
    .digest("hex")
    .substring(0, 16);
}

/**
 * Construct stream URL for a file
 */
function getStreamUrl(fileId, bucket) {
  return `${STREAM_BASE_URL}/${fileId}.${AUDIO_FORMAT}?bucket=${bucket}`;
}

/**
 * Download file from URL to local path
 * @param {string} url - Download URL
 * @param {string} destPath - Destination file path
 * @param {number} timeout - Request timeout in milliseconds
 * @returns {Promise<void>}
 */
function downloadFromUrl(url, destPath, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith("https") ? https : http;

    const cleanup = () => {
      file.close();
      fs.unlink(destPath, () => {});
    };

    const handleResponse = (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        https
          .get(response.headers.location, handleResponse)
          .on("error", reject);
        return;
      }

      if (response.statusCode !== 200) {
        cleanup();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
      file.on("error", (err) => {
        cleanup();
        reject(err);
      });
    };

    const request = protocol.get(url, handleResponse);
    request.on("error", (err) => {
      cleanup();
      reject(err);
    });
    request.setTimeout(timeout, () => {
      request.destroy();
      reject(new Error("Timeout"));
    });
  });
}

/**
 * Check if a song is already cached in Supabase
 * @param {string} fileId - Unique file identifier
 * @param {string} bucket - Storage bucket name
 * @returns {Promise<string|null>} - Stream URL if exists, null otherwise
 */
async function checkCache(fileId, bucket) {
  const client = initSupabase();
  if (!client) return null;

  try {
    const { data: files } = await client.storage
      .from(bucket)
      .list(SONGS_PREFIX.slice(0, -1), {
        search: `${fileId}.${AUDIO_FORMAT}`,
      });
    return files?.length > 0 ? getStreamUrl(fileId, bucket) : null;
  } catch (error) {
    console.error("Cache check failed:", error.message);
    return null;
  }
}

/**
 * Call Cobalt API to get audio URL
 */
async function callCobaltApi(instance, youtubeUrl) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      url: youtubeUrl,
      aFormat: AUDIO_FORMAT,
      isAudioOnly: true,
    });

    const url = new URL(instance);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: "/api/json",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
          Accept: "application/json",
        },
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Invalid JSON"));
          }
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    req.write(postData);
    req.end();
  });
}

/**
 * Download audio from YouTube via Cobalt API
 * @param {string} youtubeUrl - YouTube video URL
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<string>} - Path to downloaded file
 */
async function downloadFromYouTube(youtubeUrl, fileId) {
  const tmpDir = path.join(__dirname, "../../.tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const filePath = path.join(tmpDir, `${fileId}.${AUDIO_FORMAT}`);
  const cobaltInstances = [
    "https://co.wuk.sh",
    "https://cobalt-api.kwiatekmiki.com",
  ];

  let streamUrl = null;
  for (const instance of cobaltInstances) {
    try {
      const response = await callCobaltApi(instance, youtubeUrl);
      if (response.status === "tunnel" && response.url) {
        streamUrl = response.url;
        break;
      }
    } catch (error) {
      console.warn(`Cobalt ${instance} failed:`, error.message);
    }
  }

  if (!streamUrl) throw new Error("All Cobalt instances failed");

  await downloadFromUrl(streamUrl, filePath, 60000);
  const stats = fs.statSync(filePath);
  console.log(`✅ Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  return filePath;
}

/**
 * Upload audio file to Supabase storage
 * @param {string} filePath - Local file path
 * @param {string} fileId - Unique file identifier
 * @param {string} bucket - Storage bucket name
 * @returns {Promise<string>} - Stream URL for Lavalink
 */
async function uploadToSupabase(filePath, fileId, bucket) {
  const client = initSupabase();
  if (!client) throw new Error("Supabase not initialized");

  const { error } = await client.storage
    .from(bucket)
    .upload(
      `${SONGS_PREFIX}${fileId}.${AUDIO_FORMAT}`,
      fs.readFileSync(filePath),
      {
        contentType: `audio/${AUDIO_FORMAT}`,
        cacheControl: "3600",
        upsert: true,
      },
    );

  if (error) throw error;
  return getStreamUrl(fileId, bucket);
}

function cleanupLocalFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.warn("Cleanup failed:", error.message);
  }
}

/**
 * Delete cached song from Supabase
 * @param {string} fileId - Unique file identifier
 * @param {string} bucket - Storage bucket name
 */
async function deleteFromSupabase(fileId, bucket) {
  const client = initSupabase();
  if (!client) return;

  try {
    await client.storage
      .from(bucket)
      .remove([`${SONGS_PREFIX}${fileId}.${AUDIO_FORMAT}`]);
  } catch (error) {
    console.warn("Delete failed:", error.message);
  }
}

/**
 * Main function: Get streamable URL for a YouTube video
 * Downloads if not cached, uploads to Supabase, returns signed URL
 * @param {string} youtubeUrl - YouTube video URL
 * @param {boolean} isPermanent - Store permanently (for playlists) or temporarily
 * @returns {Promise<string>} - Signed URL for streaming with Lavalink
 */
async function getStreamableUrl(youtubeUrl, isPermanent = false) {
  const fileId = generateFileId(youtubeUrl);
  const bucket = isPermanent ? PLAYLIST_BUCKET : TEMP_BUCKET;

  const cachedUrl = await checkCache(fileId, bucket);
  if (cachedUrl) return cachedUrl;

  const filePath = await downloadFromYouTube(youtubeUrl, fileId);

  try {
    const signedUrl = await uploadToSupabase(filePath, fileId, bucket);
    cleanupLocalFile(filePath);

    if (!isPermanent) {
      setTimeout(() => deleteFromSupabase(fileId, bucket), 3600000);
    }

    return signedUrl;
  } catch (error) {
    cleanupLocalFile(filePath);
    throw error;
  }
}

/**
 * Clean old temporary files from Supabase (called periodically)
 */
async function cleanupOldFiles() {
  const client = initSupabase();
  if (!client) return;

  try {
    const { data: files } = await client.storage
      .from(TEMP_BUCKET)
      .list(SONGS_PREFIX.slice(0, -1));
    if (!files?.length) return;

    const now = Date.now();
    const oldFiles = files.filter(
      (f) => now - new Date(f.created_at).getTime() > 3600000,
    );

    if (oldFiles.length > 0) {
      await client.storage
        .from(TEMP_BUCKET)
        .remove(oldFiles.map((f) => `${SONGS_PREFIX}${f.name}`));
    }
  } catch (error) {
    console.warn("Cleanup job failed:", error.message);
  }
}

setInterval(cleanupOldFiles, 600000);

module.exports = {
  getStreamableUrl,
  deleteFromSupabase,
  cleanupOldFiles,
  generateFileId,
  checkCache,
  TEMP_BUCKET,
  PLAYLIST_BUCKET,
};
