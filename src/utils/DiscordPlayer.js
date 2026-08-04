const { getWatchdog } = require("./watchdog");
const { createCompleteMusicController } = require("./componentsV2");
const { setControllerPanel } = require("./panelStore");
const { createLogger } = require("./logger");
const { withRetry, swallow } = require("./resilience");
const log = createLogger("DiscordPlayer");
const MAIN_PANEL_CHANNEL_ID = "1473105751575760917";

const idlePhrases = [
  "🎧 /play to start",
  "✨ Vibe check: passed",
  "🫧 Breathing between beats",
  "🌙 Lowkey online",
  "🧊 Chill rn",
  "💫 Just vibing",
  "📻 Static-free",
  "🪩 Mood: playlist",
  "☕ Coffee break, still tuned in",
  "🎯 Energy: steady",
  "🍀 Good vibes only",
  "🛰️ Ready when you are",
];

const pickIdlePhrase = () =>
  idlePhrases[Math.floor(Math.random() * idlePhrases.length)];

/**
 * Upper bound on tracks retained in a single Lavalink queue. Protects against
 * unbounded memory growth from very large playlists or repeated API calls.
 * @type {number}
 */
const MAX_QUEUE_SIZE = 1000;

/** Backoff used when re-joining a voice channel after a Lavalink node drop. */
const NODE_RECOVERY_RETRY = { retries: 2, baseDelayMs: 500, maxDelayMs: 3000 };

/**
 * Settle window (ms) during which the voice auto-rejoin handler must stand down
 * after an intentional transition (fallback or node recovery), so it does not
 * race the deliberate leave/join sequence. See `client.isFallingBack` usage.
 * @type {number}
 */
const TRANSITION_SETTLE_MS = 5000;
const NODE_RECOVERY_SETTLE_MS = 3000;
const JOIN_VOICE_TIMEOUT_MS = 12000;
const PLAY_TRACK_TIMEOUT_MS = 12000;
const PANEL_IO_TIMEOUT_MS = 10000;

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
const lavalinkPanelLocks = new Map();

/**
 * Serializes async work per key by chaining onto a per-key promise. Concurrent
 * callers for the same key run strictly one after another; different keys run
 * independently. The chain entry is cleared once it fully drains.
 * @param {Map<string, Promise<any>>} registry
 * @param {string} key
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
function serialize(registry, key, fn) {
  const pending = registry.get(key) || Promise.resolve();
  const next = pending.then(fn, fn);
  const tail = next.finally(() => {
    if (registry.get(key) === tail) registry.delete(key);
  });
  registry.set(key, tail);
  return next;
}

/**
 * Synchronizes Lavalink queue creation/playback across concurrent requests.
 * @param {string} key
 * @param {Function} fn
 * @returns {Promise<any>}
 */
function withLavalinkLock(key, fn) {
  return serialize(lavalinkPlayLocks, key, fn);
}

/**
 * Serializes panel renders for a guild so concurrent updates (track progression,
 * website control actions, manual refresh) cannot race and post duplicate panels.
 * @param {string} key
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
function withPanelLock(key, fn) {
  return serialize(lavalinkPanelLocks, key, fn);
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
 * Checks if a guild has an active Discord-Player queue.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {boolean}
 */
function isUsingDiscordPlayer(client, guildId) {
  return !!client.player?.nodes?.get(guildId);
}

/**
 * Returns the active Lavalink queue for a guild, or null. Guards against the race
 * where a queue is deleted by cleanup between an `isUsingLavalink` check and use.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {LavalinkQueue|null}
 */
function getLavalinkQueue(client, guildId) {
  return lavalinkQueues.get(getQueueKey(client, guildId)) || null;
}

/**
 * Returns the active Discord-Player queue node for a guild, or null. Guards against
 * the same delete-between-check-and-use race as {@link getLavalinkQueue}.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {import('discord-player').GuildQueue|null}
 */
function getDiscordPlayerQueue(client, guildId) {
  return client.player.nodes.get(guildId) || null;
}

function getPinnedPanelChannelId(client) {
  return client?.INSTANCE_NAME ? null : MAIN_PANEL_CHANNEL_ID;
}

