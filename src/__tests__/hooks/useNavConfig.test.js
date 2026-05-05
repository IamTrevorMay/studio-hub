import { renderHook, act, waitFor } from '@testing-library/react';

// Mock supabaseClient
jest.mock('../../supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: () => ({
          single: () => Promise.resolve({ data: { id: 'row-1', config: { items: [] } }, error: null }),
        }),
      }),
    }),
    channel: () => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis() }),
    removeChannel: jest.fn(),
  },
}));

const useNavConfig = require('../../hooks/useNavConfig').default;

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'projects', label: 'Projects' },
  { key: 'analytics', label: 'Analytics', adminOnly: true },
  { key: 'calendar', label: 'Calendar' },
  { key: 'resources', label: 'Resources' },
];

describe('useNavConfig – getResolvedNav', () => {
  it('returns exactly 6 items for freelancer role', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, false, false, true);
    expect(nav).toHaveLength(6);
    expect(nav.map((i) => i.key)).toEqual([
      'fl_dashboard', 'fl_hours', 'resources', 'assets', 'fl_profile', 'fl_notifications',
    ]);
  });

  it('returns exactly 2 items for partner role', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, false, true, false);
    expect(nav).toHaveLength(2);
    expect(nav[0].key).toBe('dashboard');
    expect(nav[1].key).toBe('business_dev');
  });

  it('returns code items filtered by admin role when config is empty', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, false, false, false);
    expect(nav.find((i) => i.key === 'analytics')).toBeUndefined();
    expect(nav).toHaveLength(4);
  });

  it('includes admin-only items for admin users with empty config', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, true, false, false);
    expect(nav.find((i) => i.key === 'analytics')).toBeDefined();
    expect(nav).toHaveLength(5);
  });

  it('appends code items not in config at end', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, true, false, false);
    expect(nav).toHaveLength(5);
  });

  it('hides admin-only items from non-admin when config has items', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, false, false, false);
    const adminItems = nav.filter((i) => i.adminOnly);
    expect(adminItems).toHaveLength(0);
  });
});
