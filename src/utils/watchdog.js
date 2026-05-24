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
   * @param {import('discord.js').Client} client 
   */
  constructor(client) {
    this.client = client;
    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), config.lavalinkNodes || [], {
      moveOnDisconnect: false,
      resumable: false,
      reconnectTries: 2,
      restTimeout: 10000
    });
    
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
      console.error(`🐛 Shoukaku Debug [Lavalink]: [Node] -> [Error] : ${name} | ${error.message}`);
    });

    this.shoukaku.on("close", (name, code, reason) => {
      this.nodeStates[name] = { status: "CLOSED", ping: -1, stats: {} };
      console.log(`🐛 Shoukaku Debug [Lavalink]: [Node] -> [Closed] : ${name} | Code: ${code}`);
    });

    this.shoukaku.on("disconnect", (name, players, moved) => {
      this.nodeStates[name] = { status: "DISCONNECTED", ping: -1, stats: {} };
      console.log(`🐛 Shoukaku Debug [Lavalink]: [Node] -> [Disconnected] : ${name}`);
    });

    this.shoukaku.on("debug", (name, info) => {
      if (info.includes("State Update Received")) {
        console.log(`🐛 Shoukaku Debug [Lavalink]: [Voice] <- [Discord] : ${info}`);
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
        stats: node.stats
      };
    }
  }

  /**
   * Checks if any node is currently online.
   * @returns {boolean}
   */
  isNodeAvailable() {
    return Array.from(this.shoukaku.nodes.values()).some(node => node.state === 1);
  }
}

let instance = null;

/**
 * @param {import('discord.js').Client} client 
 * @returns {Watchdog}
 */
function initWatchdog(client) {
  if (!instance) {
    instance = new Watchdog(client);
  }
  return instance;
}

/**
 * @returns {Watchdog}
 */
function getWatchdog() {
  return instance;
}

module.exports = {
  initWatchdog,
  getWatchdog
};
