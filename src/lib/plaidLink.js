// Plaid Link loader. Loads the Link script from Plaid's CDN on demand and
// opens the Link flow. No npm dependency — the script is a stable singleton.

const PLAID_SCRIPT_URL = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

let scriptPromise = null;

function loadPlaidScript() {
  if (window.Plaid) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PLAID_SCRIPT_URL;
    s.onload = resolve;
    s.onerror = () => { scriptPromise = null; reject(new Error('Failed to load Plaid Link')); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

// Opens Plaid Link. onSuccess(public_token, metadata) fires when the user
// finishes; onExit(err) when they bail or Link errors.
export async function openPlaidLink({ token, onSuccess, onExit }) {
  await loadPlaidScript();
  const handler = window.Plaid.create({
    token,
    onSuccess: (publicToken, metadata) => onSuccess(publicToken, metadata),
    onExit: (err) => { if (onExit) onExit(err); },
  });
  handler.open();
  return handler;
}
