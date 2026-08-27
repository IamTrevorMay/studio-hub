import { readViewAsBoot, endViewAs, createReadOnlyFetch } from '../../lib/viewAs';

// The "View as…" handoff moves a minted access token between tabs through
// localStorage. These cover the rules that keep it from leaking: it is
// consumed exactly once, it only applies to a tab that asked for it, and an
// expired token never boots a preview.

const HANDOFF_KEY = 'mayday-view-as-handoff';
const SESSION_KEY = 'mayday-view-as-session';

function payload({ expiresInSec = 3600 } = {}) {
  return {
    session: {
      access_token: 'fake-token',
      expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    },
    target: { id: 'user-1', full_name: 'Jacob Pereira', role: 'member' },
  };
}

function setSearch(search) {
  delete window.location;
  window.location = { search, origin: 'https://studio.test', replace: jest.fn() };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setSearch('');
});

test('a normal tab never picks up a pending handoff', () => {
  window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload()));
  expect(readViewAsBoot()).toBeNull();
  // and it is left intact for the tab that was actually opened for it
  expect(window.localStorage.getItem(HANDOFF_KEY)).not.toBeNull();
});

test('a preview tab consumes the handoff exactly once', () => {
  window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload()));
  setSearch('?view_as=1');

  const first = readViewAsBoot();
  expect(first?.target?.full_name).toBe('Jacob Pereira');
  expect(window.localStorage.getItem(HANDOFF_KEY)).toBeNull();

  // A second tab opened with the same URL gets nothing.
  window.sessionStorage.clear();
  expect(readViewAsBoot()).toBeNull();
});

test('the preview survives a reload of its own tab', () => {
  window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload()));
  setSearch('?view_as=1');
  readViewAsBoot();

  // Reload: no query param, no handoff — only this tab's sessionStorage.
  setSearch('');
  expect(readViewAsBoot()?.target?.id).toBe('user-1');
});

test('an expired token does not boot a preview', () => {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload({ expiresInSec: -60 })));
  expect(readViewAsBoot()).toBeNull();
});

test('a malformed handoff is discarded, not thrown', () => {
  window.localStorage.setItem(HANDOFF_KEY, 'not-json');
  setSearch('?view_as=1');
  expect(readViewAsBoot()).toBeNull();
  expect(window.localStorage.getItem(HANDOFF_KEY)).toBeNull();
});

test('endViewAs clears the tab session', () => {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload()));
  endViewAs();
  expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
});

describe('read-only guard', () => {
  const base = jest.fn();
  const guarded = createReadOnlyFetch(base);
  const API = 'https://x.supabase.co';

  // CRA's jest config sets resetMocks: true, so the implementation has to be
  // re-attached for every test, not just declared once.
  beforeEach(() => {
    base.mockReset();
    base.mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
  });

  test.each([
    ['DELETE', `${API}/rest/v1/calendar_events?id=eq.1`],
    ['PATCH', `${API}/rest/v1/profiles?id=eq.1`],
    ['PUT', `${API}/rest/v1/projects`],
    ['POST', `${API}/rest/v1/messages`],
    ['POST', `${API}/auth/v1/logout`],
    ['POST', `${API}/storage/v1/object/whiteboard-images/a.png`],
  ])('blocks %s %s without touching the network', async (method, url) => {
    const res = await guarded(url, { method });
    expect(res.status).toBe(403);
    expect(base).not.toHaveBeenCalled();
  });

  test.each([
    ['GET', `${API}/rest/v1/projects?select=id`],
    ['HEAD', `${API}/rest/v1/projects`],
    ['POST', `${API}/rest/v1/rpc/get_notification_summary`],
    ['POST', `${API}/storage/v1/object/sign/client-documents/a.pdf`],
  ])('passes %s %s through', async (method, url) => {
    const res = await guarded(url, { method });
    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(1);
  });

  test('defaults to GET when no method is given', async () => {
    await guarded(`${API}/rest/v1/projects`);
    expect(base).toHaveBeenCalledTimes(1);
  });

  test('reads the method off a Request-like object', async () => {
    const res = await guarded({ url: `${API}/rest/v1/projects`, method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(base).not.toHaveBeenCalled();
  });
});
