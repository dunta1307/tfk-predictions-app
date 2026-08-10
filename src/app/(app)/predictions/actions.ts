'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult { ok: boolean; error?: string }

/**
 * Both of these call Postgres functions rather than writing to the tables
 * directly. The lock rules live in those functions, so they hold even if
 * someone bypasses the UI entirely.
 */

export async function savePrediction(
  fixtureId: number, home: number, away: number
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_prediction', {
    p_fixture: fixtureId, p_home: home, p_away: away
  });
  if (error) return { ok: false, error: cleanup(error.message) };
  revalidatePath('/predictions');
  return { ok: true };
}

export async function setCaptain(gameweek: number, fixtureId: number | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_captain', {
    p_gameweek: gameweek, p_fixture: fixtureId
  });
  if (error) return { ok: false, error: cleanup(error.message) };
  revalidatePath('/predictions');
  return { ok: true };
}

/** Postgres prefixes raised exceptions; show the human part only. */
function cleanup(message: string): string {
  return message.replace(/^.*?(?:ERROR|error):\s*/i, '').trim() || 'Could not save.';
}
