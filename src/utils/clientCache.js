const { Options } = require("discord.js");

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
