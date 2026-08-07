const WebSocket = require("ws");
const http = require("http");

const RELAY_URL =
  process.env.SHANTHA_RELAY_URL || "ws://68.233.112.166:3001/relay/zyra";
const RELAY_SECRET = process.env.ZYRA_RELAY_SECRET || "zyra-relay-2026";
const RECONNECT_INTERVAL = 5000;

let _ws = null;
let _server = null;
let _reconnectTimer = null;

function connectRelay(localServer) {
  if (_server) return;
  _server = localServer;
  console.log(`[RELAY] Connecting to ${RELAY_URL}`);
  attempt();
}

function attempt() {
  if (
    _ws &&
    (_ws.readyState === WebSocket.OPEN ||
      _ws.readyState === WebSocket.CONNECTING)
  )
    return;

  try {
    _ws = new WebSocket(RELAY_URL);
  } catch (err) {
    console.error("[RELAY] WS constructor error:", err.message);
    scheduleReconnect();
    return;
  }

  _ws.on("open", () => {
    console.log("[RELAY] Connected to Shantha relay");
    _ws.send(JSON.stringify({ type: "auth", secret: RELAY_SECRET }));
  });

  _ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "auth") {
      if (msg.ok) {
        console.log("[RELAY] Authenticated with Shantha");
      } else {
        console.error("[RELAY] Auth failed");
        _ws.close();
      }
      return;
    }

    if (msg.id && msg.method && msg.path) {
      const result = await handleRelayRequest(msg);
      if (_ws.readyState === WebSocket.OPEN) {
        _ws.send(
          JSON.stringify({
            type: "response",
            id: msg.id,
            status: result.status,
            data: result.data,
          }),
        );
      }
    }
  });

  _ws.on("close", () => {
    _ws = null;
    scheduleReconnect();
  });

  _ws.on("error", () => {
    try {
      _ws.close();
    } catch {}
    _ws = null;
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    attempt();
  }, RECONNECT_INTERVAL);
}

function handleRelayRequest(msg) {
  return new Promise((resolve) => {
    const { method, path, body, query } = msg;

    let urlPath = path;
    if (query && Object.keys(query).length) {
      const params = new URLSearchParams(query).toString();
      urlPath = `${path}?${params}`;
    }

    const postData = body ? JSON.stringify(body) : "";
    const port = _server?.address()?.port || 8000;

    const options = {
      hostname: "127.0.0.1",
      port,
      path: urlPath,
      method: method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MUSIC_API_KEY || ""}`,
      },
    };

    if (postData && method === "POST") {
      options.headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on("error", (err) => {
      resolve({ status: 500, data: { error: err.message } });
    });

    req.setTimeout(25000, () => {
      req.destroy();
      resolve({ status: 504, data: { error: "Local API timeout" } });
    });

    if (postData && method === "POST") req.write(postData);
    req.end();
  });
}

module.exports = { connectRelay };
