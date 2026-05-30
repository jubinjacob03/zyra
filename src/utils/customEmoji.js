const { createLogger } = require("./logger");
const log = createLogger("emoji");

const path = require("path");
const fs = require("fs");

const EMOJI_MAP = require("./icon-map.json");

const EMOJI_NAMES = {};
const UNICODE = {};

for (const [key, value] of Object.entries(EMOJI_MAP)) {
  EMOJI_NAMES[value.serverEmojiName] = key;
  UNICODE[key] = value.fallback;
}

const resolved = {};

/**
 * Initializes custom emojis by scanning the client's guilds.
 * @param {import('discord.js').Client} client - The Discord client.
 */
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
  if (count > 0) log.info(`✅ Loaded ${count} custom emojis`);
}

/**
 * Gets the full string representation of an emoji (custom or unicode fallback).
 * @param {string} key - The emoji key.
 * @returns {string} The emoji string.
 */
function e(key) {
  if (resolved[key]) return resolved[key].full;
  return UNICODE[key] || "";
}

/**
 * Gets the button-compatible object representation of an emoji.
 * @param {string} key - The emoji key.
 * @returns {Object|string} The emoji object or unicode string.
 */
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
