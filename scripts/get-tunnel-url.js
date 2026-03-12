#!/usr/bin/env node

/**
 * Get current tunnel URL
 * Reads the saved tunnel URL from file
 */

const fs = require("fs");
const path = require("path");

const URL_FILE = path.join(__dirname, "..", "tunnel-url.txt");

if (fs.existsSync(URL_FILE)) {
  const url = fs.readFileSync(URL_FILE, "utf8").trim();
  console.log("");
  console.log(
    "╔═══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║              CURRENT CLOUDFLARE TUNNEL URL                    ║",
  );
  console.log(
    "╚═══════════════════════════════════════════════════════════════╝",
  );
  console.log("");
  console.log(`  🌐 ${url}`);
  console.log("");
  console.log("  📋 Copy command:");
  console.log(`     echo "${url}" | pbcopy    # Mac`);
  console.log(`     echo "${url}" | clip       # Windows`);
  console.log("");
  console.log("  ℹ️  Update environment variables:");
  console.log(`     REMANI_API_URL=${url}`);
  console.log("");
  console.log(
    "╚═══════════════════════════════════════════════════════════════╝",
  );
  console.log("");
} else {
  console.error("❌ Tunnel URL file not found!");
  console.error("   Make sure cloudflare-tunnel is running.");
  console.error("");
  console.error("   Check status: pm2 list");
  console.error("   View logs:    pm2 logs cloudflare-tunnel");
  console.error("");
  process.exit(1);
}
