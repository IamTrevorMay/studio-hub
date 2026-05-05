/**
 * Chainable Supabase mock factory.
 * Usage:
 *   const { supabase, mockQuery } = createMockSupabase({ data: [...], error: null });
 *   jest.mock('../../supabaseClient', () => ({ supabase: mockQuery.__supabase }));
 */

export function createMockSupabase(mockData = null, mockError = null) {
  const result = { data: mockData, error: mockError };

  // Chainable query proxy — any method returns itself, final await resolves to result
  function createChain() {
    const chain = new Proxy(
      { then: (resolve) => resolve(result) },
      {
        get(target, prop) {
          if (prop === 'then') return (resolve) => resolve(result);
          return () => chain;
        },
      }
    );
    return chain;
  }

  const authState = {
    session: { access_token: 'mock-token', user: { id: 'user-1' } },
    user: { id: 'user-1' },
  };

  const listeners = [];

  const supabase = {
    from: () => createChain(),
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: authState.session }, error: null }),
      refreshSession: jest.fn().mockResolvedValue({ data: { session: authState.session }, error: null }),
      getUser: jest.fn().mockResolvedValue({ data: { user: authState.user }, error: null }),
      onAuthStateChange: jest.fn((cb) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    })),
    removeChannel: jest.fn(),
  };

  return { supabase, result, authState, listeners };
}
