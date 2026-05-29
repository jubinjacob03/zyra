const { getWatchdog } = require("./watchdog");
const { resolveSpotifyQuery } = require("./spotify");
const { QueryType } = require("discord-player");
const { createCompleteMusicController } = require("./componentsV2");
const { setControllerPanel } = require("./panelStore");

/**
 * @typedef {Object} LavalinkTrack
 * @property {string} encoded
 * @property {Object} info
 */

/**
 * @typedef {Object} LavalinkQueue
 * @property {import('shoukaku').Player} player
 * @property {LavalinkTrack[]} tracks
 * @property {LavalinkTrack|null} current
 * @property {import('discord.js').TextChannel} textChannel
 * @property {number} loopMode
 * @property {boolean} paused
 * @property {number} volume
 * @property {LavalinkTrack[]} history
 */

/** @type {Map<string, LavalinkQueue>} */
const lavalinkQueues = new Map();
const lavalinkPlayLocks = new Map();

/**
 * Synchronizes Lavalink queue creation across concurrent requests.
 * @param {string} key
 * @param {Function} fn
 * @returns {Promise<any>}
 */
function withLavalinkLock(key, fn) {
  const pending = lavalinkPlayLocks.get(key) || Promise.resolve();
  const next = pending.then(fn, fn);
  lavalinkPlayLocks.set(
    key,
    next.finally(() => {
      if (lavalinkPlayLocks.get(key) === next) {
        lavalinkPlayLocks.delete(key);
      }
    }),
  );
  return next;
}

/**
 * Retrieves all currently connected Lavalink nodes.
 * @param {import('./lavalinkWatchdog').LavalinkWatchdog} watchdog
 * @returns {import('shoukaku').Node[]}
 */
function getOnlineNodes(watchdog) {
  if (!watchdog?.shoukaku?.nodes) return [];
  return Array.from(watchdog.shoukaku.nodes.values()).filter(
    (node) => node.state === 1,
  );
}

/**
 * Generates a unique queue identifier mapping to the current client instance and guild.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {string}
 */
function getQueueKey(client, guildId) {
  return `${client?.user?.id || "unknown"}_${guildId}`;
}

/**
 * Checks if a specific guild has an active Lavalink queue.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {boolean}
 */
function isUsingLavalink(client, guildId) {
  return lavalinkQueues.has(getQueueKey(client, guildId));
}

/**
 * Checks if a specific guild has an active Discord-Player queue.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {boolean}
 */
function isUsingDiscordPlayer(client, guildId) {
  return client.player.nodes.has(guildId);
}

/**
 * Advances the given Lavalink queue to the next track.
 * Handles loop modes and history propagation.
 * @param {LavalinkQueue} queue
 * @returns {Promise<void>}
 */
async function playNextLavalink(queue) {
  if (queue.loopMode === 1 && queue.current) {
    queue.tracks.unshift(queue.current);
  } else if (queue.loopMode === 2 && queue.current) {
    queue.tracks.push(queue.current);
  }

  if (queue.current && queue.loopMode !== 1) {
    queue.history.push(queue.current);
  }

  const nextTrack = queue.tracks.shift();

  if (!nextTrack) {
    queue.current = null;
    return;
  }

  queue.current = nextTrack;
  await queue.player.playTrack({ track: { encoded: nextTrack.encoded } });
}

/**
 * Entrypoint for playing media on a voice channel.
 * Implements concurrency locks, Lavalink fallback strategies, and dual-layer orchestrator delegation.
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {string} query
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {import('discord.js').Client} client
 * @param {string} [fallbackQuery]
 * @returns {Promise<Object>} Playback initialization metadata
 */
