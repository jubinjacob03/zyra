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
  const nixYtdlp = "/root/.nix-profile/bin/yt-dlp";
  const dockerYtdlp = "/usr/bin/yt-dlp";
  const localYtdlp = "/usr/local/bin/yt-dlp";
  if (fs.existsSync(nixYtdlp)) {
    youtubedl = youtubedlExec.create(nixYtdlp);
    console.log("Using system yt-dlp (Nix)");
  } else if (fs.existsSync(dockerYtdlp)) {
    youtubedl = youtubedlExec.create(dockerYtdlp);
    console.log("Using system yt-dlp (Docker)");
  } else if (fs.existsSync(localYtdlp)) {
    youtubedl = youtubedlExec.create(localYtdlp);
    console.log("Using system yt-dlp (Local)");
  } else {
    try {
      youtubedl = youtubedlExec.create("yt-dlp");
      console.log("Using system yt-dlp from PATH");
    } catch {
      youtubedl = youtubedlExec;
      console.log("Using bundled yt-dlp (Linux/Mac)");
    }
  }
}

const ffmpegPath = require("ffmpeg-static");
process.env.FFMPEG_PATH = ffmpegPath;

module.exports = {
  youtubedl,
  ffmpegPath,
};
