const fs = require("fs");
const path = require("path");

const cacheDir = path.join(__dirname, "..", "..", "cache");
const cacheFile = path.join(cacheDir, "panels.json");

const normalizeStore = (store) => ({
  play: store?.play || {},
  controller: store?.controller || {},
});

const readStore = () => {
  try {
    const raw = fs.readFileSync(cacheFile, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return normalizeStore(null);
  }
};

const writeStore = (store) => {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(normalizeStore(store), null, 2));
};

const getPlayPanel = (channelId) => {
  if (!channelId) return null;
  const store = readStore();
  return store.play[channelId] || null;
};

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

const getControllerPanel = (channelId) => {
  if (!channelId) return null;
  const store = readStore();
  const value = store.controller[channelId];
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.messageId || null;
};

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