async function resolveMessageChannel(interaction, client) {
  const pinnedChannelId = getPinnedPanelChannelId(client);
  if (pinnedChannelId) {
    const directPinned = interaction?.channel;
    if (
      directPinned?.id === pinnedChannelId &&
      directPinned?.send &&
      directPinned?.messages?.fetch
    ) {
      return directPinned;
    }

    let pinned = client.channels.cache.get(pinnedChannelId);
    if (!pinned) {
      try {
        pinned = await client.channels.fetch(pinnedChannelId);
      } catch {
        pinned = null;
      }
    }
    if (pinned?.send && pinned?.messages?.fetch) return pinned;
    return null;
  }

  const direct = interaction?.channel;
  if (direct?.send && direct?.messages?.fetch) return direct;

  const channelId = interaction?.channelId;
  if (!channelId) return null;

  let channel = client.channels.cache.get(channelId);
  if (!channel) {
    try {
      channel = await client.channels.fetch(channelId);
    } catch {
      channel = null;
    }
  }

  if (channel?.send && channel?.messages?.fetch) return channel;
  return null;
}

function isEditableMessage(message, clientUserId) {
  return (
    !!message &&
    typeof message.edit === "function" &&
    !!clientUserId &&
    message.author?.id === clientUserId
  );
}

async function findFallbackPanelChannel(client, guildId, preferredChannelId) {
  const pinnedChannelId = getPinnedPanelChannelId(client);
  if (pinnedChannelId) {
    let pinned = client.channels.cache.get(pinnedChannelId);
    if (!pinned) {
      try {
        pinned = await client.channels.fetch(pinnedChannelId);
      } catch {
        pinned = null;
      }
    }
    if (pinned?.send && pinned?.messages?.fetch) return pinned;
    return null;
  }

  const candidateIds = [preferredChannelId].filter(Boolean);

  const guild = guildId ? client.guilds.cache.get(guildId) : null;
  const botVoiceChannelId = guild?.members?.me?.voice?.channelId || null;
  if (botVoiceChannelId) candidateIds.push(botVoiceChannelId);

  for (const channelId of candidateIds) {
    let channel = client.channels.cache.get(channelId);
    if (!channel) {
      try {
        channel = await client.channels.fetch(channelId);
      } catch {
        channel = null;
      }
    }
    if (channel?.send && channel?.messages?.fetch) {
      return channel;
    }
  }

  if (!guild) return null;
  const textLike = guild.channels.cache
    .filter((ch) => ch?.send && ch?.messages?.fetch)
    .sort((a, b) => {
      const pa = typeof a.position === "number" ? a.position : 9999;
      const pb = typeof b.position === "number" ? b.position : 9999;
      return pa - pb;
    })
    .first();

  return textLike || null;
}

/**
 * Sets a voice channel's status line, preferring the client helper and falling back
 * to a raw REST call. Status updates are cosmetic, so failures are logged at debug
 * level rather than propagated.
 * @param {import('discord.js').Client} client
 * @param {string} channelId
 * @param {string} status
 * @returns {Promise<void>}
 */
async function setVoiceStatus(client, channelId, status) {
  if (!channelId) return;
  try {
    if (typeof client.updateVoiceStatus === "function") {
      await client.updateVoiceStatus(channelId, status);
    } else {
      await client.rest.put(`/channels/${channelId}/voice-status`, {
        body: { status: status.slice(0, 500) },
      });
    }
  } catch (e) {
    log.debug(`Voice status update failed for ${channelId}:`, e?.message || e);
  }
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
  try {
    await withTimeout(
      queue.player.playTrack({ track: { encoded: nextTrack.encoded } }),
      PLAY_TRACK_TIMEOUT_MS,
      `playTrack ${nextTrack.info?.title || "unknown"}`,
    );
  } catch (e) {
    log.warn(`playTrack failed: ${e?.message || e}`);
  }
}

/**
 * Entrypoint for playing media on a voice channel.
 * Implements concurrency locks and Lavalink queue orchestration.
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {string} query
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {import('discord.js').Client} client
 * @returns {Promise<Object>} Playback initialization metadata
 */
