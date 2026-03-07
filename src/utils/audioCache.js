const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

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
    console.log("✅ Supabase initialized for audio caching");
  }
  return supabase;
}

const TEMP_BUCKET = "music-cache";
const PLAYLIST_BUCKET = "playlist-songs";

/**
 * Generate a unique file ID from YouTube URL
 */
function generateFileId(youtubeUrl) {
  const hash = crypto.createHash("md5").update(youtubeUrl).digest("hex");
  return hash.substring(0, 16);
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
    const { data: files } = await client.storage.from(bucket).list("songs", {
      search: `${fileId}.ogg`,
    });

    if (files && files.length > 0) {
      return `http://localhost:8000/stream/${fileId}.ogg?bucket=${bucket}`;
    }

    return null;
  } catch (error) {
    console.error("❌ Error checking cache:", error.message);
    return null;
  }
}

/**
 * Download audio from YouTube using Lavalink + direct stream download
 * @param {string} youtubeUrl - YouTube video URL
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<string>} - Path to downloaded file
 */
async function downloadFromYouTube(youtubeUrl, fileId) {
  const tmpDir = path.join(__dirname, "../../.tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const webmPath = path.join(tmpDir, `${fileId}.webm`);
  const oggPath = path.join(tmpDir, `${fileId}.ogg`);

  console.log(`⬇️ Downloading: ${youtubeUrl}`);

  try {
    // Step 1: Use Lavalink to resolve YouTube URL (bypasses bot detection with OAuth2)
    const lavalinkUrl = `http://localhost:2333/v4/loadtracks?identifier=${encodeURIComponent(youtubeUrl)}`;
    const lavalinkAuth = process.env.LAVALINK_PASSWORD || "youshallnotpass";

    const fetchWithRetry = (url, options, retries = 3) => {
      return fetch(url, options).then((res) => {
        if (!res.ok && retries > 0) {
          console.log(`Lavalink request failed, retrying... (${retries} left)`);
          return new Promise((resolve) => setTimeout(resolve, 1000)).then(() =>
            fetchWithRetry(url, options, retries - 1),
          );
        }
        return res;
      });
    };

    const response = await fetchWithRetry(lavalinkUrl, {
      headers: { Authorization: lavalinkAuth },
    });

    if (!response.ok) {
      throw new Error(`Lavalink returned ${response.status}`);
    }

    const data = await response.json();

    if (data.loadType !== "track" || !data.data?.info?.uri) {
      throw new Error(`Could not resolve track: ${data.loadType}`);
    }

    const streamUrl = data.data.info.uri;
    console.log(`🔗 Got stream URL from Lavalink`);

    // Step 2: Download the stream URL directly
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(webmPath);
      const protocol = streamUrl.startsWith("https") ? https : http;

      protocol
        .get(streamUrl, (streamResponse) => {
          if (streamResponse.statusCode !== 200) {
            reject(
              new Error(`Stream download failed: ${streamResponse.statusCode}`),
            );
            return;
          }

          streamResponse.pipe(file);

          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", (err) => {
          fs.unlink(webmPath, () => {});
          reject(err);
        });

      file.on("error", (err) => {
        fs.unlink(webmPath, () => {});
        reject(err);
      });
    });

    const stats = fs.statSync(webmPath);
    console.log(`✅ Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Step 3: Convert WebM to OGG/Opus for Lavaplayer compatibility
    console.log(`🔄 Converting to OGG/Opus format...`);
    try {
      execSync(
        `ffmpeg -i "${webmPath}" -c:a libopus -b:a 128k "${oggPath}" -y`,
        { stdio: "pipe" },
      );
      const oggStats = fs.statSync(oggPath);
      console.log(
        `✅ Converted: ${(oggStats.size / 1024 / 1024).toFixed(2)} MB`,
      );

      // Clean up WebM file
      fs.unlinkSync(webmPath);
      return oggPath;
    } catch (conversionError) {
      console.error(`❌ FFmpeg conversion failed:`, conversionError.message);
      // Fall back to WebM if conversion fails
      console.log(`⚠️ Using original WebM file`);
      return webmPath;
    }
  } catch (error) {
    console.error("❌ Download failed:", error.message);
    throw new Error(`Failed to download: ${error.message}`);
  }
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
  if (!client) {
    throw new Error("Supabase not initialized");
  }

  console.log(`☁️ Uploading to Supabase (${bucket})...`);

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileExt = filePath.endsWith(".ogg") ? ".ogg" : ".webm";
    const fileName = `songs/${fileId}${fileExt}`;

    const contentType = fileExt === ".ogg" ? "audio/ogg" : "audio/webm";
    const { error } = await client.storage
      .from(bucket)
      .upload(fileName, fileBuffer, {
        contentType: contentType,
        cacheControl: "3600",
        upsert: true,
      });

    if (error) throw error;

    console.log(`✅ Uploaded: ${fileName}`);

    return `http://localhost:8000/stream/${fileId}${fileExt}?bucket=${bucket}`;
  } catch (error) {
    console.error("❌ Upload failed:", error.message);
    throw new Error(`Failed to upload: ${error.message}`);
  }
}

/**
 * Clean up temporary local file
 */
function cleanupLocalFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🧹 Cleaned up: ${path.basename(filePath)}`);
    }
  } catch (error) {
    console.warn(`⚠️ Cleanup failed: ${error.message}`);
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
    await client.storage.from(bucket).remove([`songs/${fileId}.webm`]);
    console.log(`🗑️ Deleted from cache: ${fileId}`);
  } catch (error) {
    console.warn(`⚠️ Delete failed: ${error.message}`);
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
  if (cachedUrl) {
    console.log(`✅ Using cached version: ${fileId}`);
    return cachedUrl;
  }

  const filePath = await downloadFromYouTube(youtubeUrl, fileId);

  try {
    const signedUrl = await uploadToSupabase(filePath, fileId, bucket);

    cleanupLocalFile(filePath);

    if (!isPermanent) {
      setTimeout(() => {
        deleteFromSupabase(fileId, bucket);
      }, 3600000);
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
      .list("songs");

    if (!files || files.length === 0) return;

    const now = Date.now();
    const oldFiles = files.filter((file) => {
      const ageMs = now - new Date(file.created_at).getTime();
      return ageMs > 3600000; // Older than 1 hour
    });

    if (oldFiles.length > 0) {
      const filePaths = oldFiles.map((f) => `songs/${f.name}`);
      await client.storage.from(TEMP_BUCKET).remove(filePaths);
      console.log(`🧹 Cleaned ${oldFiles.length} old temporary files`);
    }
  } catch (error) {
    console.warn(`⚠️ Cleanup job failed: ${error.message}`);
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
