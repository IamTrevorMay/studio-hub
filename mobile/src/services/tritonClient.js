import { createClient } from '@supabase/supabase-js';

const tritonUrl = process.env.EXPO_PUBLIC_TRITON_SUPABASE_URL || 'https://xgzxfsqwtemlcosglhzr.supabase.co';
const tritonAnonKey = process.env.EXPO_PUBLIC_TRITON_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhnenhmc3F3dGVtbGNvc2dsaHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MjUwMzksImV4cCI6MjA4NzIwMTAzOX0.moB9yEprm_4libfN-m9bFbKyuCcp5EhQrx0DohsuuaQ';

// Read-only Supabase client for Triton data (briefs, cards)
export const tritonSupabase = tritonUrl && tritonAnonKey
  ? createClient(tritonUrl, tritonAnonKey)
  : null;