async function play(interaction, query, voiceChannel, client) {
  const watchdog = getWatchdog(client);
  const guildId = voiceChannel.guild.id;
  const queueKey = getQueueKey(client, guildId);
  return withLavalinkLock(queueKey, async () => {
    if (!watchdog || !watchdog.isNodeAvailable()) {
      throw new Error("No available Lavalink nodes.");
    }
    return handleLavalinkPlay(
      interaction,
      query,
      voiceChannel,
      client,
      watchdog,
    );
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
  const pinnedChannelId = getPinnedPanelChannelId(client);
  const messageChannel = pinnedChannelId
    ? await findFallbackPanelChannel(
        client,
        voiceChannel.guild.id,
        pinnedChannelId,
      )
    : (await resolveMessageChannel(interaction, client)) ||
      (await findFallbackPanelChannel(
        client,
        voiceChannel.guild.id,
        interaction?.channelId,
      ));
  const searchTargets = /^https?:\/\//i.test(query)
    ? [query]
    : [`ytmsearch:${query}`, `ytsearch:${query}`];
  const queueKey = getQueueKey(client, voiceChannel.guild.id);

  const resolveOnNode = async (node) => {
    for (const searchStr of searchTargets) {
      const searchPromise = node.rest.resolve(searchStr);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("REST resolve timeout")), 5000),
      );

      const searchResult = await Promise.race([searchPromise, timeoutPromise]);

      if (!searchResult || !searchResult.data) {
        continue;
      }

      let tracksToAdd;
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
        continue;
      }

      if (tracksToAdd?.length) {
        return { node, searchResult, tracksToAdd };
      }
    }

    throw new Error("No results found.");
  };

  let queue = lavalinkQueues.get(queueKey);
  const existingPlayer = watchdog.shoukaku.players.get(voiceChannel.guild.id);
  const botVoiceChannelId = voiceChannel.guild.members.me.voice?.channelId;
  let resolved = null;

  if (queue && (queue.player?.node?.state !== 1 || !botVoiceChannelId)) {
    lavalinkQueues.delete(queueKey);
    queue = null;
  }

  const preferredNode = queue?.player?.node || existingPlayer?.node;

  if (preferredNode?.state === 1) {
    try {
      resolved = await resolveOnNode(preferredNode);
    } catch (e) {
      log.warn(
        `Preferred node ${preferredNode.name} failed to resolve: ${e.message}. Trying other nodes...`,
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
      throw new Error(`All nodes failed to resolve. (${errorDetails})`, {
        cause: error,
      });
    }
  }

  const { node, searchResult, tracksToAdd } = resolved;

  tracksToAdd.forEach((t) => (t.requestedBy = interaction.user));

  const attachPlayerListeners = (p, q) => {
    const progressQueue = async () => {
      await playNextLavalink(q);
      if (!q.current) {
        lavalinkQueues.delete(queueKey);
        client.musicPanels.delete(voiceChannel.guild.id);
        await setVoiceStatus(client, voiceChannel.id, pickIdlePhrase());
        if (watchdog.shoukaku.connections.has(voiceChannel.guild.id)) {
          await swallow(
            watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id),
            "Leave voice channel after queue finished",
          );
        }
        if (typeof client.updateMusicPresence === "function") {
          client.updateMusicPresence(null);
        }
        if (typeof watchdog.clearPreferredNode === "function") {
          watchdog.clearPreferredNode(voiceChannel.guild.id);
        }
      } else {
        await updateLavalinkPanel(voiceChannel.guild.id, client);
      }
    };

    p.on("end", async (payload) => {
      const reason = String(payload?.reason || "").toLowerCase();
      if (reason === "replaced") return;
      await progressQueue();
    });

    p.on("exception", (payload) => {
      log.warn(
        `Track exception in guild ${voiceChannel.guild.id}: ${
          payload?.exception?.message || payload?.error || "unknown"
        }`,
      );
    });

    p.on("stuck", async (payload) => {
      log.warn(
        `Track stuck in guild ${voiceChannel.guild.id} (threshold ${
          payload?.thresholdMs ?? "?"
        }ms); skipping.`,
      );
      await swallow(q.player.stopTrack(), "Stop stuck track");
    });

    p.on("closed", async () => {
      const interrupted = q.current;
      if (q.tracks.length > 0 || interrupted) {
        const onlineNodes = getOnlineNodes(watchdog);
        if (onlineNodes.length > 0) {
          try {
            client.isRecoveringNode = true;
            q.current = null;
            if (interrupted) q.tracks.unshift(interrupted);
            const newNode = onlineNodes[0];
            if (typeof watchdog.setPreferredNode === "function") {
              watchdog.setPreferredNode(voiceChannel.guild.id, newNode.name);
            }
            if (watchdog.shoukaku.connections.has(voiceChannel.guild.id)) {
              await swallow(
                watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id),
                "Leave stale connection before node recovery",
              );
            }
            const newPlayer = await withRetry(
              () =>
                watchdog.shoukaku.joinVoiceChannel({
                  guildId: voiceChannel.guild.id,
                  channelId: voiceChannel.id,
                  shardId: voiceChannel.guild.shardId,
                  deaf: true,
                }),
              NODE_RECOVERY_RETRY,
            );
            q.player = newPlayer;
            attachPlayerListeners(newPlayer, q);
            await playNextLavalink(q);
            await updateLavalinkPanel(voiceChannel.guild.id, client);
            setTimeout(() => {
              client.isRecoveringNode = false;
            }, NODE_RECOVERY_SETTLE_MS);
            return;
          } catch (e) {
            log.error("Failed to recover node mid-queue:", e?.message || e);
            client.isRecoveringNode = false;
          }
        }
      }

      lavalinkQueues.delete(queueKey);
      client.musicPanels.delete(voiceChannel.guild.id);
      await setVoiceStatus(client, voiceChannel.id, pickIdlePhrase());
      if (typeof client.updateMusicPresence === "function") {
        client.updateMusicPresence(null);
      }
      if (typeof watchdog.clearPreferredNode === "function") {
        watchdog.clearPreferredNode(voiceChannel.guild.id);
      }
    });
  };

  if (!queue) {
    let player =
      existingPlayer &&
      existingPlayer.node?.name === node.name &&
      botVoiceChannelId === voiceChannel.id
        ? existingPlayer
        : null;
    if (!player) {
      if (watchdog.shoukaku.connections.has(voiceChannel.guild.id)) {
        await swallow(
          watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id),
          "Leave stale voice channel before rejoin",
        );
      }
      if (typeof watchdog.setPreferredNode === "function") {
        watchdog.setPreferredNode(voiceChannel.guild.id, node.name);
      }
      player = await withTimeout(
        watchdog.shoukaku.joinVoiceChannel({
          guildId: voiceChannel.guild.id,
          channelId: voiceChannel.id,
          shardId: voiceChannel.guild.shardId,
          deaf: true,
        }),
        JOIN_VOICE_TIMEOUT_MS,
        `joinVoiceChannel guild=${voiceChannel.guild.id}`,
      );
    }

    queue = {
      player,
      voiceChannelId: voiceChannel.id,
      tracks: [],
      current: null,
      textChannel: messageChannel,
      textChannelId:
        pinnedChannelId || messageChannel?.id || interaction?.channelId || null,
      loopMode: 0,
      paused: false,
      volume: 100,
      history: [],
    };

    lavalinkQueues.set(queueKey, queue);

    attachPlayerListeners(player, queue);
  } else {
    queue.textChannel = messageChannel || queue.textChannel;
    queue.textChannelId =
      pinnedChannelId ||
      messageChannel?.id ||
      queue.textChannelId ||
      interaction?.channelId ||
      null;
    const connectedChannelId = voiceChannel.guild.members.me.voice?.channelId;
    const shouldMoveToRequester =
      connectedChannelId &&
      connectedChannelId !== voiceChannel.id &&
      !queue.current;

    if (shouldMoveToRequester) {
      if (watchdog.shoukaku.connections.has(voiceChannel.guild.id)) {
        await swallow(
          watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id),
          "Leave old voice channel before migration",
        );
      }
      if (typeof watchdog.setPreferredNode === "function") {
        watchdog.setPreferredNode(voiceChannel.guild.id, node.name);
      }
      const movedPlayer = await withTimeout(
        watchdog.shoukaku.joinVoiceChannel({
          guildId: voiceChannel.guild.id,
          channelId: voiceChannel.id,
          shardId: voiceChannel.guild.shardId,
          deaf: true,
        }),
        JOIN_VOICE_TIMEOUT_MS,
        `move joinVoiceChannel guild=${voiceChannel.guild.id}`,
      );
      queue.player = movedPlayer;
      queue.voiceChannelId = voiceChannel.id;
      attachPlayerListeners(movedPlayer, queue);
    }
  }

  const capacity = Math.max(0, MAX_QUEUE_SIZE - queue.tracks.length);
  const accepted = tracksToAdd.slice(0, capacity);
  if (accepted.length < tracksToAdd.length) {
    log.warn(
      `Queue cap (${MAX_QUEUE_SIZE}) reached for guild ${voiceChannel.guild.id}; dropped ${tracksToAdd.length - accepted.length} track(s).`,
    );
  }
  queue.tracks.push(...accepted);

  const isNewSession = !queue.current;
  if (isNewSession) {
    await playNextLavalink(queue);
  }
  await updateLavalinkPanel(voiceChannel.guild.id, client, isNewSession);

  return {
    isPlaylist: searchResult.loadType === "playlist",
    count: accepted.length,
    track: { title: (accepted[0] || tracksToAdd[0]).info.title },
  };
}

