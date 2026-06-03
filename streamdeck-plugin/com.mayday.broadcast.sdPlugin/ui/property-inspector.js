/**
 * Property inspector for the Mayday Broadcast Stream Deck plugin.
 *
 * Global settings (shared across all buttons): { baseUrl }
 * Per-button settings: { sessionId, assetId }
 */

let websocket = null;
let uuid = '';
let actionInfo = {};
let currentSettings = {};

function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
  uuid = inPropertyInspectorUUID;
  actionInfo = JSON.parse(inActionInfo);
  currentSettings = (actionInfo && actionInfo.payload && actionInfo.payload.settings) || {};

  if (currentSettings.sessionId) {
    document.getElementById('sessionId').value = currentSettings.sessionId;
  }

  websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);
  websocket.onopen = () => {
    websocket.send(JSON.stringify({ event: inRegisterEvent, uuid }));
    websocket.send(JSON.stringify({ event: 'getGlobalSettings', context: uuid }));
  };

  websocket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.event === 'didReceiveGlobalSettings') {
      const gs = (msg.payload && msg.payload.settings) || {};
      if (gs.baseUrl) {
        document.getElementById('baseUrl').value = gs.baseUrl;
        document.getElementById('connStatus').textContent = 'Saved';
        document.getElementById('connStatus').className = 'status ok';
      }
    }
  };
}

function saveConnection() {
  const baseUrl = document.getElementById('baseUrl').value.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    document.getElementById('connStatus').textContent = 'Enter a base URL';
    document.getElementById('connStatus').className = 'status err';
    return;
  }
  websocket.send(JSON.stringify({
    event: 'setGlobalSettings',
    context: uuid,
    payload: { baseUrl },
  }));
  document.getElementById('connStatus').textContent = 'Saved';
  document.getElementById('connStatus').className = 'status ok';
}

async function loadAssets() {
  const baseUrl = document.getElementById('baseUrl').value.trim().replace(/\/+$/, '');
  const sessionId = document.getElementById('sessionId').value.trim();
  const status = document.getElementById('loadStatus');
  if (!baseUrl || !sessionId) {
    status.textContent = 'Need base URL + session ID';
    status.className = 'status err';
    return;
  }
  try {
    const sessRes = await fetch(`${baseUrl}/api/broadcast/sessions?id=${encodeURIComponent(sessionId)}`);
    const sessJson = await sessRes.json();
    const session = sessJson.session;
    if (!session) { status.textContent = 'Session not found'; status.className = 'status err'; return; }

    const assetsRes = await fetch(`${baseUrl}/api/broadcast/assets?project_id=${encodeURIComponent(session.project_id)}`);
    const assetsJson = await assetsRes.json();
    const assets = assetsJson.assets || [];

    const select = document.getElementById('assetSelect');
    select.innerHTML = '<option value="">-- (no asset; slideshow_visible_* only) --</option>';
    for (const a of assets) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.hotkey_label || a.name;
      if (a.id === currentSettings.assetId) opt.selected = true;
      select.appendChild(opt);
    }
    currentSettings.sessionId = sessionId;
    status.textContent = `Loaded ${assets.length} assets`;
    status.className = 'status ok';
  } catch (e) {
    status.textContent = 'Failed: ' + e.message;
    status.className = 'status err';
  }
}

function saveSettings() {
  const assetId = document.getElementById('assetSelect').value;
  const sessionId = document.getElementById('sessionId').value.trim();
  const settings = { sessionId, assetId };
  websocket.send(JSON.stringify({
    event: 'setSettings',
    context: uuid,
    payload: settings,
  }));
  currentSettings = settings;
}

globalThis.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
