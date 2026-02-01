import express from "express";
 
// Node 18+ has global fetch
const app = express();
app.use(express.json());
 
// ---------- Config (from Render env vars) ----------
const {
  HUE_CLIENT_ID,
  HUE_CLIENT_SECRET,
  HUE_REFRESH_TOKEN,
  HUE_BRIDGE_ID,
  HUE_LIGHT_ID,
  API_KEY // simple shared secret for your endpoint (optional but strongly recommended)
} = process.env;
 
function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env var: ${name}`);
}
 
requireEnv("HUE_CLIENT_ID");
requireEnv("HUE_CLIENT_SECRET");
requireEnv("HUE_REFRESH_TOKEN");
requireEnv("HUE_BRIDGE_ID");
requireEnv("HUE_LIGHT_ID");
// API_KEY optional, but recommended
 
// ---------- Simple auth for your endpoint ----------
function checkApiKey(req) {
  if (!API_KEY) return true; // allow if not configured
  const key = req.header("x-api-key") || req.query.key;
  return key && key === API_KEY;
}
 
// ---------- Token cache ----------
let accessToken = null;
let accessTokenExpiresAt = 0; // epoch ms
 
async function refreshAccessToken() {
  const url = "https://api.meethue.com/v2/oauth2/token";
 
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", HUE_REFRESH_TOKEN);
  body.set("client_id", HUE_CLIENT_ID);
  body.set("client_secret", HUE_CLIENT_SECRET);
 
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
 
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
 
  const json = await res.json();
  accessToken = json.access_token;
 
  // expires_in is seconds
  const expiresInMs = (json.expires_in ?? 3600) * 1000;
  // Refresh a bit earlier (minus 60s)
  accessTokenExpiresAt = Date.now() + expiresInMs - 60_000;
 
  return accessToken;
}
 
async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken;
  return refreshAccessToken();
}
 
// ---------- Hue control ----------
function payloadForState(state) {
  // Tune these as you like
  switch (state) {
    case "HIGH":
      return { on: true, hue: 0, sat: 254, bri: 200, transitiontime: 10 }; // red
    case "NORMAL":
      return { on: true, hue: 25500, sat: 254, bri: 150, transitiontime: 10 }; // green
    case "LOW":
      return { on: true, hue: 46920, sat: 254, bri: 254, transitiontime: 10 }; // blue
    case "NODATA":
      return { on: true, hue: 12750, sat: 200, bri: 200, transitiontime: 10 }; // yellow-ish
    default:
      return null;
  }
}
 
async function setLightState(state) {
  const payload = payloadForState(state);
  if (!payload) {
    throw new Error(`Unknown state "${state}". Use HIGH|NORMAL|LOW|NODATA`);
  }
 
  const token = await getAccessToken();
 
  // Hue Remote API "bridge" proxy endpoint:
  // This format is commonly used:
  // https://api.meethue.com/bridge/<bridgeid>/lights/<lightid>/state
  const url = `https://api.meethue.com/bridge/${HUE_BRIDGE_ID}/lights/${HUE_LIGHT_ID}/state`;
 
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
 
  const text = await res.text();
  if (!res.ok) throw new Error(`Hue call failed: ${res.status} ${text}`);
  return text;
}
 
// ---------- Routes ----------
app.get("/health", (_req, res) => res.json({ ok: true }));
 
app.get("/setColor/:state", async (req, res) => {
  try {
    if (!checkApiKey(req)) return res.status(401).json({ error: "unauthorized" });
 
    const state = String(req.params.state || "").toUpperCase();
    const result = await setLightState(state);
    res.status(200).send(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
 
// Alternative query style: /setColor?state=HIGH
app.get("/setColor", async (req, res) => {
  try {
    if (!checkApiKey(req)) return res.status(401).json({ error: "unauthorized" });
 
    const state = String(req.query.state || "").toUpperCase();
    const result = await setLightState(state);
    res.status(200).send(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
 
const port = process.env.PORT || 10000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Hue proxy listening on ${port}`);
});
