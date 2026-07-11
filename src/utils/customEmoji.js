const { createLogger } = require("./logger");
const log = createLogger("emoji");

const EMOJI_MAP = require("./icon-map.json");

const EMOJI_NAMES = {};
const UNICODE = {};

for (const [key, value] of Object.entries(EMOJI_MAP)) {
  EMOJI_NAMES[value.serverEmojiName] = key;
  UNICODE[key] = value.fallback;
}

const resolved = {};

function initEmojis(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const emoji of guild.emojis.cache.values()) {
      const key = EMOJI_NAMES[emoji.name];
      if (key) {
        resolved[key] = {
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated,
          full: `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`,
        };
      }
    }
  }
  const count = Object.keys(resolved).length;
  if (count > 0) log.info(`Loaded ${count} custom emojis`);
}

function e(key) {
  if (resolved[key]) return resolved[key].full;
  return UNICODE[key] || "";
}

function btn(key) {
  if (resolved[key])
    return {
      id: resolved[key].id,
      name: resolved[key].name,
      animated: resolved[key].animated,
    };
  return UNICODE[key] || "❓";
}

module.exports = { initEmojis, e, btn, UNICODE };
