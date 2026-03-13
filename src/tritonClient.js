import { createClient } from '@supabase/supabase-js';

const tritonUrl = process.env.REACT_APP_TRITON_SUPABASE_URL;
const tritonAnonKey = process.env.REACT_APP_TRITON_SUPABASE_ANON_KEY;

// Read-only Supabase client for Triton data (briefs, etc.)
export const tritonSupabase = tritonUrl && tritonAnonKey
  ? createClient(tritonUrl, tritonAnonKey)
  : null;
