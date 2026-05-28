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

/**
 * @param {import('discord.js').Client} client 
 * @param {string} guildId 
 * @returns {boolean}
 */
function isUsingLavalink(client, guildId) {
  return lavalinkQueues.has(guildId);
}

/**
 * @param {import('discord.js').Client} client 
 * @param {string} guildId 
 * @returns {boolean}
 */
function isUsingDiscordPlayer(client, guildId) {
  return client.player.nodes.has(guildId);
}

/**
 * @param {LavalinkQueue} queue 
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
 * @param {import('discord.js').CommandInteraction} interaction 
 * @param {string} query 
 * @param {import('discord.js').VoiceChannel} voiceChannel 
 * @param {import('discord.js').Client} client 
 */
async function play(interaction, query, voiceChannel, client) {
  const watchdog = getWatchdog();
  const finalQuery = await resolveSpotifyQuery(query);

  if (watchdog && watchdog.isNodeAvailable() && !isUsingDiscordPlayer(client, voiceChannel.guild.id)) {
    return await handleLavalinkPlay(interaction, finalQuery, voiceChannel, client, watchdog);
  } else {
    return await handleDiscordPlayerPlay(interaction, finalQuery, voiceChannel, client);
  }
}

/**
 * @param {import('discord.js').CommandInteraction} interaction 
 * @param {string} query 
 * @param {import('discord.js').VoiceChannel} voiceChannel 
 * @param {import('discord.js').Client} client 
 * @param {import('./lavalinkWatchdog').LavalinkWatchdog} watchdog 
 */
async function handleLavalinkPlay(interaction, query, voiceChannel, client, watchdog) {
  const node = watchdog.shoukaku.options.nodeResolver(watchdog.shoukaku.nodes);
  if (!node) throw new Error("No available Lavalink nodes.");

  const searchResult = await node.rest.resolve(query.startsWith("http") ? query : `ytsearch:${query}`);
  if (!searchResult || !searchResult.data) {
    throw new Error("No results found.");
  }

  let tracksToAdd = [];
  if (searchResult.loadType === "playlist") {
    tracksToAdd = searchResult.data.info.tracks;
  } else if (searchResult.loadType === "search" || searchResult.loadType === "track") {
    tracksToAdd = [searchResult.loadType === "search" ? searchResult.data[0] : searchResult.data];
  } else {
    throw new Error("No results found.");
  }

  tracksToAdd.forEach(t => t.requestedBy = interaction.user);

  let queue = lavalinkQueues.get(voiceChannel.guild.id);

  if (!queue) {
    const player = await watchdog.shoukaku.joinVoiceChannel({
      guildId: voiceChannel.guild.id,
      channelId: voiceChannel.id,
      shardId: voiceChannel.guild.shardId,
      deaf: true
    });

    queue = {
      player,
      tracks: [],
      current: null,
      textChannel: interaction.channel,
      loopMode: 0,
      paused: false,
      volume: 100,
      history: []
    };

    lavalinkQueues.set(voiceChannel.guild.id, queue);

    player.on("end", async (reason) => {
      if (reason.reason === "REPLACED") return;
      await playNextLavalink(queue);
      if (!queue.current) {
        lavalinkQueues.delete(voiceChannel.guild.id);
        client.musicPanels.delete(voiceChannel.guild.id);
        await watchdog.shoukaku.leaveVoiceChannel(voiceChannel.guild.id);
      } else {
        await updateLavalinkPanel(voiceChannel.guild.id, client);
      }
    });

    player.on("closed", () => {
      lavalinkQueues.delete(voiceChannel.guild.id);
      client.musicPanels.delete(voiceChannel.guild.id);
    });
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
    track: { title: tracksToAdd[0].info.title } 
  };
}

/**
 * @param {import('discord.js').CommandInteraction} interaction 
 * @param {string} query 
 * @param {import('discord.js').VoiceChannel} voiceChannel 
 * @param {import('discord.js').Client} client 
 */
async function handleDiscordPlayerPlay(interaction, query, voiceChannel, client) {
  const result = await client.player.search(query, {
    requestedBy: interaction.user,
    searchEngine: QueryType.AUTO,
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

  return { isPlaylist: result.hasPlaylist(), count: result.playlist ? result.playlist.tracks.length : 1, track };
}

/**
 * @param {string} guildId 
 * @param {import('discord.js').Client} client 
 */
async function updateLavalinkPanel(guildId, client) {
  const queue = lavalinkQueues.get(guildId);
  if (!queue || !queue.current) return;

  const pseudoQueue = createPseudoQueue(queue, guildId, client);
  const controller = createCompleteMusicController(pseudoQueue);

  let message = null;
  const existingData = client.musicPanels.get(guildId);

  if (existingData && existingData.message) {
    try {
      message = await existingData.message.edit({ embeds: [], components: controller.components, flags: controller.flags });
    } catch (e) {
      message = await queue.textChannel.send({ components: controller.components, flags: controller.flags });
    }
  } else {
    message = await queue.textChannel.send({ components: controller.components, flags: controller.flags });
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
    currentTrack: queue.current ? {
      title: queue.current.info.title,
      url: queue.current.info.uri,
      author: queue.current.info.author,
      thumbnail: queue.current.info.artworkUrl || `https://img.youtube.com/vi/${queue.current.info.identifier}/hqdefault.jpg`,
      requestedBy: queue.current.requestedBy || client.user,
      duration: formatLavalinkDuration(queue.current.info.length),
      source: 'youtube'
    } : null,
    tracks: {
      size: queue.tracks.length
    },
    node: {
      isPaused: () => queue.paused,
      volume: queue.volume
    },
    repeatMode: queue.loopMode
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
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * @param {string} guildId 
 * @param {import('discord.js').Client} client 
 */
async function pause(guildId, client) {
  if (isUsingLavalink(client, guildId)) {
    const q = lavalinkQueues.get(guildId);
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
    const q = lavalinkQueues.get(guildId);
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
    const q = lavalinkQueues.get(guildId);
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
    const q = lavalinkQueues.get(guildId);
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
    const q = lavalinkQueues.get(guildId);
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
    const q = lavalinkQueues.get(guildId);
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
    const q = lavalinkQueues.get(guildId);
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
    const q = lavalinkQueues.get(guildId);
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
    const q = lavalinkQueues.get(guildId);
    return {
      size: q.tracks.length,
      current: q.current ? { title: q.current.info.title, url: q.current.info.uri, duration: formatLavalinkDuration(q.current.info.length) } : null,
      tracks: q.tracks.slice(0, 10).map(t => ({ title: t.info.title, url: t.info.uri, duration: formatLavalinkDuration(t.info.length) }))
    };
  } else if (isUsingDiscordPlayer(client, guildId)) {
    const q = client.player.nodes.get(guildId);
    return {
      size: q.tracks.size,
      current: q.currentTrack ? { title: q.currentTrack.title, url: q.currentTrack.url, duration: q.currentTrack.duration } : null,
      tracks: q.tracks.toArray().slice(0, 10).map(t => ({ title: t.title, url: t.url, duration: t.duration }))
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
  lavalinkQueues,
  formatLavalinkDuration
};
