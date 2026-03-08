/**
 * Audio Caching Module - YouTube Download & Supabase Storage
 *
 * Environment Variables Required:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_KEY: Supabase service role key
 * - YOUTUBE_VISITOR_DATA: YouTube visitor data from PoToken generation
 * - YOUTUBE_POTOKEN: PoToken for YouTube authentication
 * - YOUTUBE_COOKIE (optional): YouTube cookies for enhanced authentication
 *
 * To get YOUTUBE_COOKIE (if bot detection occurs):
 * 1. Log into YouTube in a browser
 * 2. Open DevTools > Application > Cookies > youtube.com
 * 3. Copy all cookies in format: "name1=value1; name2=value2; ..."
 * 4. Set as environment variable: YOUTUBE_COOKIE="your_cookies_here"
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
 * Extract video ID from YouTube URL
 * @param {string} url - YouTube URL or video ID
 * @returns {string} - Video ID
 */
function extractVideoId(url) {
  if (/^[\w-]{11}$/.test(url)) return url;

  if (url.includes("/shorts/")) {
    throw new Error("YouTube Shorts are not supported");
  }

  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /embed\/([\w-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Could not extract video ID from: ${url}`);
}

/**
 * Check if a song is already cached in Supabase
 * @param {string} fileId - Unique file identifier
 * @param {string} bucket - Storage bucket name
 * @returns {Promise<string|null>} - Signed URL if exists, null otherwise
 */
async function checkCache(fileId, bucket) {
  const client = initSupabase();
  if (!client) return null;

  try {
    const { data: files } = await client.storage.from(bucket).list("songs", {
      search: `${fileId}.webm`,
    });

    if (files && files.length > 0) {
      const { data } = await client.storage
        .from(bucket)
        .createSignedUrl(`songs/${fileId}.webm`, 3600);

      return data?.signedUrl || null;
    }

    return null;
  } catch (error) {
    console.error("❌ Error checking cache:", error.message);
    return null;
  }
}

/**
 * Download audio from YouTube using YouTube.js (InnerTube API)
 * @param {string} youtubeUrl - YouTube video URL
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<string>} - Path to downloaded file
 */
async function downloadFromYouTube(youtubeUrl, fileId) {
  const tmpDir = path.join(__dirname, "../../.tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const outputPath = path.join(tmpDir, `${fileId}.webm`);
  const videoId = extractVideoId(youtubeUrl);

  console.log(`⬇️ Downloading via YouTube.js: ${youtubeUrl}`);

  try {
    const { Innertube, Utils, UniversalCache } = await import("youtubei.js");

    const cacheDir = path.join(__dirname, "../../cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const config = {
      cache: new UniversalCache(false),
      fetch: async (input, init) => {
        let url;
        if (typeof input === "string") {
          url = input;
        } else if (input && typeof input === "object" && "url" in input) {
          url = input.url;
        }
        if (url) {
          const displayUrl =
            url.length > 80 ? url.substring(0, 80) + "..." : url;
          console.log(`🌐 Fetching: ${displayUrl}`);
        }
        return fetch(input, init);
      },
    };

    if (process.env.YOUTUBE_VISITOR_DATA && process.env.YOUTUBE_POTOKEN) {
      config.visitor_data = process.env.YOUTUBE_VISITOR_DATA;
      config.po_token = process.env.YOUTUBE_POTOKEN;
      console.log(`🔐 Using PoToken authentication`);
    }

    if (process.env.YOUTUBE_COOKIE) {
      config.cookie = process.env.YOUTUBE_COOKIE;
      console.log(`🍪 Using cookie authentication`);
    }

    const yt = await Innertube.create(config);

    console.log(`🔍 Getting video info...`);
    const info = await yt.getInfo(videoId);

    if (info.playability_status?.status !== "OK") {
      const reason = info.playability_status?.reason || "Unknown error";
      throw new Error(`Video not playable: ${reason}`);
    }

    console.log(`📹 Title: ${info.basic_info.title}`);
    console.log(`⏱️ Duration: ${info.basic_info.duration}s`);

    const format = info.chooseFormat({
      type: "audio",
      quality: "best",
      format: "opus",
    });

    if (!format) {
      throw new Error("No suitable audio format found");
    }

    console.log(
      `🎵 Selected format: ${format.mime_type} (${format.bitrate} bps)`,
    );

    console.log(`🎵 Downloading audio stream...`);
    const stream = await yt.download(videoId, {
      type: "audio",
      quality: "best",
      format: "webm",
    });

    const file = fs.createWriteStream(outputPath);
    let downloadedBytes = 0;

    for await (const chunk of Utils.streamToIterable(stream)) {
      file.write(chunk);
      downloadedBytes += chunk.length;
    }

    await new Promise((resolve, reject) => {
      file.on("finish", resolve);
      file.on("error", reject);
      file.close();
    });

    const stats = fs.statSync(outputPath);
    console.log(`✅ Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    return outputPath;
  } catch (error) {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    console.error("❌ YouTube.js download failed:", error.message);

    if (error.message?.includes("Sign in to confirm")) {
      console.error("🤖 Bot detection triggered. Possible solutions:");
      console.error(
        "   1. Add YOUTUBE_COOKIE env variable with authenticated cookies",
      );
      console.error("   2. Regenerate PoToken (may be expired)");
      console.error("   3. Wait before retrying");
      throw new Error("Bot detection - authentication required");
    }
    if (
      error.message?.includes("Failed to extract signature") ||
      error.message?.includes("Failed to extract n")
    ) {
      console.error(
        "🔧 Player decipher failed. YouTube may have updated their player.",
      );
      console.error("   Try: npm update youtubei.js");
      throw new Error("Stream decryption failed - update required");
    }
    if (error.message?.includes("LOGIN_REQUIRED")) {
      throw new Error("Age-restricted video - cookie authentication required");
    }
    if (error.message?.includes("UNPLAYABLE")) {
      throw new Error("Video is not available for playback");
    }
    if (error.message?.includes("Video not playable")) {
      throw error;
    }

    throw new Error(`Failed to download: ${error.message}`);
  }
}

/**
 * Upload audio file to Supabase storage
 * @param {string} filePath - Local file path
 * @param {string} fileId - Unique file identifier
 * @param {string} bucket - Storage bucket name
 * @returns {Promise<string>} - Signed URL for streaming
 */
async function uploadToSupabase(filePath, fileId, bucket) {
  const client = initSupabase();
  if (!client) {
    throw new Error("Supabase not initialized");
  }

  console.log(`☁️ Uploading to Supabase (${bucket})...`);

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = `songs/${fileId}.webm`;

    const { data, error } = await client.storage
      .from(bucket)
      .upload(fileName, fileBuffer, {
        contentType: "audio/webm",
        cacheControl: "3600",
        upsert: true,
      });

    if (error) throw error;

    const { data: urlData } = await client.storage
      .from(bucket)
      .createSignedUrl(fileName, 3600);

    console.log(`✅ Uploaded: ${fileName}`);

    return urlData.signedUrl;
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
