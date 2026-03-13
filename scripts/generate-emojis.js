#!/usr/bin/env node
/**
 * Generates static WebP emojis for Remani Discord music bot
 * Red theme — matching r_author / r_playlist style
 *
 * Usage:  node scripts/generate-emojis.js
 * Output: assets/emojis/r_*.webp (128x128 static)
 */

let createCanvas;
try {
  ({ createCanvas } = require("@napi-rs/canvas"));
} catch {
  ({ createCanvas } = require("canvas"));
}
const fs = require("fs");
const path = require("path");

const SIZE = 128;
const OUTPUT = path.join(__dirname, "..", "assets", "emojis");

// ─── Helpers ─────────────────────────────────────────────
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── Colors ──────────────────────────────────────────────
const RED = "#ff0000"; // pure bright red
const YOUTUBE_RED = "#ff0000";
const SPOTIFY_GREEN = "#1DB954";

// ─── Emoji Definitions ──────────────────────────────────
const EMOJIS = [
  // ═══ EXISTING CONTROL EMOJIS ═══
  {
    name: "r_play",
    draw(ctx) {
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.moveTo(46, 26);
      ctx.lineTo(46, 102);
      ctx.lineTo(106, 64);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    name: "r_pause",
    draw(ctx) {
      ctx.fillStyle = RED;
      rrect(ctx, 30, 26, 24, 76, 6);
      ctx.fill();
      rrect(ctx, 74, 26, 24, 76, 6);
      ctx.fill();
    },
  },
  {
    name: "r_stop",
    draw(ctx) {
      ctx.fillStyle = RED;
      rrect(ctx, 28, 28, 72, 72, 12);
      ctx.fill();
    },
  },
  {
    name: "r_skip",
    draw(ctx) {
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.moveTo(14, 30);
      ctx.lineTo(14, 98);
      ctx.lineTo(56, 64);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(52, 30);
      ctx.lineTo(52, 98);
      ctx.lineTo(94, 64);
      ctx.closePath();
      ctx.fill();
      rrect(ctx, 94, 30, 14, 68, 4);
      ctx.fill();
    },
  },
  {
    name: "r_previous",
    draw(ctx) {
      ctx.fillStyle = RED;
      rrect(ctx, 20, 30, 14, 68, 4);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(76, 30);
      ctx.lineTo(76, 98);
      ctx.lineTo(34, 64);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(114, 30);
      ctx.lineTo(114, 98);
      ctx.lineTo(72, 64);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    name: "r_shuffle",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(24, 42);
      ctx.bezierCurveTo(50, 42, 52, 86, 78, 86);
      ctx.lineTo(100, 86);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(24, 86);
      ctx.bezierCurveTo(50, 86, 52, 42, 78, 42);
      ctx.lineTo(100, 42);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(90, 32);
      ctx.lineTo(100, 42);
      ctx.lineTo(90, 52);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(90, 76);
      ctx.lineTo(100, 86);
      ctx.lineTo(90, 96);
      ctx.stroke();
    },
  },
  {
    name: "r_loop",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.arc(64, 64, 34, -Math.PI * 0.75, Math.PI * 0.05);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(64, 64, 34, Math.PI * 0.25, Math.PI * 1.05);
      ctx.stroke();
      ctx.fillStyle = RED;
      const ax = 64 + 34 * Math.cos(0.05 * Math.PI);
      const ay = 64 + 34 * Math.sin(0.05 * Math.PI);
      ctx.beginPath();
      ctx.moveTo(ax, ay - 12);
      ctx.lineTo(ax + 14, ay + 3);
      ctx.lineTo(ax - 4, ay + 8);
      ctx.closePath();
      ctx.fill();
      const bx = 64 + 34 * Math.cos(1.05 * Math.PI);
      const by = 64 + 34 * Math.sin(1.05 * Math.PI);
      ctx.beginPath();
      ctx.moveTo(bx, by + 12);
      ctx.lineTo(bx - 14, by - 3);
      ctx.lineTo(bx + 4, by - 8);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    name: "r_queue",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      [38, 64, 90].forEach((y) => {
        ctx.beginPath();
        ctx.moveTo(28, y);
        ctx.lineTo(100, y);
        ctx.stroke();
      });
    },
  },
  {
    name: "r_volup",
    draw(ctx) {
      ctx.fillStyle = RED;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(16, 50);
      ctx.lineTo(36, 50);
      ctx.lineTo(56, 28);
      ctx.lineTo(56, 100);
      ctx.lineTo(36, 78);
      ctx.lineTo(16, 78);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(58, 64, 18, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(58, 64, 32, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(58, 64, 46, -Math.PI * 0.35, Math.PI * 0.35);
      ctx.stroke();
    },
  },
  {
    name: "r_voldown",
    draw(ctx) {
      ctx.fillStyle = RED;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(24, 50);
      ctx.lineTo(44, 50);
      ctx.lineTo(64, 28);
      ctx.lineTo(64, 100);
      ctx.lineTo(44, 78);
      ctx.lineTo(24, 78);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(66, 64, 22, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.stroke();
    },
  },

  // ═══ NEW - LOOP ONE ═══
  {
    name: "r_loopone",
    draw(ctx) {
      // Same loop arrows as r_loop but with "1" in center
      ctx.strokeStyle = RED;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.arc(64, 64, 30, -Math.PI * 0.75, Math.PI * 0.05);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(64, 64, 30, Math.PI * 0.25, Math.PI * 1.05);
      ctx.stroke();
      ctx.fillStyle = RED;
      const ax = 64 + 30 * Math.cos(0.05 * Math.PI);
      const ay = 64 + 30 * Math.sin(0.05 * Math.PI);
      ctx.beginPath();
      ctx.moveTo(ax, ay - 10);
      ctx.lineTo(ax + 12, ay + 2);
      ctx.lineTo(ax - 3, ay + 6);
      ctx.closePath();
      ctx.fill();
      const bx = 64 + 30 * Math.cos(1.05 * Math.PI);
      const by = 64 + 30 * Math.sin(1.05 * Math.PI);
      ctx.beginPath();
      ctx.moveTo(bx, by + 10);
      ctx.lineTo(bx - 12, by - 2);
      ctx.lineTo(bx + 3, by - 6);
      ctx.closePath();
      ctx.fill();

      // Draw "1" in center
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("1", 64, 64);
    },
  },

  // ═══ NEW - MUSIC SYMBOLS ═══
  {
    name: "r_music",
    draw(ctx) {
      ctx.fillStyle = RED;
      ctx.strokeStyle = RED;
      ctx.lineWidth = 4;

      // Musical note stem
      rrect(ctx, 54, 28, 8, 48, 2);
      ctx.fill();

      // Note head (filled circle at bottom)
      ctx.beginPath();
      ctx.ellipse(50, 76, 12, 10, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Flag curves
      ctx.beginPath();
      ctx.moveTo(62, 28);
      ctx.bezierCurveTo(80, 28, 85, 40, 85, 48);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(62, 38);
      ctx.bezierCurveTo(75, 38, 80, 48, 80, 54);
      ctx.stroke();
    },
  },
  {
    name: "r_headphones",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";

      // Headband arc
      ctx.beginPath();
      ctx.arc(64, 64, 35, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();

      // Left ear cup
      rrect(ctx, 20, 60, 16, 32, 4);
      ctx.fill();

      // Right ear cup
      rrect(ctx, 92, 60, 16, 32, 4);
      ctx.fill();
    },
  },

  // ═══ NEW - STATUS INDICATORS ═══
  {
    name: "r_success",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Checkmark
      ctx.beginPath();
      ctx.moveTo(30, 64);
      ctx.lineTo(52, 86);
      ctx.lineTo(98, 40);
      ctx.stroke();
    },
  },
  {
    name: "r_error",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";

      // X mark
      ctx.beginPath();
      ctx.moveTo(36, 36);
      ctx.lineTo(92, 92);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(92, 36);
      ctx.lineTo(36, 92);
      ctx.stroke();
    },
  },
  {
    name: "r_warning",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Triangle outline
      ctx.beginPath();
      ctx.moveTo(64, 20);
      ctx.lineTo(110, 100);
      ctx.lineTo(18, 100);
      ctx.closePath();
      ctx.stroke();

      // Exclamation mark
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(64, 45);
      ctx.lineTo(64, 70);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(64, 85, 4, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    name: "r_info",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";

      // Circle outline
      ctx.beginPath();
      ctx.arc(64, 64, 40, 0, Math.PI * 2);
      ctx.stroke();

      // i symbol
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(64, 55);
      ctx.lineTo(64, 85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(64, 42, 4, 0, Math.PI * 2);
      ctx.fill();
    },
  },

  // ═══ NEW - UI ELEMENTS ═══
  {
    name: "r_refresh",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";

      // Circular arrow
      ctx.beginPath();
      ctx.arc(64, 64, 35, Math.PI * 0.7, Math.PI * 2.3);
      ctx.stroke();

      // Arrow head
      ctx.beginPath();
      ctx.moveTo(92, 30);
      ctx.lineTo(92, 50);
      ctx.lineTo(72, 40);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    name: "r_user",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 7;

      // Head circle
      ctx.beginPath();
      ctx.arc(64, 48, 20, 0, Math.PI * 2);
      ctx.stroke();

      // Body arc (shoulders)
      ctx.beginPath();
      ctx.arc(64, 95, 30, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    },
  },
  {
    name: "r_time",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";

      // Clock circle
      ctx.beginPath();
      ctx.arc(64, 64, 40, 0, Math.PI * 2);
      ctx.stroke();

      // Hour hand (pointing to 3)
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(84, 64);
      ctx.stroke();

      // Minute hand (pointing to 12)
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(64, 36);
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(64, 64, 4, 0, Math.PI * 2);
      ctx.fill();
    },
  },

  // ═══ PLATFORM ICONS (Existing - included for completeness) ═══
  {
    name: "r_youtube",
    draw(ctx) {
      // Red rectangle with rounded corners
      ctx.fillStyle = YOUTUBE_RED;
      rrect(ctx, 20, 40, 88, 48, 8);
      ctx.fill();

      // White play triangle
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.moveTo(54, 52);
      ctx.lineTo(54, 76);
      ctx.lineTo(78, 64);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    name: "r_spotify",
    draw(ctx) {
      // Green circle
      ctx.fillStyle = SPOTIFY_GREEN;
      ctx.beginPath();
      ctx.arc(64, 64, 50, 0, Math.PI * 2);
      ctx.fill();

      // Dark arcs (Spotify logo)
      ctx.strokeStyle = "#121212";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.save();
      ctx.translate(64, 64);
      ctx.rotate(-0.15);
      ctx.translate(-64, -64);
      ctx.beginPath();
      ctx.arc(64, 88, 20, -Math.PI * 0.82, -Math.PI * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(64, 88, 36, -Math.PI * 0.8, -Math.PI * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(64, 88, 52, -Math.PI * 0.78, -Math.PI * 0.22);
      ctx.stroke();
      ctx.restore();
    },
  },
  {
    name: "r_author",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";

      // Microphone head (rounded rectangle)
      rrect(ctx, 52, 28, 24, 38, 12);
      ctx.stroke();

      // Microphone stem
      ctx.beginPath();
      ctx.moveTo(64, 66);
      ctx.lineTo(64, 88);
      ctx.stroke();

      // Microphone base (U shape)
      ctx.beginPath();
      ctx.arc(64, 74, 20, 0, Math.PI);
      ctx.stroke();

      // Bottom stand
      ctx.beginPath();
      ctx.moveTo(48, 100);
      ctx.lineTo(80, 100);
      ctx.stroke();
    },
  },
  {
    name: "r_playlist",
    draw(ctx) {
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";

      // Three horizontal lines (playlist items)
      [35, 55, 75].forEach((y) => {
        ctx.beginPath();
        ctx.moveTo(28, y);
        ctx.lineTo(80, y);
        ctx.stroke();
      });

      // Play button on the right
      ctx.beginPath();
      ctx.moveTo(88, 47);
      ctx.lineTo(88, 63);
      ctx.lineTo(100, 55);
      ctx.closePath();
      ctx.fill();
    },
  },
];

// ─── Generator ───────────────────────────────────────────
fs.mkdirSync(OUTPUT, { recursive: true });
console.log("🎨 Generating WebP emojis (red theme)...\n");

let totalBytes = 0;
let generated = 0;
let skipped = 0;

for (const emoji of EMOJIS) {
  const filePath = path.join(OUTPUT, `${emoji.name}.webp`);

  // Skip if file already exists (optional - comment out to force regenerate)
  // if (fs.existsSync(filePath)) {
  //     console.log(`  ⏭️  ${emoji.name}.webp (already exists)`);
  //     skipped++;
  //     continue;
  // }

  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");

  // Transparent background (canvas default)
  ctx.clearRect(0, 0, SIZE, SIZE);

  emoji.draw(ctx);

  const buf = canvas.toBuffer("image/webp");
  fs.writeFileSync(filePath, buf);

  const kb = buf.length / 1024;
  totalBytes += buf.length;
  generated++;
  console.log(`  ✅ ${emoji.name}.webp  (${kb.toFixed(1)} KB)`);
}

console.log(`\n📊 Summary:`);
console.log(`   Generated: ${generated} emojis`);
if (skipped > 0) console.log(`   Skipped: ${skipped} emojis (already exist)`);
console.log(`   Total size: ${(totalBytes / 1024).toFixed(1)} KB`);
console.log(`   Output: ${OUTPUT}`);
console.log(`\n📤 Next steps:`);
console.log(
  `   1. Upload emojis to Discord: Server Settings > Emoji > Upload Emoji`,
);
console.log(`   2. Restart bot to load new emojis`);
console.log(
  `   3. Custom emojis will be used automatically with fallback to Unicode`,
);
