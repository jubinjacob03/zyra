const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
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
 * Download audio from YouTube - Hybrid approach (Lavalink → yt-dlp fallback)
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

  let streamUrl = null;
  let downloadMethod = null;

  try {
    const videoIdMatch = youtubeUrl.match(/(?:v=|\/)([\w-]{11})/);
    if (videoIdMatch) {
      const videoId = videoIdMatch[1];

      let lavalinkHost = process.env.LAVALINK_URL || "localhost:2333";
      if (!lavalinkHost.startsWith("http")) {
        lavalinkHost = `http://${lavalinkHost}`;
      }
      const lavalinkPassword =
        process.env.LAVALINK_PASSWORD || "remani-lavalink";
      const lavalinkUrl = `${lavalinkHost}/youtube/stream/${videoId}?withClient=ANDROID_VR`;

      console.log(
        `🎵 Attempting Lavalink download (OAuth2/PoToken authenticated)...`,
      );

      const lavalinkSuccess = await new Promise((resolve) => {
        const file = fs.createWriteStream(webmPath);
        const protocol = lavalinkHost.startsWith("https") ? https : http;

        let parsedUrl;
        try {
          parsedUrl = new URL(lavalinkUrl);
        } catch (e) {
          console.log(`⚠️ Lavalink URL parsing failed: ${e.message}`);
          resolve(false);
          return;
        }

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (protocol === https ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: "GET",
          headers: { Authorization: lavalinkPassword },
          timeout: 10000,
        };

        const request = protocol.request(options, (response) => {
          if (response.statusCode !== 200) {
            console.log(
              `⚠️ Lavalink returned ${response.statusCode}: ${response.statusMessage}`,
            );
            file.close();
            fs.unlink(webmPath, () => {});
            resolve(false);
            return;
          }

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            console.log(`✅ Lavalink download successful!`);
            resolve(true);
          });

          file.on("error", (err) => {
            console.log(`⚠️ Lavalink file write error: ${err.message}`);
            fs.unlink(webmPath, () => {});
            resolve(false);
          });
        });

        request.on("error", (err) => {
          console.log(`⚠️ Lavalink request failed: ${err.message}`);
          file.close();
          fs.unlink(webmPath, () => {});
          resolve(false);
        });

        request.on("timeout", () => {
          console.log(`⚠️ Lavalink timeout`);
          request.destroy();
          file.close();
          fs.unlink(webmPath, () => {});
          resolve(false);
        });

        request.end();
      });

      if (lavalinkSuccess) {
        downloadMethod = "Lavalink (OAuth2)";
      } else {
        console.log(`📋 Falling back to yt-dlp...`);
      }
    }
  } catch (error) {
    console.log(`⚠️ Lavalink attempt error: ${error.message}`);
  }

  if (!downloadMethod) {
    try {
      console.log(`🔍 Attempting yt-dlp download with multiple strategies...`);

      const ytdlpCommands = [
        `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url --no-playlist --extractor-args "youtube:player_client=android" --user-agent "com.google.android.youtube/17.36.4 (Linux; U; Android 12; GB) gzip" "${youtubeUrl}"`,
        `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url --no-playlist --extractor-args "youtube:player_client=android_testsuite" "${youtubeUrl}"`,
        `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url --no-playlist --extractor-args "youtube:player_client=ios" "${youtubeUrl}"`,
        `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url --no-playlist --extractor-args "youtube:player_client=tv_embedded" "${youtubeUrl}"`,
        `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url --no-playlist --extractor-args "youtube:player_client=web_embedded" "${youtubeUrl}"`,
        `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --get-url --no-playlist --js-runtimes node --no-check-certificate "${youtubeUrl}"`,
        null,
      ].filter(Boolean);

      let lastError = null;

      for (let i = 0; i < ytdlpCommands.length; i++) {
        try {
          console.log(`🔄 yt-dlp attempt ${i + 1}/${ytdlpCommands.length}...`);

          const result = execSync(ytdlpCommands[i], {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          streamUrl = result.trim();

          if (streamUrl && streamUrl.startsWith("http")) {
            console.log(
              `✅ Stream URL extracted via yt-dlp (attempt ${i + 1})`,
            );
            downloadMethod = `yt-dlp (method ${i + 1})`;
            break;
          }
        } catch (err) {
          lastError = err;
          const errorOutput = err.stderr?.toString() || err.message;
          console.log(`⚠️ Attempt ${i + 1} failed:`);
          console.log(errorOutput.split("\n").slice(0, 3).join("\n"));
        }
      }

      if (!streamUrl || !streamUrl.startsWith("http")) {
        console.log(`🎯 Attempting direct download with yt-dlp...`);

        const directDownloadCmd = `yt-dlp -f "bestaudio[ext=webm]/bestaudio/best" --no-playlist --extractor-args "youtube:player_client=android_testsuite" --user-agent "com.google.android.youtube/17.36.4 (Linux; U; Android 12; GB) gzip" -o "${webmPath}" "${youtubeUrl}"`;

        execSync(directDownloadCmd, { stdio: "inherit" });

        if (fs.existsSync(webmPath) && fs.statSync(webmPath).size > 0) {
          downloadMethod = "yt-dlp (direct)";
          console.log(`✅ Direct download successful`);
        } else {
          throw new Error(
            `All yt-dlp methods failed. Last error: ${lastError?.message || "Unknown"}`,
          );
        }
      } else {
        console.log(`⬇️ Downloading stream...`);

        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(webmPath);
          const protocol = streamUrl.startsWith("https") ? https : http;

          const request = protocol.get(streamUrl, (response) => {
            if (response.statusCode !== 200) {
              reject(
                new Error(
                  `Download failed: ${response.statusCode} ${response.statusMessage}`,
                ),
              );
              return;
            }

            response.pipe(file);
            file.on("finish", () => {
              file.close();
              resolve();
            });
          });

          request.on("error", (err) => {
            fs.unlink(webmPath, () => {});
            reject(err);
          });

          file.on("error", (err) => {
            fs.unlink(webmPath, () => {});
            reject(err);
          });

          request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error("Download timeout"));
          });
        });

        downloadMethod = "yt-dlp";
      }
    } catch (ytdlpError) {
      throw new Error(
        `Both methods failed. Lavalink: Spring incompatibility, yt-dlp: ${ytdlpError.message}`,
      );
    }
  }

  try {
    const stats = fs.statSync(webmPath);
    console.log(
      `✅ Downloaded: ${(stats.size / 1024 / 1024).toFixed(2)} MB (via ${downloadMethod})`,
    );

    console.log(`🔄 Converting to OGG/Opus format...`);

    let conversionSuccess = false;
    let lastError = null;

    const conversionAttempts = [
      `ffmpeg -i "${webmPath}" -c:a libopus -b:a 128k -vbr on -compression_level 10 "${oggPath}" -y`,
      `ffmpeg -i "${webmPath}" -c:a libopus -b:a 128k "${oggPath}" -y`,
      `ffmpeg -i "${webmPath}" -c:a copy "${oggPath}" -y`,
      `ffmpeg -i "${webmPath}" -acodec libopus -ar 48000 "${oggPath}" -y`,
    ];

    for (let i = 0; i < conversionAttempts.length; i++) {
      try {
        console.log(
          `🔄 Conversion attempt ${i + 1}/${conversionAttempts.length}...`,
        );
        execSync(conversionAttempts[i], { stdio: "pipe" });

        if (fs.existsSync(oggPath)) {
          const oggStats = fs.statSync(oggPath);
          if (oggStats.size > 0) {
            console.log(
              `✅ Converted: ${(oggStats.size / 1024 / 1024).toFixed(2)} MB`,
            );
            conversionSuccess = true;
            break;
          }
        }
      } catch (err) {
        lastError = err;
        console.log(`⚠️ Attempt ${i + 1} failed: ${err.message}`);
        if (fs.existsSync(oggPath)) {
          fs.unlinkSync(oggPath);
        }
      }
    }

    try {
      if (fs.existsSync(webmPath)) {
        fs.unlinkSync(webmPath);
        console.log(`🗑️ Cleaned up WebM file`);
      }
    } catch (cleanupError) {
      console.error(`⚠️ Could not delete WebM: ${cleanupError.message}`);
    }

    if (!conversionSuccess) {
      if (fs.existsSync(oggPath)) {
        fs.unlinkSync(oggPath);
      }
      throw new Error(
        `Conversion failed after all attempts: ${lastError?.message || "Unknown error"}`,
      );
    }

    return oggPath;
  } catch (error) {
    try {
      if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath);
      if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
    } catch (cleanupError) {}

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
    const fileName = `songs/${fileId}.ogg`;

    const { error } = await client.storage
      .from(bucket)
      .upload(fileName, fileBuffer, {
        contentType: "audio/ogg",
        cacheControl: "3600",
        upsert: true,
      });

    if (error) throw error;

    console.log(`✅ Uploaded: ${fileName}`);

    return `http://localhost:8000/stream/${fileId}.ogg?bucket=${bucket}`;
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
    await client.storage
      .from(bucket)
      .remove([`songs/${fileId}.ogg`, `songs/${fileId}.webm`]);
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
      return ageMs > 3600000;
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
