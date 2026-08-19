const { createLogger } = require("./logger");
const log = createLogger("emoji");

const EMOJI_MAP = require("./icon-map.json");

const EMOJI_NAMES = {};
const UNICODE = {};

for (const [key, value] of Object.entries(EMOJI_MAP)) {
  EMOJI_NAMES[value.serverEmojiName] = key;
  UNICODE[key] = value.fallback;
}

const clientEmojis = new Map();
let activeClientId = null;

async function initEmojis(client) {
  const map = {};
  try {
    const appEmojis = await client.application.emojis.fetch();
    for (const emoji of appEmojis.values()) {
      const key = EMOJI_NAMES[emoji.name];
      if (key) {
        map[key] = {
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated,
          full: `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`,
        };
      }
    }
    log.info(
      `Loaded ${Object.keys(map).length} emojis for ${client.user?.tag || "bot"}`,
    );
  } catch (err) {
    log.warn(`App emoji fetch failed for ${client.user?.tag}: ${err.message}`);
    for (const [key, value] of Object.entries(EMOJI_MAP)) {
      if (value.id) {
        map[key] = {
          id: value.id,
          name: value.serverEmojiName,
          animated: value.animated || false,
          full: `<${value.animated ? "a" : ""}:${value.serverEmojiName}:${value.id}>`,
        };
      }
    }
  }

  const cid = client.user?.id || client.application?.id || "default";
  clientEmojis.set(cid, map);
  if (!activeClientId) activeClientId = cid;
}

function setActiveClient(client) {
  const cid = client?.user?.id || client?.application?.id;
  if (cid && clientEmojis.has(cid)) activeClientId = cid;
}

function getResolved() {
  return clientEmojis.get(activeClientId) || {};
}

function e(key) {
  const r = getResolved()[key];
  if (r) return r.full;
  return UNICODE[key] || "";
}

function btn(key) {
  const r = getResolved()[key];
  if (r) return { id: r.id, name: r.name, animated: r.animated };
  return UNICODE[key] || "❓";
}

module.exports = { initEmojis, e, btn, setActiveClient, UNICODE };
