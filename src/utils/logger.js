const util = require("util");

const REDACTION_PATTERNS = [
  /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/g,
  /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
];

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
