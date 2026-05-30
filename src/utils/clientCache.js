const { Options } = require("discord.js");

/**
 * Cache and sweeper configuration tuned for a low-memory music bot.
 *
 * A music bot does not need long-lived message, presence, or reaction caches, and
 * only needs its own guild member retained (for voice state). Bounding these keeps
 * RAM low on constrained hosts, which matters when several clients share one process
 * on a 1GB VPS. Non-limitable managers keep their required defaults via the spread.
 *
 * @returns {{makeCache: Function, sweepers: object}}
 */
function musicBotCacheConfig() {
  const keepSelf = (item) => item.id === item.client.user?.id;
  return {
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 10,
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      GuildMemberManager: { maxSize: 50, keepOverLimit: keepSelf },
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 300, lifetime: 600 },
    },
  };
}

module.exports = { musicBotCacheConfig };
