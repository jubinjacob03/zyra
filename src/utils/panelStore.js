const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createLogger } = require("./logger");

const log = createLogger("panelStore");

const cacheDir = path.join(__dirname, "..", "..", "cache");
const cacheFile = path.join(cacheDir, "panels.json");

const FLUSH_DEBOUNCE_MS = 250;

const normalizeStore = (store) => ({
  play: store?.play || {},
  controller: store?.controller || {},
});

const loadInitial = () => {
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(cacheFile, "utf8")));
  } catch {
    return normalizeStore(null);
  }
};

const store = loadInitial();

let flushTimer = null;
let flushing = false;

const scheduleFlush = () => {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (flushing) {
      scheduleFlush();
      return;
    }
    flushing = true;
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.writeFile(cacheFile, JSON.stringify(store, null, 2));
    } catch (error) {
      log.warn("Failed to persist panel store:", error?.message || error);
    } finally {
      flushing = false;
    }
  }, FLUSH_DEBOUNCE_MS);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
};

const getPlayPanel = (channelId) => {
  if (!channelId) return null;
  return store.play[channelId] || null;
};

const setPlayPanel = (channelId, messageId) => {
  if (!channelId) return;
  if (messageId) store.play[channelId] = messageId;
  else delete store.play[channelId];
  scheduleFlush();
};

const getControllerPanel = (channelId) => {
  if (!channelId) return null;
  const value = store.controller[channelId];
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.messageId || null;
};

const setControllerPanel = (channelId, messageId) => {
  if (!channelId) return;
  if (messageId) store.controller[channelId] = messageId;
  else delete store.controller[channelId];
  scheduleFlush();
};

module.exports = {
  getPlayPanel,
  setPlayPanel,
  getControllerPanel,
  setControllerPanel,
};
