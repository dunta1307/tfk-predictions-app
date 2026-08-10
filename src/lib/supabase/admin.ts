import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses row level security.
 * Only ever import this from route handlers or server actions — never from
 * anything that could end up in a client bundle.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
