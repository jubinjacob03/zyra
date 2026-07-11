require("dotenv").config();
process.env.UV_THREADPOOL_SIZE = "16";

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

console.log(
  colorize(COLORS.bold, "🚀 Starting Zyra Bot (Unified Process Mode)"),
);

const instances = Array.isArray(config.instances) ? config.instances : [];

console.log(
  colorize(COLORS.cyan, `Launching Main Bot + ${instances.length} instance(s)`),
);

(async () => {
  try {
    console.log(colorize(COLORS.dim, "Starting main bot..."));
    await startMainBot();

    for (let i = 0; i < instances.length; i++) {
      console.log(colorize(COLORS.dim, `Starting instance ${i + 1}...`));
      await startInstances({ index: i });
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(
      colorize(
        COLORS.bold,
        "✅ All bots successfully started in single process!",
      ),
    );
  } catch (error) {
    console.error("❌ Fatal error during startup:", error);
    process.exit(1);
  }
})();

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  const { client } = require("./bot");
  try { client.destroy(); } catch {}

  console.log(`${signal} received — shutting down. Goodbye.`);
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
