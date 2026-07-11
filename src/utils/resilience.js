const { createLogger } = require("./logger");

const log = createLogger("resilience");

const IGNORABLE_DISCORD_CODES = new Set([10003, 10008, 10062, 40060]);

const isIgnorableDiscordError = (error) =>
  Boolean(error) &&
  typeof error === "object" &&
  IGNORABLE_DISCORD_CODES.has(error.code);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 200,
    maxDelayMs = 5000,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error, attempt)) break;
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      if (onRetry) onRetry(error, attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function swallow(promise, context) {
  try {
    await promise;
  } catch (error) {
    if (isIgnorableDiscordError(error)) return;
    log.warn(`${context}:`, error?.message || error);
  }
}

async function safeAck(interaction, options = {}) {
  const { mode = "deferUpdate", ephemeral = false } = options;
  if (interaction.deferred || interaction.replied) return false;
  try {
    if (mode === "deferReply") {
      await interaction.deferReply(ephemeral ? { flags: 64 } : {});
    } else {
      await interaction.deferUpdate();
    }
    return true;
  } catch (error) {
    if (isIgnorableDiscordError(error)) return false;
    throw error;
  }
}

class BoundedMap {
  constructor({ maxSize = 1000, ttlMs = 0 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.store = new Map();
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires && entry.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, {
      value,
      expires: this.ttlMs ? Date.now() + this.ttlMs : 0,
    });
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
    }
    return this;
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

module.exports = {
  IGNORABLE_DISCORD_CODES,
  isIgnorableDiscordError,
  withRetry,
  swallow,
  safeAck,
  BoundedMap,
  sleep,
};