async function play(interaction, query, voiceChannel, client, fallbackQuery) {
  const watchdog = getWatchdog(client);
  const finalQuery = await resolveSpotifyQuery(query);
  const discordPlayerQuery = fallbackQuery ? fallbackQuery : finalQuery;
  const queueKey = getQueueKey(client, voiceChannel.guild.id);

  return withLavalinkLock(queueKey, async () => {
    if (
      watchdog &&
      watchdog.isNodeAvailable() &&
      !isUsingDiscordPlayer(client, voiceChannel.guild.id)
    ) {
      try {
        return await handleLavalinkPlay(
          interaction,
          finalQuery,
          voiceChannel,
          client,
          watchdog,
        );
      } catch (e) {
        console.warn(
          `[Lavalink] Failed to play: ${e.message}. Falling back to DiscordPlayer.`,
        );
        if (watchdog.shoukaku.players.has(voiceChannel.guild.id)) {
          client.isFallingBack = true;
          await watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        if (typeof watchdog.clearPreferredNode === "function") {
          watchdog.clearPreferredNode(voiceChannel.guild.id);
        }
        try {
          const result = await handleDiscordPlayerPlay(
            interaction,
            discordPlayerQuery,
            voiceChannel,
            client,
          );
          return result;
        } finally {
          setTimeout(() => {
            client.isFallingBack = false;
          }, 5000);
        }
      }
    } else {
      if (watchdog && watchdog.shoukaku.players.has(voiceChannel.guild.id)) {
        client.isFallingBack = true;
        await watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (watchdog && typeof watchdog.clearPreferredNode === "function") {
        watchdog.clearPreferredNode(voiceChannel.guild.id);
      }
      try {
        const result = await handleDiscordPlayerPlay(
          interaction,
          discordPlayerQuery,
          voiceChannel,
          client,
        );
        return result;
      } finally {
        setTimeout(() => {
          client.isFallingBack = false;
        }, 5000);
      }
    }
  });
}

/**
 * Handles Lavalink media resolution and playback queue management.
 * Implements parallel node resolution and mid-queue fallback recovery patterns.
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {string} query
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {import('discord.js').Client} client
 * @param {import('./lavalinkWatchdog').LavalinkWatchdog} watchdog
 * @returns {Promise<Object>} Playback initialization metadata
 */
async function handleLavalinkPlay(
  interaction,
  query,
  voiceChannel,
  client,
  watchdog,
) {
  const searchStr =
    query.startsWith("http") || query.startsWith("ytsearch:")
      ? query
      : `ytsearch:${query}`;
  const queueKey = getQueueKey(client, voiceChannel.guild.id);

  const resolveOnNode = async (node) => {
    const searchPromise = node.rest.resolve(searchStr);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("REST resolve timeout")), 5000),
    );

    const searchResult = await Promise.race([searchPromise, timeoutPromise]);

    if (!searchResult || !searchResult.data) {
      throw new Error("No results found.");
    }

    let tracksToAdd = [];
    if (searchResult.loadType === "playlist") {
      tracksToAdd = searchResult.data.info.tracks;
    } else if (
      searchResult.loadType === "search" ||
      searchResult.loadType === "track"
    ) {
      tracksToAdd = [
        searchResult.loadType === "search"
          ? searchResult.data[0]
          : searchResult.data,
      ];
    } else {
      throw new Error("No results found.");
    }

    return { node, searchResult, tracksToAdd };
  };

  let queue = lavalinkQueues.get(queueKey);
  const existingPlayer = watchdog.shoukaku.players.get(voiceChannel.guild.id);
  let resolved = null;

  if (queue && queue.player?.node?.state !== 1) {
    lavalinkQueues.delete(queueKey);
    queue = null;
  }

  const preferredNode = queue?.player?.node || existingPlayer?.node;

  if (preferredNode?.state === 1) {
    try {
      resolved = await resolveOnNode(preferredNode);
    } catch (e) {
      console.warn(
        `[Lavalink] Preferred node ${preferredNode.name} failed to resolve: ${e.message}. Trying other nodes...`,
      );
    }
  }

  if (!resolved) {
    const onlineNodes = getOnlineNodes(watchdog);
    if (!onlineNodes.length) throw new Error("No available Lavalink nodes.");

    const attempts = onlineNodes.map((n) =>
      resolveOnNode(n).catch((error) => {
        throw new Error(`${n.name}: ${error.message}`);
      }),
    );

    try {
      resolved = await Promise.any(attempts);
    } catch (error) {
      const errorDetails = error.errors
        ? error.errors.map((e) => e.message).join(" | ")
        : error.message;
      throw new Error(`All nodes failed to resolve. (${errorDetails})`);
    }
  }

  const { node, searchResult, tracksToAdd } = resolved;

  tracksToAdd.forEach((t) => (t.requestedBy = interaction.user));

  if (!queue) {
    let player =
      existingPlayer && existingPlayer.node?.name === node.name
        ? existingPlayer
        : null;
    if (!player) {
      if (watchdog.shoukaku.connections.has(voiceChannel.guild.id)) {
        try {
          await watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id);
        } catch (e) {}
      }
      if (typeof watchdog.setPreferredNode === "function") {
        watchdog.setPreferredNode(voiceChannel.guild.id, node.name);
      }
      player = await watchdog.shoukaku.joinVoiceChannel({
        guildId: voiceChannel.guild.id,
        channelId: voiceChannel.id,
        shardId: voiceChannel.guild.shardId,
        deaf: true,
      });
    }

    queue = {
      player,
      voiceChannelId: voiceChannel.id,
      tracks: [],
      current: null,
      textChannel: interaction.channel,
      loopMode: 0,
      paused: false,
      volume: 100,
      history: [],
    };

    lavalinkQueues.set(queueKey, queue);

    const attachPlayerListeners = (p, q) => {
      p.on("end", async (reason) => {
        if (reason.reason === "REPLACED") return;
        await playNextLavalink(q);
        if (!q.current) {
          lavalinkQueues.delete(queueKey);
          client.musicPanels.delete(voiceChannel.guild.id);
          if (typeof client.updateVoiceStatus === "function") {
            await client.updateVoiceStatus(
              voiceChannel.id,
              "🎵 /play to start",
            );
          } else {
            try {
              await client.rest.put(
                `/channels/${voiceChannel.id}/voice-status`,
                {
                  body: { status: "🎵 /play to start" },
                },
              );
            } catch (e) {}
          }
          if (typeof client.updateMusicPresence === "function") {
            client.updateMusicPresence(null);
          }
          if (typeof watchdog.clearPreferredNode === "function") {
            watchdog.clearPreferredNode(voiceChannel.guild.id);
          }
          await watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id);
        } else {
          await updateLavalinkPanel(voiceChannel.guild.id, client);
        }
      });

      p.on("closed", async () => {
        if (q.tracks.length > 0) {
          const onlineNodes = getOnlineNodes(watchdog);
          if (onlineNodes.length > 0) {
            try {
              q.current = null;
              const newNode = onlineNodes[0];
              if (typeof watchdog.setPreferredNode === "function") {
                watchdog.setPreferredNode(voiceChannel.guild.id, newNode.name);
              }
              const newPlayer = await watchdog.shoukaku.joinVoiceChannel({
                guildId: voiceChannel.guild.id,
                channelId: voiceChannel.id,
                shardId: voiceChannel.guild.shardId,
                deaf: true,
              });
              q.player = newPlayer;
              attachPlayerListeners(newPlayer, q);
              await playNextLavalink(q);
              await updateLavalinkPanel(voiceChannel.guild.id, client);
              return;
            } catch (e) {
              console.error("Failed to recover node mid-queue", e);
            }
          }
        }

        lavalinkQueues.delete(queueKey);
        client.musicPanels.delete(voiceChannel.guild.id);
        if (typeof client.updateVoiceStatus === "function") {
          await client.updateVoiceStatus(voiceChannel.id, "🎵 /play to start");
        } else {
          try {
            await client.rest.put(`/channels/${voiceChannel.id}/voice-status`, {
              body: { status: "🎵 /play to start" },
            });
          } catch (e) {}
        }
        if (typeof client.updateMusicPresence === "function") {
          client.updateMusicPresence(null);
        }
        if (typeof watchdog.clearPreferredNode === "function") {
          watchdog.clearPreferredNode(voiceChannel.guild.id);
        }
      });
    };

    attachPlayerListeners(player, queue);
  }

  queue.tracks.push(...tracksToAdd);

  if (!queue.current) {
    await playNextLavalink(queue);
    await updateLavalinkPanel(voiceChannel.guild.id, client);
  } else {
    await updateLavalinkPanel(voiceChannel.guild.id, client);
  }

  return {
    isPlaylist: searchResult.loadType === "playlist",
    count: tracksToAdd.length,
    track: { title: tracksToAdd[0].info.title },
  };
}

