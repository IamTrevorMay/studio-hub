const mockGetSession = jest.fn();
jest.mock('../supabaseClient', () => ({ supabase: { auth: { getSession: (...args) => mockGetSession(...args) } }, VIEW_AS: { active: false } }));

beforeEach(() => {
  jest.resetModules(); sessionStorage.clear();
  process.env.REACT_APP_FLIGHTLINE_SERVICE_URL = 'https://flightline.example';
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'private-session-token' } } });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 'one-time-code' }) });
  Object.defineProperty(global, 'crypto', { configurable: true, value: { randomUUID: () => 'test-terminal-identity' } });
});

test('handoff uses bearer header and a fixed return origin, never tokens in URLs', async () => {
  const { completeFlightlineHandoff } = require('./flightline');
  const result = await completeFlightlineHandoff(`?state=${'s'.repeat(43)}&challenge=${'c'.repeat(43)}&redirect=https://attacker.example`);
  expect(result).toMatch(/^https:\/\/flightline.example\/#mayday_code=/);
  expect(result).not.toContain('private-session-token');
  expect(result).not.toContain('attacker');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer private-session-token');
  expect(fetch.mock.calls[0][1].credentials).toBe('omit');
});

test('invalid handoff is rejected before any network call', async () => {
  const { completeFlightlineHandoff } = require('./flightline');
  await expect(completeFlightlineHandoff('?state=x')).rejects.toThrow('expired');
  expect(fetch).not.toHaveBeenCalled();
});

test('unauthenticated users cannot send API requests', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null } });
  const { flightline } = require('./flightline');
  await expect(flightline('/projects')).rejects.toThrow('Sign in');
  expect(fetch).not.toHaveBeenCalled();
});

test('preview mode cannot bypass Mayday read-only restrictions', async () => {
  const { VIEW_AS } = require('../supabaseClient'); VIEW_AS.active = true;
  const { flightline } = require('./flightline');
  await expect(flightline('/projects', { method: 'POST' })).rejects.toThrow('preview mode');
  expect(fetch).not.toHaveBeenCalled();
});

test('service origin rejects insecure URLs and embedded credentials', () => {
  process.env.REACT_APP_FLIGHTLINE_SERVICE_URL = 'https://secret:password@flightline.example';
  expect(require('./flightline').FLIGHTLINE_ORIGIN).toBe('');
});