/**
 * Updates voice-channel status, presence, and the now-playing control panel for a
 * Lavalink-backed guild. The panel render is serialized per guild so concurrent
 * callers (track progression, website actions, refresh) edit one shared message
 * instead of racing to post duplicates.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function updateLavalinkPanel(guildId, client, forceNew = false) {
  const queue = lavalinkQueues.get(getQueueKey(client, guildId));
  if (!queue || !queue.current) return;

  const pinnedChannelId = getPinnedPanelChannelId(client);
  if (pinnedChannelId) {
    let pinned = client.channels.cache.get(pinnedChannelId);
    if (!pinned) {
      try {
        pinned = await client.channels.fetch(pinnedChannelId);
      } catch {
        pinned = null;
      }
    }
    if (pinned?.send && pinned?.messages?.fetch) {
      queue.textChannel = pinned;
      queue.textChannelId = pinned.id;
    } else {
      log.warn(
        `Pinned panel channel unavailable during render: guild=${guildId}`,
      );
      return;
    }
  }

  if ((!queue.textChannel || !queue.textChannel.send) && queue.textChannelId) {
    let recovered = client.channels.cache.get(queue.textChannelId);
    if (!recovered) {
      try {
        recovered = await client.channels.fetch(queue.textChannelId);
      } catch {
        recovered = null;
      }
    }
    if (recovered?.send && recovered?.messages?.fetch) {
      queue.textChannel = recovered;
    }
  }

  if (!queue.textChannel || !queue.textChannel.send) {
    const fallbackChannel = await findFallbackPanelChannel(
      client,
      guildId,
      queue.textChannelId,
    );
    if (fallbackChannel) {
      queue.textChannel = fallbackChannel;
      queue.textChannelId = fallbackChannel.id;
    }
  }

  const voiceChannelId =
    queue.voiceChannelId ||
    client.guilds.cache.get(guildId)?.members.me?.voice?.channelId ||
    client.INSTANCE_VOICE_CHANNEL_ID;
  if (voiceChannelId) {
    await setVoiceStatus(
      client,
      voiceChannelId,
      `✨ Playing - ${queue.current.info.title}`,
    );
  }

  if (typeof client.updateMusicPresence === "function") {
    client.updateMusicPresence(queue.current.info);
  }

  const renderPanel = async () => {
    const liveQueue = lavalinkQueues.get(getQueueKey(client, guildId));
    if (!liveQueue || !liveQueue.current) return;
    if (!liveQueue.textChannel || !liveQueue.textChannel.send) {
      return;
    }

    const pseudoQueue = createPseudoQueue(liveQueue, guildId, client);
    const controller = createCompleteMusicController(pseudoQueue);
    if (!controller) return;

    let message = null;
    if (!forceNew) {
      const existingData = client.musicPanels.get(guildId);
      if (existingData && existingData.message) {
        const sameChannel =
          existingData.message.channelId === liveQueue.textChannel.id;
        message =
          sameChannel &&
          isEditableMessage(existingData.message, client.user?.id)
            ? existingData.message
            : null;
      } else {
        const { getControllerPanel } = require("./panelStore");
        const storedId = getControllerPanel(liveQueue.textChannel.id);
        if (storedId) {
          try {
            const fetched = await withTimeout(
              liveQueue.textChannel.messages.fetch(storedId),
              PANEL_IO_TIMEOUT_MS,
              `panel fetch`,
            );
            message = isEditableMessage(fetched, client.user?.id)
              ? fetched
              : null;
          } catch {
            message = null;
          }
        }
      }
    }

    const payload = {
      components: controller.components,
      flags: controller.flags,
    };

    try {
      if (message && typeof message.edit === "function") {
        try {
          message = await withTimeout(
            message.edit({ embeds: [], ...payload }),
            PANEL_IO_TIMEOUT_MS,
            `panel edit`,
          );
        } catch {
          message = await withTimeout(
            liveQueue.textChannel.send(payload),
            PANEL_IO_TIMEOUT_MS,
            `panel resend`,
          );
        }
      } else {
        message = await withTimeout(
          liveQueue.textChannel.send(payload),
          PANEL_IO_TIMEOUT_MS,
          `panel send`,
        );
      }
    } catch (e) {
      log.warn(`Failed to render panel: ${e?.message || e}`);
      return;
    }

    if (message && message.id && message.channelId) {
      setControllerPanel(message.channelId, message.id);
    }

    client.musicPanels.set(guildId, {
      message,
      song: pseudoQueue.currentTrack,
      startTime: Date.now(),
    });
  };

  if (pinnedChannelId) {
    await renderPanel();
    return;
  }

  await withPanelLock(getQueueKey(client, guildId), renderPanel);
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
 * Toggles pause/resume for the active queue.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Promise<{isPaused: boolean}>}
 * @throws {Error} If nothing is playing in the guild.
 */
