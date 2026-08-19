const { createLogger } = require("./logger");
const log = createLogger("emoji");

const EMOJI_MAP = require("./icon-map.json");

const EMOJI_NAMES = {};
const UNICODE = {};
const resolved = {};

for (const [key, value] of Object.entries(EMOJI_MAP)) {
  EMOJI_NAMES[value.serverEmojiName] = key;
  UNICODE[key] = value.fallback;
  if (value.id) {
    const a = value.animated ? "a" : "";
    resolved[key] = {
      id: value.id,
      name: value.serverEmojiName,
      animated: value.animated || false,
      full: `<${a}:${value.serverEmojiName}:${value.id}>`,
    };
  }
}

log.info(`Pre-loaded ${Object.keys(resolved).length} emojis from icon-map IDs`);

async function initEmojis(client) {
  try {
    const appEmojis = await client.application.emojis.fetch();
    let updated = 0;
    for (const emoji of appEmojis.values()) {
      const key = EMOJI_NAMES[emoji.name];
      if (key) {
        resolved[key] = {
          id: emoji.id,
          name: emoji.name,
          animated: emoji.animated,
          full: `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`,
        };
        updated++;
      }
    }
    log.info(`Refreshed ${updated} emojis from app (${appEmojis.size} total)`);
  } catch (err) {
    log.warn(`App emoji fetch failed, using hardcoded IDs: ${err.message}`);
  }

  const count = Object.keys(resolved).length;
  log.info(`${count} emojis ready`);
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
