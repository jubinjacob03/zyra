const fs = require("fs");
const path = require("path");
const util = require("util");

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Parses a log level string into its numeric value.
 * @param {string} value - The log level string (e.g., "info", "debug").
 * @returns {number} The numeric log level.
 */
const parseLevel = (value) => {
  const key = String(value || "info").toLowerCase();
  return LEVELS[key] ?? LEVELS.info;
};

/**
 * Pads a string to a specific size.
 * @param {string|number} value - The value to pad.
 * @param {number} size - The target size.
 * @returns {string} The padded string.
 */
const pad = (value, size) => String(value).padEnd(size, " ");

/**
 * Gets the current timestamp formatted as a string.
 * @returns {string} The formatted timestamp.
 */
const now = () => new Date().toISOString().replace("T", " ").replace("Z", "");

/**
 * Determines the log file name based on the instance label.
 * @param {string} label - The instance label.
 * @returns {string|null} The log file name, or null if invalid.
 */
const logFileNameForLabel = (label) => {
  if (label === "main") return "instance-main-log.txt";
  const match = /^instance-(\d+)/.exec(label || "");
  if (match) return `instance-${match[1]}-log.txt`;
  return null;
};

/**
 * Initializes the runtime logger, overriding console methods to write to a file.
 * @param {Object} options - Logger options.
 * @param {string} [options.label] - The instance label.
 */
const initRuntimeLogger = ({ label } = {}) => {
  if (global.__runtimeLoggerReady) return;
  if (process.env.RUNTIME_LOGGER_DISABLED === "1") return;
  global.__runtimeLoggerReady = true;

  const resolvedLabel = label || process.env.RUNTIME_LOGGER_LABEL || "main";
  const levelThreshold = parseLevel(process.env.LOG_LEVEL);
  const logDir = process.env.LOG_DIR || path.join(__dirname, "..", "logs");
  const logToFile = process.env.LOG_TO_FILE !== "0";
  const fileName = logFileNameForLabel(resolvedLabel);
  const scope = resolvedLabel;

  let stream = null;
  if (logToFile && fileName) {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const filePath = path.join(logDir, fileName);
    stream = fs.createWriteStream(filePath, { flags: "a" });
  }

  const write = (level, args, original) => {
    if (LEVELS[level] < levelThreshold) return;
    const message = util.format(...args);
    const line = `${now()} ${pad(level.toUpperCase(), 5)} ${scope} ${message}`;
    original(line);
    if (stream) {
      stream.write(line + "\n");
    }
  };

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const originalDebug = console.debug
    ? console.debug.bind(console)
    : originalLog;

  console.log = (...args) => write("info", args, originalLog);
  console.warn = (...args) => write("warn", args, originalWarn);
  console.error = (...args) => write("error", args, originalError);
  console.debug = (...args) => write("debug", args, originalDebug);

  const close = () => {
    if (stream) {
      stream.end();
      stream = null;
    }
  };

  process.on("exit", close);
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
};

module.exports = {
  initRuntimeLogger,
};
