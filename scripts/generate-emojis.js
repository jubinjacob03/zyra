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
    ({ createCanvas } = require('@napi-rs/canvas'));
} catch {
    ({ createCanvas } = require('canvas'));
}
const fs = require('fs');
const path = require('path');

const SIZE = 128;
const OUTPUT = path.join(__dirname, '..', 'assets', 'emojis');

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

// ─── Color — matching the r_author/r_playlist red ───────
const RED = '#ff0000';  // pure bright red

// ─── Emoji Definitions ──────────────────────────────────
const EMOJIS = [
    {
        name: 'r_play',
        draw(ctx) {
            ctx.fillStyle = RED;
            ctx.beginPath();
            ctx.moveTo(46, 26);
            ctx.lineTo(46, 102);
            ctx.lineTo(106, 64);
            ctx.closePath();
            ctx.fill();
        }
    },
    {
        name: 'r_pause',
        draw(ctx) {
            ctx.fillStyle = RED;
            rrect(ctx, 30, 26, 24, 76, 6); ctx.fill();
            rrect(ctx, 74, 26, 24, 76, 6); ctx.fill();
        }
    },
    {
        name: 'r_stop',
        draw(ctx) {
            ctx.fillStyle = RED;
            rrect(ctx, 28, 28, 72, 72, 12);
            ctx.fill();
        }
    },
    {
        name: 'r_skip',
        draw(ctx) {
            ctx.fillStyle = RED;
            ctx.beginPath();
            ctx.moveTo(14, 30); ctx.lineTo(14, 98); ctx.lineTo(56, 64);
            ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(52, 30); ctx.lineTo(52, 98); ctx.lineTo(94, 64);
            ctx.closePath(); ctx.fill();
            rrect(ctx, 94, 30, 14, 68, 4); ctx.fill();
        }
    },
    {
        name: 'r_previous',
        draw(ctx) {
            ctx.fillStyle = RED;
            rrect(ctx, 20, 30, 14, 68, 4); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(76, 30); ctx.lineTo(76, 98); ctx.lineTo(34, 64);
            ctx.closePath(); ctx.fill();
            ctx.beginPath();
            ctx.moveTo(114, 30); ctx.lineTo(114, 98); ctx.lineTo(72, 64);
            ctx.closePath(); ctx.fill();
        }
    },
    {
        name: 'r_shuffle',
        draw(ctx) {
            ctx.strokeStyle = RED;
            ctx.lineWidth = 7;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
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
            ctx.moveTo(90, 32); ctx.lineTo(100, 42); ctx.lineTo(90, 52);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(90, 76); ctx.lineTo(100, 86); ctx.lineTo(90, 96);
            ctx.stroke();
        }
    },
    {
        name: 'r_loop',
        draw(ctx) {
            ctx.strokeStyle = RED;
            ctx.lineWidth = 7;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
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
            ctx.closePath(); ctx.fill();
            const bx = 64 + 34 * Math.cos(1.05 * Math.PI);
            const by = 64 + 34 * Math.sin(1.05 * Math.PI);
            ctx.beginPath();
            ctx.moveTo(bx, by + 12);
            ctx.lineTo(bx - 14, by - 3);
            ctx.lineTo(bx + 4, by - 8);
            ctx.closePath(); ctx.fill();
        }
    },
    {
        name: 'r_queue',
        draw(ctx) {
            ctx.strokeStyle = RED;
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            [38, 64, 90].forEach(y => {
                ctx.beginPath();
                ctx.moveTo(28, y);
                ctx.lineTo(100, y);
                ctx.stroke();
            });
        }
    },
    {
        name: 'r_volup',
        draw(ctx) {
            ctx.fillStyle = RED;
            ctx.strokeStyle = RED;
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(16, 50); ctx.lineTo(36, 50); ctx.lineTo(56, 28);
            ctx.lineTo(56, 100); ctx.lineTo(36, 78); ctx.lineTo(16, 78);
            ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.arc(58, 64, 18, -Math.PI * 0.4, Math.PI * 0.4); ctx.stroke();
            ctx.beginPath(); ctx.arc(58, 64, 32, -Math.PI * 0.4, Math.PI * 0.4); ctx.stroke();
            ctx.beginPath(); ctx.arc(58, 64, 46, -Math.PI * 0.35, Math.PI * 0.35); ctx.stroke();
        }
    },
    {
        name: 'r_voldown',
        draw(ctx) {
            ctx.fillStyle = RED;
            ctx.strokeStyle = RED;
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(24, 50); ctx.lineTo(44, 50); ctx.lineTo(64, 28);
            ctx.lineTo(64, 100); ctx.lineTo(44, 78); ctx.lineTo(24, 78);
            ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.arc(66, 64, 22, -Math.PI * 0.4, Math.PI * 0.4); ctx.stroke();
        }
    },
    {
        name: 'r_spotify',
        draw(ctx) {
            // Green circle
            ctx.fillStyle = '#1DB954';
            ctx.beginPath();
            ctx.arc(64, 64, 50, 0, Math.PI * 2);
            ctx.fill();
            // Dark arcs
            ctx.strokeStyle = '#121212';
            ctx.lineWidth = 9;
            ctx.lineCap = 'round';
            ctx.save();
            ctx.translate(64, 64); ctx.rotate(-0.15); ctx.translate(-64, -64);
            ctx.beginPath(); ctx.arc(64, 88, 20, -Math.PI * 0.82, -Math.PI * 0.18); ctx.stroke();
            ctx.beginPath(); ctx.arc(64, 88, 36, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
            ctx.beginPath(); ctx.arc(64, 88, 52, -Math.PI * 0.78, -Math.PI * 0.22); ctx.stroke();
            ctx.restore();
        }
    },
];

// ─── Generator ───────────────────────────────────────────
fs.mkdirSync(OUTPUT, { recursive: true });
console.log('Generating static WebP emojis (red theme)...\n');

let totalBytes = 0;

for (const emoji of EMOJIS) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');

    // Transparent background (canvas default)
    ctx.clearRect(0, 0, SIZE, SIZE);

    emoji.draw(ctx);

    const buf = canvas.toBuffer('image/webp');
    const filePath = path.join(OUTPUT, `${emoji.name}.webp`);
    fs.writeFileSync(filePath, buf);

    const kb = buf.length / 1024;
    totalBytes += buf.length;
    console.log(`  OK ${emoji.name}.webp  (${kb.toFixed(1)} KB)`);
}

console.log(`\nTotal: ${(totalBytes / 1024).toFixed(1)} KB for ${EMOJIS.length} emojis`);
console.log(`Saved to: ${OUTPUT}`);
console.log('\nUpload to Discord: Server Settings > Emoji > Upload Emoji');
