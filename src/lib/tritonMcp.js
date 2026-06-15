const MCP_BASE = process.env.REACT_APP_TRITON_MCP_URL || 'https://mcp.tritonapex.io';
const MCP_ENDPOINT = `${MCP_BASE}/mcp`;
const HEALTH_ENDPOINT = `${MCP_BASE}/health`;

let sessionId = null;
let msgId = 0;

function nextId() {
  msgId += 1;
  return msgId;
}

/**
 * Parse an SSE-style response body.
 * The MCP server streams JSON-RPC results as `data:` lines.
 * We grab the last `data:` line (the final result) and JSON-parse it.
 * Falls back to plain JSON parsing if no SSE format detected.
 */
function parseSSEResponse(text) {
  const lines = text.split('\n');
  let lastData = null;
  for (const line of lines) {
    if (line.startsWith('data:')) {
      lastData = line.slice(5).trim();
    }
  }
  if (lastData) {
    return JSON.parse(lastData);
  }
  // Fallback: plain JSON
  return JSON.parse(text);
}

async function rpcCall(method, params) {
  const body = {
    jsonrpc: '2.0',
    id: nextId(),
    method,
    params: params || {},
  };
  if (sessionId) {
    body.params._meta = { ...(body.params._meta || {}), sessionId };
  }
  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`MCP request failed (${res.status}): ${errText}`);
  }
  const text = await res.text();
  const parsed = parseSSEResponse(text);
  if (parsed.error) {
    throw new Error(parsed.error.message || JSON.stringify(parsed.error));
  }
  return parsed;
}

async function initSession() {
  const result = await rpcCall('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'mayday-studio', version: '1.0.0' },
  });
  if (result.result?.sessionId) {
    sessionId = result.result.sessionId;
  }
  // Also try session ID from the response-level meta
  if (result._meta?.sessionId) {
    sessionId = result._meta.sessionId;
  }
  return result;
}

function isSessionError(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('session') || msg.includes('not initialized') || msg.includes('unknown session');
}

/**
 * GET /health — returns true if MCP server is reachable.
 */
export async function checkHealth() {
  try {
    const res = await fetch(HEALTH_ENDPOINT, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Returns true if a session has been established.
 */
export function hasActiveSession() {
  return sessionId !== null;
}

/**
 * Generic tool caller with auto-session initialization and one retry on session errors.
 */
export async function callTool(name, args) {
  if (!sessionId) {
    await initSession();
  }
  try {
    const result = await rpcCall('tools/call', { name, arguments: args || {} });
    return result.result || result;
  } catch (err) {
    if (isSessionError(err)) {
      // Reset session and retry once
      sessionId = null;
      await initSession();
      const result = await rpcCall('tools/call', { name, arguments: args || {} });
      return result.result || result;
    }
    throw err;
  }
}

/**
 * Convenience: query_database tool
 */
export async function queryDatabase(queryText) {
  return callTool('query_database', { query: queryText });
}

/**
 * Convenience: search_players tool
 */
export async function searchPlayers(name) {
  return callTool('search_players', { name });
}

/**
 * Convenience: get_player_stats tool
 */
export async function getPlayerStats(playerId, season) {
  const args = { player_id: playerId };
  if (season) args.season = season;
  return callTool('get_player_stats', args);
}