/**
 * Handles Discord-Player fallback playback logic.
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {string} query
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {import('discord.js').Client} client
 * @returns {Promise<Object>} Playback initialization metadata
 */
async function handleDiscordPlayerPlay(
  interaction,
  query,
  voiceChannel,
  client,
) {
  const searchEngine = query.startsWith("http")
    ? QueryType.AUTO
    : QueryType.SOUNDCLOUD_SEARCH;
  const result = await client.player.search(query, {
    requestedBy: interaction.user,
    searchEngine: searchEngine,
  });

  if (!result || result.isEmpty()) {
    throw new Error("No results found.");
  }

  const { track } = await client.player.play(voiceChannel, result, {
    nodeOptions: {
      metadata: {
        channel: interaction.channel,
      },
      leaveOnEmpty: true,
      leaveOnEmptyCooldown: 300000,
      leaveOnEnd: false,
      leaveOnStop: false,
    },
  });

  return {
    isPlaylist: result.hasPlaylist(),
    count: result.playlist ? result.playlist.tracks.length : 1,
    track,
  };
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 */
async function updateLavalinkPanel(guildId, client) {
  const queue = lavalinkQueues.get(getQueueKey(client, guildId));
  if (!queue || !queue.current) return;

  try {
    const voiceChannelId =
      queue.voiceChannelId ||
      client.guilds.cache.get(guildId)?.members.me?.voice?.channelId ||
      client.INSTANCE_VOICE_CHANNEL_ID;

    if (voiceChannelId) {
      if (typeof client.updateVoiceStatus === "function") {
        await client.updateVoiceStatus(
          voiceChannelId,
          `✨ Playing - ${queue.current.info.title}`,
        );
      } else {
        await client.rest.put(`/channels/${voiceChannelId}/voice-status`, {
          body: {
            status: `✨ Playing - ${queue.current.info.title}`.slice(0, 500),
          },
        });
      }
    }
  } catch (e) {}

  if (typeof client.updateMusicPresence === "function") {
    client.updateMusicPresence(queue.current.info);
  }

  const pseudoQueue = createPseudoQueue(queue, guildId, client);
  const controller = createCompleteMusicController(pseudoQueue);

  let message = null;
  const existingData = client.musicPanels.get(guildId);

  if (existingData && existingData.message) {
    message = existingData.message;
  } else {
    const { getControllerPanel } = require("./panelStore");
    const storedId = getControllerPanel(queue.textChannel.id);
    if (storedId) {
      try {
        message = await queue.textChannel.messages.fetch(storedId);
      } catch (e) {}
    }
  }

  if (message && typeof message.edit === "function") {
    try {
      message = await message.edit({
        embeds: [],
        components: controller.components,
        flags: controller.flags,
      });
    } catch (e) {
      message = await queue.textChannel.send({
        components: controller.components,
        flags: controller.flags,
      });
    }
  } else {
    message = await queue.textChannel.send({
      components: controller.components,
      flags: controller.flags,
    });
  }

  if (message && message.id && message.channelId) {
    setControllerPanel(message.channelId, message.id);
  }

  client.musicPanels.set(guildId, {
    message,
    song: pseudoQueue.currentTrack,
    startTime: Date.now(),
  });
}

/**
 * @param {LavalinkQueue} queue
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Object}
 */
function createPseudoQueue(queue, guildId, client) {
  return {
    guild: client.guilds.cache.get(guildId),
    currentTrack: queue.current
      ? {
          title: queue.current.info.title,
          url: queue.current.info.uri,
          author: queue.current.info.author,
          thumbnail:
            queue.current.info.artworkUrl ||
            `https://img.youtube.com/vi/${queue.current.info.identifier}/hqdefault.jpg`,
          requestedBy: queue.current.requestedBy || client.user,
          duration: formatLavalinkDuration(queue.current.info.length),
          source: "youtube",
        }
      : null,
    tracks: {
      size: queue.tracks.length,
    },
    node: {
      isPaused: () => queue.paused,
      volume: queue.volume,
    },
    repeatMode: queue.loopMode,
  };
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatLavalinkDuration(ms) {
  if (!ms) return "0:00";
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 */
async function pause(guildId, client) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    q.paused = !q.paused;
    await q.player.setPaused(q.paused);
    return { isPaused: q.paused };
  } else if (isUsingDiscordPlayer(client, guildId)) {
    const q = client.player.nodes.get(guildId);
    if (q.node.isPaused()) {
      q.node.resume();
      return { isPaused: false };
    } else {
      q.node.pause();
      return { isPaused: true };
    }
  }
  throw new Error("Nothing is playing.");
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 */
async function skip(guildId, client) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    await q.player.stopTrack();
  } else if (isUsingDiscordPlayer(client, guildId)) {
    client.player.nodes.get(guildId).node.skip();
  }
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 */
async function stop(guildId, client) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    q.tracks = [];
    await q.player.stopTrack();
  } else if (isUsingDiscordPlayer(client, guildId)) {
    client.player.nodes.get(guildId).delete();
  }
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 */
async function shuffle(guildId, client) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    for (let i = q.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q.tracks[i], q.tracks[j]] = [q.tracks[j], q.tracks[i]];
    }
  } else if (isUsingDiscordPlayer(client, guildId)) {
    client.player.nodes.get(guildId).tracks.shuffle();
  }
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {number}
 */
