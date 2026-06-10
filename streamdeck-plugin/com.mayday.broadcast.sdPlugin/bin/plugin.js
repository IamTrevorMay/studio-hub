/**
 * Mayday Broadcast — Stream Deck Plugin
 *
 * Each button stores a session ID + asset ID + a base URL pointing at
 * the Mayday Vercel deployment. On press, the plugin POSTs to
 *   <BASE>/api/broadcast/trigger?sid=<session>&aid=<asset>&action=<action>
 * Session ID is the capability token for the API so no API key is needed.
 *
 * Global settings hold the BASE URL only (so it can be set once and reused
 * across every button); per-button settings hold the session + asset IDs.
 */

let websocket = null;
const buttonState = {}; // context → { baseUrl, sessionId, assetId, action, visible }
const globalSettings = {}; // { baseUrl }

const ACTION_TOGGLE         = 'com.mayday.broadcast.toggle-asset';
const ACTION_PLAY_VIDEO     = 'com.mayday.broadcast.play-video';
const ACTION_SLIDESHOW_NEXT = 'com.mayday.broadcast.slideshow-next';
const ACTION_SLIDESHOW_PREV = 'com.mayday.broadcast.slideshow-prev';

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
  websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);
  websocket.onopen = () => {
    websocket.send(JSON.stringify({ event: inRegisterEvent, uuid: inPluginUUID }));
    // Pull whatever global settings are saved (BASE URL).
    websocket.send(JSON.stringify({ event: 'getGlobalSettings', context: inPluginUUID }));
  };
  websocket.onmessage = (evt) => {
    try { handleMessage(JSON.parse(evt.data)); } catch { /* ignore */ }
  };
  websocket.onclose = () => {
    setTimeout(() => connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo), 5000);
  };
}

function handleMessage(msg) {
  const { event, context, payload, action } = msg;

  switch (event) {
    case 'keyDown':
      handleKeyPress(context, payload, action);
      break;

    case 'willAppear':
      buttonState[context] = {
        baseUrl:   globalSettings.baseUrl || '',
        sessionId: (payload && payload.settings && payload.settings.sessionId) || '',
        assetId:   (payload && payload.settings && payload.settings.assetId)   || '',
        action,
        visible: false,
      };
      break;

    case 'willDisappear':
      delete buttonState[context];
      break;

    case 'didReceiveSettings':
      if (payload && payload.settings) {
        buttonState[context] = {
          ...(buttonState[context] || {}),
          baseUrl: globalSettings.baseUrl || '',
          sessionId: payload.settings.sessionId || '',
          assetId:   payload.settings.assetId   || '',
          action,
        };
      }
      break;

    case 'didReceiveGlobalSettings':
      if (payload && payload.settings) {
        Object.assign(globalSettings, payload.settings);
        // Propagate baseUrl to every loaded button.
        for (const ctx of Object.keys(buttonState)) {
          buttonState[ctx].baseUrl = globalSettings.baseUrl || '';
        }
      }
      break;
  }
}

async function handleKeyPress(context, _payload, action) {
  const state = buttonState[context];
  if (!state) return;
  const base = (state.baseUrl || '').replace(/\/+$/, '');
  if (!base || !state.sessionId) {
    showAlert(context);
    return;
  }
  let triggerAction = null;
  let aidParam = state.assetId;
  if (action === ACTION_TOGGLE)         triggerAction = 'toggle';
  if (action === ACTION_PLAY_VIDEO)     triggerAction = 'toggle';
  if (action === ACTION_SLIDESHOW_NEXT) { triggerAction = state.assetId ? 'slideshow_next' : 'slideshow_visible_next'; }
  if (action === ACTION_SLIDESHOW_PREV) { triggerAction = state.assetId ? 'slideshow_prev' : 'slideshow_visible_prev'; }
  if (!triggerAction) return;

  const params = new URLSearchParams({ sid: state.sessionId, action: triggerAction });
  if (aidParam) params.set('aid', aidParam);
  const url = `${base}/api/broadcast/trigger?${params.toString()}`;
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[Mayday] trigger failed', body);
      showAlert(context);
      return;
    }
    if ('visible' in body && (action === ACTION_TOGGLE || action === ACTION_PLAY_VIDEO)) {
      websocket.send(JSON.stringify({
        event: 'setState',
        context,
        payload: { state: body.visible ? 1 : 0 },
      }));
      state.visible = !!body.visible;
    }
  } catch (e) {
    console.error('[Mayday] trigger error', e);
    showAlert(context);
  }
}

function showAlert(context) {
  if (!websocket) return;
  websocket.send(JSON.stringify({ event: 'showAlert', context }));
}

globalThis.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
