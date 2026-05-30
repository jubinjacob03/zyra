const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createLogger } = require("./logger");

/**
 * Persists music-panel message IDs per channel. Reads are served from an in-memory
 * cache (the store is loaded once at startup) and writes are debounced and flushed
 * asynchronously, so the interaction hot path never blocks on disk I/O.
 *
 * @module utils/panelStore
 */

const log = createLogger("panelStore");

const cacheDir = path.join(__dirname, "..", "..", "cache");
const cacheFile = path.join(cacheDir, "panels.json");

/** Delay before a mutated store is flushed to disk, coalescing rapid writes. */
const FLUSH_DEBOUNCE_MS = 250;

/**
 * Normalizes the panel store object so both sub-maps always exist.
 * @param {Object|null} store
 * @returns {{play: Object, controller: Object}}
 */
const normalizeStore = (store) => ({
  play: store?.play || {},
  controller: store?.controller || {},
});

/**
 * Loads the store from disk exactly once at module initialization. A single
 * synchronous read at startup is acceptable; per-call I/O is not.
 * @returns {{play: Object, controller: Object}}
 */
const loadInitial = () => {
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(cacheFile, "utf8")));
  } catch {
    return normalizeStore(null);
  }
};

const store = loadInitial();

/** @type {NodeJS.Timeout|null} */
let flushTimer = null;
let flushing = false;

/**
 * Schedules a debounced asynchronous flush of the in-memory store to disk.
 * @returns {void}
 */
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

/**
 * Gets the play panel message ID for a given channel.
 * @param {string} channelId
 * @returns {string|null}
 */
const getPlayPanel = (channelId) => {
  if (!channelId) return null;
  return store.play[channelId] || null;
};

/**
 * Sets or removes the play panel message ID for a given channel.
 * @param {string} channelId
 * @param {string|null} messageId - The message ID to set, or null to remove.
 * @returns {void}
 */
const setPlayPanel = (channelId, messageId) => {
  if (!channelId) return;
  if (messageId) store.play[channelId] = messageId;
  else delete store.play[channelId];
  scheduleFlush();
};

/**
 * Gets the controller panel message ID for a given channel.
 * @param {string} channelId
 * @returns {string|null}
 */
const getControllerPanel = (channelId) => {
  if (!channelId) return null;
  const value = store.controller[channelId];
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.messageId || null;
};

/**
 * Sets or removes the controller panel message ID for a given channel.
 * @param {string} channelId
 * @param {string|null} messageId - The message ID to set, or null to remove.
 * @returns {void}
 */
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
