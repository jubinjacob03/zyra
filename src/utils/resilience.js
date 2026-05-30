const { createLogger } = require("./logger");

/**
 * Resilience primitives shared across the bot: retry-with-backoff, safe interaction
 * acknowledgement, intentional promise suppression, and a size/TTL-bounded map.
 *
 * @module utils/resilience
 */

const log = createLogger("resilience");

/**
 * Discord REST error codes that represent an interaction or message that can no
 * longer be acted upon. These are expected during normal operation (a user dismissed
 * a message, an interaction token expired) and must not be treated as bugs.
 *
 * - 10003: Unknown channel
 * - 10008: Unknown message
 * - 10062: Unknown interaction (token expired before acknowledgement)
 * - 40060: Interaction has already been acknowledged
 *
 * @type {ReadonlySet<number>}
 */
const IGNORABLE_DISCORD_CODES = new Set([10003, 10008, 10062, 40060]);

/**
 * Determines whether an error is an expected, non-actionable Discord API error.
 *
 * @param {unknown} error - The thrown value to inspect.
 * @returns {boolean} True if the error is a known ignorable Discord code.
 */
const isIgnorableDiscordError = (error) =>
  Boolean(error) &&
  typeof error === "object" &&
  IGNORABLE_DISCORD_CODES.has(/** @type {{code?: number}} */ (error).code);

/**
 * Pauses execution for the given duration.
 *
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Invokes an async function, retrying on failure with exponential backoff.
 *
 * @template T
 * @param {() => Promise<T>} fn - The operation to attempt.
 * @param {Object} [options] - Retry tuning.
 * @param {number} [options.retries=3] - Maximum attempts after the first (so total tries = retries + 1).
 * @param {number} [options.baseDelayMs=200] - Initial backoff delay; doubles each attempt.
 * @param {number} [options.maxDelayMs=5000] - Upper bound on any single backoff delay.
 * @param {(error: unknown, attempt: number) => boolean} [options.shouldRetry] - Predicate; return false to abort early.
 * @param {(error: unknown, attempt: number, delayMs: number) => void} [options.onRetry] - Invoked before each retry.
 * @returns {Promise<T>} The resolved value of `fn`.
 * @throws Re-throws the last error if all attempts fail or `shouldRetry` returns false.
 */
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

/**
 * Awaits a promise, suppressing only expected errors and logging anything unexpected.
 * Use this in place of an empty `catch {}` so genuine failures remain visible.
 *
 * @param {Promise<unknown>} promise - The promise to settle.
 * @param {string} context - Human-readable description of the operation for logs.
 * @returns {Promise<void>}
 */
async function swallow(promise, context) {
  try {
    await promise;
  } catch (error) {
    if (isIgnorableDiscordError(error)) return;
    log.warn(`${context}:`, error?.message || error);
  }
}

/**
 * Acknowledges a Discord interaction exactly once, tolerating the races that occur
 * when the same interaction is handled twice or its token has already expired.
 *
 * @param {import('discord.js').BaseInteraction} interaction - The interaction to acknowledge.
 * @param {Object} [options]
 * @param {"deferUpdate"|"deferReply"} [options.mode="deferUpdate"] - Acknowledgement style.
 * @param {boolean} [options.ephemeral=false] - For "deferReply", whether the reply is ephemeral.
 * @returns {Promise<boolean>} True if this call acknowledged the interaction; false if already acknowledged or expired.
 */
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

/**
 * A Map with a maximum size and optional per-entry TTL. On overflow the least
 * recently used entry is evicted. Reads and writes refresh recency.
 *
 * Intended for pure caches where dropping an entry is harmless (it can be recomputed
 * or refetched). Do NOT use it for collections that own un-managed resources such as
 * live audio players or event listeners — those require explicit lifecycle cleanup.
 *
 * @template K, V
 */
class BoundedMap {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxSize=1000] - Maximum number of retained entries.
   * @param {number} [options.ttlMs=0] - Entry lifetime in ms; 0 disables expiry.
   */
  constructor({ maxSize = 1000, ttlMs = 0 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    /** @type {Map<K, {value: V, expires: number}>} */
    this.store = new Map();
  }

  /**
   * @param {K} key
   * @returns {boolean} True if a live (non-expired) entry exists.
   */
  has(key) {
    return this.get(key) !== undefined;
  }

  /**
   * Retrieves an entry, refreshing its recency. Expired entries are dropped lazily.
   * @param {K} key
   * @returns {V|undefined}
   */
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

  /**
   * Inserts or updates an entry, evicting the least recently used entry on overflow.
   * @param {K} key
   * @param {V} value
   * @returns {this}
   */
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

  /**
   * @param {K} key
   * @returns {boolean} True if an entry was removed.
   */
  delete(key) {
    return this.store.delete(key);
  }

  /** Removes all entries. */
  clear() {
    this.store.clear();
  }

  /** @returns {number} The current number of retained entries (including any not yet swept). */
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
