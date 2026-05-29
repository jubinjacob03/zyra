const { Shoukaku, Connectors } = require("shoukaku");
const config = require("../../config.json");

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
      console.log(`🐛 Shoukaku Debug [Lavalink]: [Node] -> [Ready] : ${name}`);
    });

    this.shoukaku.on("error", (name, error) => {
      this.nodeStates[name] = { status: "ERROR", ping: -1, stats: {} };
      console.error(
        `🐛 Shoukaku Debug [Lavalink]: [Node] -> [Error] : ${name} | ${error.message}`,
      );
    });

    this.shoukaku.on("close", (name, code, reason) => {
      this.nodeStates[name] = { status: "CLOSED", ping: -1, stats: {} };
      console.log(
        `🐛 Shoukaku Debug [Lavalink]: [Node] -> [Closed] : ${name} | Code: ${code}`,
      );
    });

    this.shoukaku.on("disconnect", (name, players, moved) => {
      this.nodeStates[name] = { status: "DISCONNECTED", ping: -1, stats: {} };
      console.log(
        `🐛 Shoukaku Debug [Lavalink]: [Node] -> [Disconnected] : ${name}`,
      );
    });

    this.shoukaku.on("debug", (name, info) => {
      if (info.includes("State Update Received")) {
        console.log(
          `🐛 Shoukaku Debug [Lavalink]: [Voice] <- [Discord] : ${info}`,
        );
      }
    });

    setInterval(() => {
      this._updateMetrics();
    }, 30000);
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
    // Fallback: return the first available watchdog if no client provided (legacy support)
    return instances.values().next().value || null;
  }
  const key = client.INSTANCE_NAME || client.user?.id || "main";
  return instances.get(key) || instances.values().next().value || null;
}

module.exports = {
  initWatchdog,
  getWatchdog,
};
