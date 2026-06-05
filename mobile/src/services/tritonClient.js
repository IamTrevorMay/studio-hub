import { createClient } from '@supabase/supabase-js';

const tritonUrl = process.env.EXPO_PUBLIC_TRITON_SUPABASE_URL;
const tritonAnonKey = process.env.EXPO_PUBLIC_TRITON_SUPABASE_ANON_KEY;

if (!tritonUrl || !tritonAnonKey) {
  throw new Error(
    'Missing Triton Supabase environment variables. Set EXPO_PUBLIC_TRITON_SUPABASE_URL and EXPO_PUBLIC_TRITON_SUPABASE_ANON_KEY.'
  );
}

// Read-only Supabase client for Triton data (briefs, cards)
export const tritonSupabase = createClient(tritonUrl, tritonAnonKey);
