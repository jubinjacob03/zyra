const { Shoukaku, Connectors } = require("shoukaku");
const config = require("../../config.json");
const { createLogger } = require("./logger");

const log = createLogger("watchdog");

/** How often node ping/stats metrics are refreshed. */
const METRICS_INTERVAL_MS = 30_000;

/**
 * @typedef {Object} NodeState
 * @property {string} status
 * @property {number} ping
 * @property {Object} stats
 */

class Watchdog {
  /**
   * Initializes the Lavalink watchdog, custom node resolver, and Shoukaku client bindings.
   * Enables persistent node tracking and preferential node routing for active sessions.
   * @param {import('discord.js').Client} client
   */
  constructor(client) {
    this.client = client;
    this.preferredNodes = new Map();
    const preferredNodes = this.preferredNodes;
    const resolveDefaultNode = (nodes) =>
      [...nodes.values()]
        .filter((node) => node.state === 1)
        .sort((a, b) => a.penalties - b.penalties)
        .shift();

    const nodeResolver = (nodes, connection) => {
      const preferredName = connection?.guildId
        ? preferredNodes.get(connection.guildId)
        : null;
      if (preferredName) {
        const preferred = nodes.get(preferredName);
        if (preferred && preferred.state === 1) return preferred;
      }
      return resolveDefaultNode(nodes);
    };

    this.shoukaku = new Shoukaku(
      new Connectors.DiscordJS(client),
      config.lavalinkNodes || [],
      {
        moveOnDisconnect: false,
        resumable: false,
        reconnectTries: 2,
        restTimeout: 10000,
        nodeResolver,
      },
    );

    /** @type {Object.<string, NodeState>} */
    this.nodeStates = {};

    this._initEvents();
  }

  _initEvents() {
    this.shoukaku.on("ready", (name) => {
      this.nodeStates[name] = { status: "ONLINE", ping: 0, stats: {} };
      log.info(`Lavalink node ready: ${name}`);
    });

    this.shoukaku.on("error", (name, error) => {
      this.nodeStates[name] = { status: "ERROR", ping: -1, stats: {} };
      log.error(`Lavalink node error: ${name} | ${error.message}`);
    });

    this.shoukaku.on("close", (name, code) => {
      this.nodeStates[name] = { status: "CLOSED", ping: -1, stats: {} };
      log.warn(`Lavalink node closed: ${name} | Code: ${code}`);
    });

    this.shoukaku.on("disconnect", (name) => {
      this.nodeStates[name] = { status: "DISCONNECTED", ping: -1, stats: {} };
      log.warn(`Lavalink node disconnected: ${name}`);
    });

    this.shoukaku.on("debug", (name, info) => {
      if (info.includes("State Update Received")) {
        log.debug(`Lavalink voice state update: ${info}`);
      }
    });

    this.metricsInterval = setInterval(() => {
      this._updateMetrics();
    }, METRICS_INTERVAL_MS);
    if (typeof this.metricsInterval.unref === "function") {
      this.metricsInterval.unref();
    }
  }

  _updateMetrics() {
    for (const node of this.shoukaku.nodes.values()) {
      this.nodeStates[node.name] = {
        status: node.state === 1 ? "ONLINE" : "OFFLINE",
        ping: node.ping,
        stats: node.stats,
      };
    }
  }

  /**
   * Checks if any node is currently online.
   * @returns {boolean}
   */
  isNodeAvailable() {
    return Array.from(this.shoukaku.nodes.values()).some(
      (node) => node.state === 1,
    );
  }

  setPreferredNode(guildId, nodeName) {
    if (!guildId || !nodeName) return;
    this.preferredNodes.set(guildId, nodeName);
  }

  clearPreferredNode(guildId) {
    if (!guildId) return;
    this.preferredNodes.delete(guildId);
  }

  getPreferredNode(guildId) {
    return guildId ? this.preferredNodes.get(guildId) : null;
  }
}

const instances = new Map();

/**
 * Initializes a Lavalink watchdog for the specified client.
 * @param {import('discord.js').Client} client
 * @returns {Watchdog|null}
 */
function initWatchdog(client) {
  if (!client) return null;
  const key = client.INSTANCE_NAME || client.user?.id || "main";
  if (!instances.has(key)) {
    instances.set(key, new Watchdog(client));
  }
  return instances.get(key);
}

/**
 * Retrieves the Lavalink watchdog for the specified client.
 * @param {import('discord.js').Client} client
 * @returns {Watchdog|null}
 */
function getWatchdog(client) {
  if (!client) {
    return instances.values().next().value || null;
  }
  const key = client.INSTANCE_NAME || client.user?.id || "main";
  return instances.get(key) || instances.values().next().value || null;
}

module.exports = {
  initWatchdog,
  getWatchdog,
};
