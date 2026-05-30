const util = require("util");

/**
 * Scoped, redaction-aware logging facade.
 *
 * This layers on top of {@link module:utils/runtimeLogger}, which intercepts the
 * global `console` methods to add levels, timestamps, and file output. This module
 * adds two things the raw console lacks: a per-module scope tag and automatic
 * redaction of secret-shaped values so tokens never reach stdout or the log files.
 *
 * @module utils/logger
 */

const REDACTION_PATTERNS = [
  /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/g,
  /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
];

/**
 * Replaces secret-shaped substrings in a single argument with a redaction marker.
 * Strings are scanned directly; other values are formatted first so tokens embedded
 * in error messages or objects are also caught.
 *
 * @param {unknown} arg - A single console argument.
 * @returns {unknown} The argument with any secret-shaped content redacted.
 */
const redact = (arg) => {
  if (typeof arg === "string") {
    return REDACTION_PATTERNS.reduce(
      (acc, pattern) => acc.replace(pattern, "[REDACTED]"),
      arg,
    );
  }
  if (arg instanceof Error) {
    return arg;
  }
  if (arg && typeof arg === "object") {
    const formatted = util.format(arg);
    const cleaned = REDACTION_PATTERNS.reduce(
      (acc, pattern) => acc.replace(pattern, "[REDACTED]"),
      formatted,
    );
    return cleaned === formatted ? arg : cleaned;
  }
  return arg;
};

/**
 * Creates a logger bound to a module scope. The returned methods forward to the
 * corresponding `console` level (already enhanced by the runtime logger) with the
 * scope tag prepended and secret-shaped content redacted.
 *
 * @param {string} scope - Short module identifier, e.g. "DiscordPlayer".
 * @returns {{debug: Function, info: Function, warn: Function, error: Function}} A scoped logger.
 */
const createLogger = (scope) => {
  const tag = `[${scope}]`;
  const emit = (method, args) => method(tag, ...args.map(redact));
  return {
    debug: (...args) => emit(console.debug, args),
    info: (...args) => emit(console.log, args),
    warn: (...args) => emit(console.warn, args),
    error: (...args) => emit(console.error, args),
  };
};

module.exports = { createLogger };
