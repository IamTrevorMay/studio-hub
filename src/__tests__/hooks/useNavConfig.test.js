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
  it('returns the locked contractor nav (no drive folder, non-editor sub-role)', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, false, false, true, { sub_role: 'Writer' });
    expect(nav.map((i) => i.key)).toEqual([
      'fl_dashboard', 'fl_submit', 'pitch_videos', 'fl_documents',
      'channels', 'messages', 'fl_profile', 'fl_notifications',
    ]);
  });

  it('includes fl_reviews for contractors with an editor sub-role', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, false, false, true, { sub_role: 'Long Form Editor' });
    expect(nav.map((i) => i.key)).toContain('fl_reviews');
    const navNonEditor = result.current.getResolvedNav(NAV_ITEMS, false, false, true, { sub_role: 'Graphic Designer' });
    expect(navNonEditor.map((i) => i.key)).not.toContain('fl_reviews');
  });

  it('includes fl_assignments when the contractor has a drive folder', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, false, false, true, { assigned_drive_folder_id: 'abc' });
    expect(nav.map((i) => i.key)).toContain('fl_assignments');
  });

  it('returns the locked client nav (no Notifications tab)', async () => {
    const { result } = renderHook(() => useNavConfig());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const nav = result.current.getResolvedNav(NAV_ITEMS, false, false, false, null, new Set(), true);
    expect(nav.map((i) => i.key)).toEqual([
      'cl_dashboard', 'cl_calendar', 'cl_review', 'messages',
      'cl_documents', 'cl_profile',
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