async function pause(guildId, client) {
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    lq.paused = !lq.paused;
    await lq.player.setPaused(lq.paused);
    return { isPaused: lq.paused };
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) {
    if (dp.node.isPaused()) {
      dp.node.resume();
      return { isPaused: false };
    }
    dp.node.pause();
    return { isPaused: true };
  }
  throw new Error("Nothing is playing.");
}

/**
 * Skips the current track.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function skip(guildId, client) {
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    await lq.player.stopTrack();
    return;
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) dp.node.skip();
}

/**
 * Stops playback and clears the queue.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function stop(guildId, client) {
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    lq.tracks = [];
    lq.history = [];
    lq.loopMode = 0;
    lq.paused = false;
    lq.current = null;
    await swallow(lq.player.stopTrack(), "Stop Lavalink track");
    return;
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) {
    dp.tracks.clear();
    dp.setRepeatMode(0);
    await swallow(Promise.resolve(dp.node.stop()), "Stop Discord-Player node");
  }
}

/**
 * Shuffles the pending tracks in place (Fisher-Yates for Lavalink).
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function shuffle(guildId, client) {
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    for (let i = lq.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lq.tracks[i], lq.tracks[j]] = [lq.tracks[j], lq.tracks[i]];
    }
    return;
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) dp.tracks.shuffle();
}

/**
 * Cycles or sets the repeat mode (0=off, 1=track, 2=queue, 3=autoplay).
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @param {number|null} [mode=null] - Explicit mode, or null to advance to the next.
 * @returns {Promise<number>} The resulting repeat mode.
 */