async function loop(guildId, client, mode = null) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    q.loopMode = mode !== null ? mode : (q.loopMode + 1) % 4;
    return q.loopMode;
  } else if (isUsingDiscordPlayer(client, guildId)) {
    const q = client.player.nodes.get(guildId);
    const nextMode = mode !== null ? mode : (q.repeatMode + 1) % 4;
    q.setRepeatMode(nextMode);
    return nextMode;
  }
  return 0;
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 */
async function previous(guildId, client) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    if (q.history.length > 0) {
      if (q.current) q.tracks.unshift(q.current);
      const prev = q.history.pop();
      q.current = prev;
      await q.player.playTrack({ track: { encoded: prev.encoded } });
      return true;
    }
    return false;
  } else if (isUsingDiscordPlayer(client, guildId)) {
    const q = client.player.nodes.get(guildId);
    if (q.history.previousTrack) {
      await q.history.previous();
      return true;
    }
    return false;
  }
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @param {number} amount
 * @returns {number}
 */
async function adjustVolume(guildId, client, amount) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    q.volume = Math.max(0, Math.min(100, q.volume + amount));
    await q.player.setGlobalVolume(q.volume);
    return q.volume;
  } else if (isUsingDiscordPlayer(client, guildId)) {
    const q = client.player.nodes.get(guildId);
    const newVol = Math.max(0, Math.min(100, q.node.volume + amount));
    q.node.setVolume(newVol);
    return newVol;
  }
  return 100;
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @param {number} volume
 * @returns {number}
 */
