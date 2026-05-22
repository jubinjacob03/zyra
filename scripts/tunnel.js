#!/usr/bin/env node

/**
 * Cloudflare Tunnel Wrapper
 * Runs cloudflared tunnel and captures the public URL
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const URL_FILE = path.join(__dirname, "..", "tunnel-url.txt");
const PORT = process.env.TUNNEL_PORT || 8000;

console.log("🚀 Starting Cloudflare Tunnel...");
console.log(`📍 Forwarding: http://localhost:${PORT}`);
console.log("");

const tunnel = spawn(
  "cloudflared",
  ["tunnel", "--url", `http://localhost:${PORT}`],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let urlFound = false;

tunnel.stdout.on("data", (data) => {
  const output = data.toString();
  process.stdout.write(output);

  const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (urlMatch && !urlFound) {
    const publicUrl = urlMatch[0];
    urlFound = true;

    fs.writeFileSync(URL_FILE, publicUrl, "utf8");

    console.log("");
    console.log(
      "╔═══════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║                     TUNNEL READY                              ║",
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════════╝",
    );
    console.log("");
    console.log(`  🌐 Public URL: ${publicUrl}`);
    console.log("");
    console.log(`  📝 URL saved to: ${URL_FILE}`);
    console.log("");
    console.log("  ℹ️  Update Shantha .env with:");
    console.log(`     REMANI_API_URL=${publicUrl}`);
    console.log("");
    console.log(
      "  ℹ️  Update Railway/Vercel environment variables with this URL",
    );
    console.log("");
    console.log(
      "╔═══════════════════════════════════════════════════════════════╗",
    );
  }
});

tunnel.stderr.on("data", (data) => {
  process.stderr.write(data);
});

tunnel.on("close", (code) => {
  console.log("");
  console.log(`⚠️  Cloudflare Tunnel exited with code ${code}`);
  if (fs.existsSync(URL_FILE)) {
    fs.unlinkSync(URL_FILE);
    console.log("🗑️  Cleaned up tunnel URL file");
  }
  process.exit(code);
});

process.on("SIGINT", () => {
  console.log("");
  console.log("🛑 Stopping Cloudflare Tunnel...");
  tunnel.kill();
});

process.on("SIGTERM", () => {
  console.log("");
  console.log("🛑 Stopping Cloudflare Tunnel...");
  tunnel.kill();
});
