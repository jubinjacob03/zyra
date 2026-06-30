"use client";

import { useEffect, useState } from "react";
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { io, Socket } from "socket.io-client";

// IMPORTANT: Use the Client ID provided in the .env / developer portal
const DISCORD_CLIENT_ID = "1456983456457166859";

let discordSdk: DiscordSDK | null = null;
let socket: Socket | null = null;

export function useDiscordSync() {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Connecting...");
  const [remoteState, setRemoteState] = useState<any>(null);

  useEffect(() => {
    async function setup() {
      try {
        // Connect to the Socket.io server running on the bot's API port
        const socketUrl = window.location.hostname === "localhost" ? "http://localhost:8000" : "/";
        socket = io(socketUrl, {
          reconnectionAttempts: 3,
          timeout: 5000,
        });

        socket.on("connect", () => {
          setStatus(channelId ? "Connected & Syncing" : "Connected to Sync Server");
        });

        socket.on("connect_error", () => {
          setStatus("Sync Server Offline (Local Mode)");
        });

        socket.on("sync_video", (data) => {
          setRemoteState(data);
        });

        // Check if we are running inside Discord (frame_id is present in URL)
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.has("frame_id")) {
          setStatus("Browser Mode (Global Sync)");
          // Join a default global room for browser testing
          socket.emit("join_channel", "global_browser_room");
          setChannelId("global_browser_room");
          return;
        }

        discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
        await discordSdk.ready();
        
        const currentChannelId = discordSdk.channelId;
        setChannelId(currentChannelId || null);

        if (currentChannelId) {
          setStatus("Discord VC Sync Active");
          socket.emit("join_channel", currentChannelId);
        } else {
          setStatus("Not in a voice channel");
        }

      } catch (err) {
        console.error("Discord SDK Error:", err);
        setStatus("Running outside Discord");
      }
    }

    setup();

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  const broadcastState = (state: string, extra: any = {}) => {
    if (socket && channelId) {
      socket.emit("video_state_change", {
        channelId,
        state,
        ...extra,
      });
    }
  };

  const logAction = (action: string, details: string) => {
    if (socket) {
      socket.emit("user_action", {
        channelId: channelId || "Unknown",
        user: socket.id, // Fallback since we aren't doing full OAuth
        action,
        details,
      });
    }
  };

  return { status, remoteState, broadcastState, logAction };
}