async function loop(guildId, client, mode = null) {
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    lq.loopMode = mode !== null ? mode : (lq.loopMode + 1) % 4;
    return lq.loopMode;
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) {
    const nextMode = mode !== null ? mode : (dp.repeatMode + 1) % 4;
    dp.setRepeatMode(nextMode);
    return nextMode;
  }
  return 0;
}

/**
 * Plays the previous track from history, if available.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Promise<boolean>} True if a previous track was started.
 */
async function previous(guildId, client) {
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    if (lq.history.length > 0) {
      if (lq.current) lq.tracks.unshift(lq.current);
      const prev = lq.history.pop();
      lq.current = prev;
      await lq.player.playTrack({ track: { encoded: prev.encoded } });
      return true;
    }
    return false;
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) {
    if (dp.history.previousTrack) {
      await dp.history.previous();
      return true;
    }
    return false;
  }
  return false;
}

/**
 * Adjusts volume by a relative amount, clamped to 0-100.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @param {number} amount
 * @returns {Promise<number>} The resulting volume.
 */
async function adjustVolume(guildId, client, amount) {
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    lq.volume = Math.max(0, Math.min(100, lq.volume + amount));
    await lq.player.setGlobalVolume(lq.volume);
    return lq.volume;
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) {
    const newVol = Math.max(0, Math.min(100, dp.node.volume + amount));
    dp.node.setVolume(newVol);
    return newVol;
  }
  return 100;
}

