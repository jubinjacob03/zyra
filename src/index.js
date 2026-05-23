/**
 * Process Manager & Entry Point
 * Orchestrates the main bot and multiple instances in a SINGLE process
 * to drastically save RAM.
 */
require("dotenv").config();

const path = require("path");
const fs = require("fs");
const config = require("../config.json");
const { startMainBot } = require("./bot");
const { startInstances } = require("./instances");

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
};

const useColor = Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== "1";
const colorize = (color, text) =>
  useColor ? `${color}${text}${COLORS.reset}` : text;

const LOG_DIR = path.join(__dirname, "..", "logs");
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

console.log(colorize(COLORS.bold, "🚀 Starting Zyra Bot (Unified Process Mode)"));

const instances = Array.isArray(config.instances) ? config.instances : [];

console.log(colorize(COLORS.cyan, `Launching Main Bot + ${instances.length} instance(s)`));

const BOX_COLORS = [COLORS.cyan, COLORS.magenta, COLORS.yellow];
const boxColor = (index) => BOX_COLORS[index % BOX_COLORS.length];

const buildBox = (title, vcName, port, index) => {
  const lines = [`Instance ${title}`, `vc   - ${vcName}`, `port - ${port}`];

  const width = Math.max(...lines.map((line) => line.length));
  const border = `+${"=".repeat(width + 2)}+`;
  const body = lines.map((line) => `| ${line.padEnd(width, " ")} |`);
  return {
    color: boxColor(index),
    width,
    lines: [border, ...body, border],
  };
};

const renderBoxLine = (line, color) => {
  if (!useColor) return line;
  if (line.startsWith("+")) {
    return colorize(color, line);
  }
  const left = colorize(color, "|");
  const right = colorize(color, "|");
  return `${left}${line.slice(1, -1)}${right}`;
};

const renderBoxesRow = (boxes) => {
  const height = Math.max(...boxes.map((box) => box.lines.length));
  for (let i = 0; i < height; i += 1) {
    const row = boxes
      .map((box) => renderBoxLine(box.lines[i] || "", box.color))
      .join("  ");
    console.log(row);
  }
};

const BOXES_PER_ROW = 3;
const boxes = instances.map((instance, i) => {
  const name = instance?.name || `instance-${i + 1}`;
  const port = instance?.apiPort ?? "-";
  return buildBox(i + 1, name, port, i);
});

for (let i = 0; i < boxes.length; i += BOXES_PER_ROW) {
  renderBoxesRow(boxes.slice(i, i + BOXES_PER_ROW));
}

(async () => {
  try {
    console.log(colorize(COLORS.dim, "Starting main bot..."));
    await startMainBot();

    for (let i = 0; i < instances.length; i++) {
      console.log(colorize(COLORS.dim, `Starting instance ${i + 1}...`));
      await startInstances({ index: i });
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log(colorize(COLORS.bold, "✅ All bots successfully started in single process!"));
  } catch (error) {
    console.error("❌ Fatal error during startup:", error);
    process.exit(1);
  }
})();
