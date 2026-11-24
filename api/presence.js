const { neon } = require("@neondatabase/serverless");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setCors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, accept");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return res.status(500).json({ error: "misconfigured" });
  }

  const body = typeof req.body === "string"
    ? (() => { try { return JSON.parse(req.body); } catch { return null; } })()
    : (req.body || {});

  const sessionId = body && body.sessionId ? String(body.sessionId).trim() : "";
  if (!UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: "invalid_session" });
  }

  try {
    const sql = neon(databaseUrl);
    const rows = await sql`SELECT presence_heartbeat(${sessionId}::uuid) AS online`;
    const online = rows && rows[0] ? Number(rows[0].online) : 0;
    return res.status(200).json({
      online: Number.isFinite(online) ? online : 0
    });
  } catch (err) {
    console.error("presence_heartbeat failed", err && err.message ? err.message : err);
    return res.status(502).json({ error: "upstream" });
  }
};