/**
 * Sets volume to an absolute value, clamped to 0-100.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @param {number} volume
 * @returns {Promise<number>} The resulting volume.
 */
async function setVolume(guildId, client, volume) {
  const vol = Math.max(0, Math.min(100, volume));
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    lq.volume = vol;
    await lq.player.setGlobalVolume(lq.volume);
    return lq.volume;
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) {
    dp.node.setVolume(vol);
    return vol;
  }
  return 100;
}

/**
 * Returns a normalized snapshot of the queue, or null if nothing is playing.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Object|null}
 */
function getQueueInfo(guildId, client) {
  const lq = getLavalinkQueue(client, guildId);
  if (lq) {
    return {
      size: lq.tracks.length,
      current: lq.current
        ? {
            title: lq.current.info.title,
            url: lq.current.info.uri,
            duration: formatLavalinkDuration(lq.current.info.length),
          }
        : null,
      tracks: lq.tracks.slice(0, 10).map((t) => ({
        title: t.info.title,
        url: t.info.uri,
        duration: formatLavalinkDuration(t.info.length),
      })),
    };
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) {
    return {
      size: dp.tracks.size,
      current: dp.currentTrack
        ? {
            title: dp.currentTrack.title,
            url: dp.currentTrack.url,
            duration: dp.currentTrack.duration,
          }
        : null,
      tracks: dp.tracks
        .toArray()
        .slice(0, 10)
        .map((t) => ({ title: t.title, url: t.url, duration: t.duration })),
    };
  }
  return null;
}

/**
 * Refreshes the now-playing panel for whichever backend is active.
 * @param {string} guildId
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function triggerUpdate(guildId, client) {
  if (getLavalinkQueue(client, guildId)) {
    await updateLavalinkPanel(guildId, client);
    return;
  }
  const dp = getDiscordPlayerQueue(client, guildId);
  if (dp) {
    const { updateMusicController } = require("../bot");
    const message = client.musicPanels.get(guildId)?.message;
    if (message) {
      await updateMusicController({ message }, dp);
    }
  }
}

/**
 * Releases all Lavalink resources held for a guild. Called when the bot leaves a
 * guild or is disconnected, so live players and their listeners are not orphaned in
 * the {@link lavalinkQueues} map. Cosmetic side effects (panels) are cleared too.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {Promise<void>}
 */
async function cleanupGuild(client, guildId) {
  const key = getQueueKey(client, guildId);
  const queue = lavalinkQueues.get(key);
  lavalinkQueues.delete(key);
  client.musicPanels?.delete(guildId);
  if (!queue) return;
  const watchdog = getWatchdog(client);
  if (watchdog?.shoukaku?.connections?.has(guildId)) {
    await swallow(
      watchdog.shoukaku.leaveVoiceChannel(guildId),
      `Cleanup voice channel for guild ${guildId}`,
    );
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
  cleanupGuild,
  isUsingLavalink,
  isUsingDiscordPlayer,
  getQueueKey,
  lavalinkQueues,
  formatLavalinkDuration,
};
