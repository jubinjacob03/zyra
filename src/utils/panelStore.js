const fs = require("fs");
const path = require("path");

const cacheDir = path.join(__dirname, "..", "..", "cache");
const cacheFile = path.join(cacheDir, "panels.json");

/**
 * Normalizes the panel store object.
 * @param {Object} store - The raw store object.
 * @returns {Object} The normalized store object.
 */
const normalizeStore = (store) => ({
  play: store?.play || {},
  controller: store?.controller || {},
});

/**
 * Reads the panel store from the cache file.
 * @returns {Object} The parsed and normalized store object.
 */
const readStore = () => {
  try {
    const raw = fs.readFileSync(cacheFile, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return normalizeStore(null);
  }
};

/**
 * Writes the panel store to the cache file.
 * @param {Object} store - The store object to write.
 */
const writeStore = (store) => {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(normalizeStore(store), null, 2));
};

/**
 * Gets the play panel message ID for a given channel.
 * @param {string} channelId - The ID of the channel.
 * @returns {string|null} The message ID, or null if not found.
 */
const getPlayPanel = (channelId) => {
  if (!channelId) return null;
  const store = readStore();
  return store.play[channelId] || null;
};

/**
 * Sets or removes the play panel message ID for a given channel.
 * @param {string} channelId - The ID of the channel.
 * @param {string|null} messageId - The message ID to set, or null to remove.
 */
const setPlayPanel = (channelId, messageId) => {
  if (!channelId) return;
  const store = readStore();
  if (messageId) {
    store.play[channelId] = messageId;
  } else {
    delete store.play[channelId];
  }
  writeStore(store);
};

/**
 * Gets the controller panel message ID for a given channel.
 * @param {string} channelId - The ID of the channel.
 * @returns {string|null} The message ID, or null if not found.
 */
const getControllerPanel = (channelId) => {
  if (!channelId) return null;
  const store = readStore();
  const value = store.controller[channelId];
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.messageId || null;
};

/**
 * Sets or removes the controller panel message ID for a given channel.
 * @param {string} channelId - The ID of the channel.
 * @param {string|null} messageId - The message ID to set, or null to remove.
 */
const setControllerPanel = (channelId, messageId) => {
  if (!channelId) return;
  const store = readStore();
  if (messageId) {
    store.controller[channelId] = messageId;
  } else {
    delete store.controller[channelId];
  }
  writeStore(store);
};

module.exports = {
  getPlayPanel,
  setPlayPanel,
  getControllerPanel,
  setControllerPanel,
};
