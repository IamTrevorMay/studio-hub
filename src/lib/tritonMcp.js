import { supabase } from '../supabaseClient';

const PROXY_URL = '/api/triton-mcp';

let sessionId = null;
let msgId = 0;

function nextId() {
  msgId += 1;
  return msgId;
}

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return `Bearer ${session.access_token}`;
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
    const trimmed = line.startsWith('data: ') ? line.slice(6).trim()
      : line.startsWith('data:') ? line.slice(5).trim()
      : null;
    if (trimmed) lastData = trimmed;
  }
  if (lastData) {
    return JSON.parse(lastData);
  }
  // Fallback: plain JSON
  return JSON.parse(text);
}

async function rpcCall(method, params) {
  const payload = {
    jsonrpc: '2.0',
    id: nextId(),
    method,
    params: params || {},
  };
  const auth = await getAuthHeader();

  // Send sessionId alongside the payload so the proxy can forward it
  // as the mcp-session-id header to the upstream MCP server.
  const reqBody = { action: 'rpc', payload };
  if (sessionId) {
    reqBody.sessionId = sessionId;
  }

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`MCP request failed (${res.status}): ${errText}`);
  }

  // Capture session ID from the proxy's response header
  const returnedSession = res.headers.get('x-mcp-session-id');
  if (returnedSession) {
    sessionId = returnedSession;
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
  return result;
}

function isSessionError(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('session') || msg.includes('not initialized') || msg.includes('unknown session');
}

/**
 * Health check via proxy — returns true if MCP server is reachable.
 */
export async function checkHealth() {
  try {
    const auth = await getAuthHeader();
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ action: 'health' }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
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
  return callTool('query_database', { sql: queryText });
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
export async function getPlayerStats(playerId, type, season) {
  const args = { player_id: playerId, type: type || 'hitter' };
  if (season) args.season = season;
  return callTool('get_player_stats', args);
}
