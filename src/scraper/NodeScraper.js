const fs = require("fs").promises;
const path = require("path");
const { createLogger } = require("../utils/logger");

const log = createLogger("scraper");

const CONFIG_PATH = path.join(__dirname, "../../config.json");
const API_URL = "https://lavalink-list.ajieblogs.eu.org/All";
const MAX_NODES = 20;
const CONCURRENCY_LIMIT = 15;

/**
 * @typedef {Object} RawLavalinkNode
 * @property {string} host
 * @property {number} port
 * @property {string} password
 * @property {boolean} [secure]
 * @property {string} [identifier]
 */

/**
 * Validates the schema of an incoming raw node object.
 *
 * @param {any} node
 * @returns {node is RawLavalinkNode}
 */
function isValidNodeSchema(node) {
  return (
    node !== null &&
    typeof node === "object" &&
    typeof node.host === "string" &&
    typeof node.port === "number" &&
    typeof node.password === "string"
  );
}

/**
 * Performs an HTTP check against the Lavalink node's version endpoint.
 *
 * @param {RawLavalinkNode} node
 * @returns {Promise<boolean>}
 */
async function checkNode(node) {
  const protocol = node.secure ? "https" : "http";
  const url = `${protocol}://${node.host}:${node.port}/version`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, {
      headers: { Authorization: node.password },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Splits an array into smaller arrays of a specified size.
 *
 * @template T
 * @param {T[]} array
 * @param {number} size
 * @returns {T[][]}
 */
function chunkArray(array, size) {
  const chunked = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

/**
 * Safely writes the configuration to disk using an atomic rename operation
 * to prevent file corruption during sudden process terminations.
 *
 * @param {Object} config
 * @returns {Promise<void>}
 */
async function atomicWriteConfig(config) {
  const tmpPath = `${CONFIG_PATH}.tmp`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), "utf-8");
    await fs.rename(tmpPath, CONFIG_PATH);
  } catch (err) {
    log.error(
      `❌ [Scraper] Critical failure during atomic config write: ${err.message}`,
    );
    throw err;
  }
}

/**
 * Executes a full scrape, validation, and hot-swap cycle.
 *
 * @param {import('../utils/watchdog').Watchdog} watchdog
 * @returns {Promise<void>}
 */
async function runScrapeCycle(watchdog) {
  log.info("🔍 [Scraper] Initiating Lavalink node scrape cycle...");

  let rawNodes;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(API_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    rawNodes = await res.json();
  } catch (err) {
    log.error(
      `❌ [Scraper] Failed to fetch node list from community API: ${err.message}`,
    );
    return;
  }

  if (!Array.isArray(rawNodes)) {
    log.error(
      "❌ [Scraper] Community API returned invalid JSON structure.",
    );
    return;
  }

  const validNodes = rawNodes.filter(isValidNodeSchema);

  const uniqueUrls = new Set();
  const deduplicatedNodes = validNodes.filter((node) => {
    const url = `${node.host}:${node.port}`;
    if (uniqueUrls.has(url)) return false;
    uniqueUrls.add(url);
    return true;
  });

  log.info(
    `[Scraper] Validated and deduplicated ${deduplicatedNodes.length} nodes. Testing connectivity...`,
  );

  const aliveNodes = [];
  const chunks = chunkArray(deduplicatedNodes, CONCURRENCY_LIMIT);

  for (const chunk of chunks) {
    const promises = chunk.map(async (n) => {
      if (aliveNodes.length >= MAX_NODES) return;

      const isAlive = await checkNode(n);
      if (isAlive) {
        aliveNodes.push({
          name: n.identifier || n.host,
          url: `${n.host}:${n.port}`,
          auth: n.password,
          secure: Boolean(n.secure),
        });
      }
    });

    await Promise.allSettled(promises);
    if (aliveNodes.length >= MAX_NODES) {
      break;
    }
  }

  const topNodes = aliveNodes.slice(0, MAX_NODES);
  log.info(`✅ [Scraper] Found ${topNodes.length} fully functional nodes.`);

  if (topNodes.length === 0) {
    log.info(
      "⚠️ [Scraper] No alive nodes found during this cycle. Retaining existing configuration.",
    );
    return;
  }

  try {
    const configData = await fs.readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(configData);
    config.lavalinkNodes = topNodes;

    await atomicWriteConfig(config);
    log.info(
      "💾 [Scraper] Successfully executed atomic write to config.json.",
    );
  } catch (err) {
    log.error(`❌ [Scraper] Failed to update config.json: ${err.message}`);
  }

  if (!watchdog || !watchdog.shoukaku || !watchdog.shoukaku.nodes) {
    log.warn(
      "⚠️ [Scraper] Shoukaku instance not fully initialized. Skipping hot-swap.",
    );
    return;
  }

  try {
    const currentNodes = Array.from(watchdog.shoukaku.nodes.keys());
    const newNames = topNodes.map((n) => n.name);

    for (const name of currentNodes) {
      if (!newNames.includes(name)) {
        log.info(`♻️ [Scraper] Hot-removing dead node: ${name}`);
        watchdog.shoukaku.removeNode(name);
      }
    }

    for (const node of topNodes) {
      if (!currentNodes.includes(node.name)) {
        log.info(`➕ [Scraper] Hot-adding fresh node: ${node.name}`);
        watchdog.shoukaku.addNode(node);
      }
    }
  } catch (err) {
    log.error(
      `❌ [Scraper] Failure during dynamic hot-swap: ${err.message}`,
    );
  }
}

/**
 * Initializes and schedules the background scraper.
 *
 * @param {import('../utils/watchdog').Watchdog} watchdog
 */
function initScraper(watchdog) {
  runScrapeCycle(watchdog).catch((err) => {
    log.error(
      `❌ [Scraper] Unhandled rejection in initial scrape: ${err.message}`,
    );
  });

  const INTERVAL_MS = 40 * 60 * 1000;
  setInterval(() => {
    runScrapeCycle(watchdog).catch((err) => {
      log.error(
        `❌ [Scraper] Unhandled rejection in scheduled scrape: ${err.message}`,
      );
    });
  }, INTERVAL_MS);
}

module.exports = {
  initScraper,
};