async function setVolume(guildId, client, volume) {
  const vol = Math.max(0, Math.min(100, volume));
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    q.volume = vol;
    await q.player.setGlobalVolume(q.volume);
    return q.volume;
  } else if (isUsingDiscordPlayer(client, guildId)) {
    const q = client.player.nodes.get(guildId);
    q.node.setVolume(vol);
    return vol;
  }
  return 100;
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Object}
 */
function getQueueInfo(guildId, client) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(getQueueKey(client, guildId));
    return {
      size: q.tracks.length,
      current: q.current
        ? {
            title: q.current.info.title,
            url: q.current.info.uri,
            duration: formatLavalinkDuration(q.current.info.length),
          }
        : null,
      tracks: q.tracks.slice(0, 10).map((t) => ({
        title: t.info.title,
        url: t.info.uri,
        duration: formatLavalinkDuration(t.info.length),
      })),
    };
  } else if (isUsingDiscordPlayer(client, guildId)) {
    const q = client.player.nodes.get(guildId);
    return {
      size: q.tracks.size,
      current: q.currentTrack
        ? {
            title: q.currentTrack.title,
            url: q.currentTrack.url,
            duration: q.currentTrack.duration,
          }
        : null,
      tracks: q.tracks
        .toArray()
        .slice(0, 10)
        .map((t) => ({ title: t.title, url: t.url, duration: t.duration })),
    };
  }
  return null;
}

/**
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 */
async function triggerUpdate(guildId, client) {
  if (isUsingLavalink(client, guildId)) {
    await updateLavalinkPanel(guildId, client);
  } else if (isUsingDiscordPlayer(client, guildId)) {
    const { updateMusicController } = require("../bot");
    const q = client.player.nodes.get(guildId);
    if (q) {
      const interaction = { message: client.musicPanels.get(guildId)?.message };
      if (interaction.message) {
        await updateMusicController(interaction, q);
      }
    }
  }
}

module.exports = {
  play,
  pause,
  skip,
  stop,
  shuffle,
  loop,
  previous,
  adjustVolume,
  setVolume,
  getQueueInfo,
  triggerUpdate,
  isUsingLavalink,
  isUsingDiscordPlayer,
  getQueueKey,
  lavalinkQueues,
  formatLavalinkDuration,
};
