const fs = require("fs");
const path = require("path");
const os = require("os");
const youtubedlExec = require("youtube-dl-exec");

let youtubedl;

if (os.platform() === "win32") {
  const systemYtdlp = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages",
    "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "yt-dlp.exe",
  );
  if (fs.existsSync(systemYtdlp)) {
    youtubedl = youtubedlExec.create(systemYtdlp);
    console.log("Using system yt-dlp (Windows)");
  } else {
    youtubedl = youtubedlExec;
    console.log("Using bundled yt-dlp");
  }
} else {
  const systemYtdlp = "/root/.nix-profile/bin/yt-dlp";
  if (fs.existsSync(systemYtdlp)) {
    youtubedl = youtubedlExec.create(systemYtdlp);
    console.log("Using system yt-dlp (Nix)");
  } else {
    youtubedl = youtubedlExec;
    console.log("Using bundled yt-dlp (Linux/Mac)");
  }
}

const ffmpegPath = require("ffmpeg-static");
process.env.FFMPEG_PATH = ffmpegPath;

module.exports = {
  youtubedl,
  ffmpegPath,
};
