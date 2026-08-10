'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setNotice(null); setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    const displayName = String(form.get('display_name') ?? '').trim();
    const optin = form.get('email_optin') === 'on';
    const supabase = createClient();

    try {
      if (isRegister) {
        if (displayName.length < 2) throw new Error('Enter a display name.');
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { display_name: displayName, email_optin: optin } }
        });
        if (error) throw error;
        setNotice('Account created. Check your email to confirm, then sign in.');
        setBusy(false);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push(params.get('next') ?? '/predictions');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="mark">TFK</div>
          <div>
            <h1>TFK Predictions League</h1>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Premier League 2026/27
            </div>
          </div>
        </div>
        <p className="tagline">Predict every scoreline. Pick a captain. Win the month.</p>

        {error && <div className="notice err" style={{ marginBottom: 14 }}><div>{error}</div></div>}
        {notice && <div className="notice info" style={{ marginBottom: 14 }}><div>{notice}</div></div>}

        <form onSubmit={onSubmit}>
          {isRegister && (
            <div className="field">
              <label htmlFor="display_name">Display name</label>
              <input id="display_name" name="display_name" required minLength={2} maxLength={30}
                placeholder="How you'll appear on the leaderboard" autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required placeholder="you@email.com" autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required minLength={8}
              placeholder={isRegister ? 'At least 8 characters' : ''}
              autoComplete={isRegister ? 'new-password' : 'current-password'} />
          </div>
          {isRegister && (
            <label className="optin">
              <input type="checkbox" name="email_optin" defaultChecked />
              <span>Email me deadline reminders (24 hours and 1 hour before) and the weekly results
                round-up. You can change this any time in Settings.</span>
            </label>
          )}
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="auth-switch">
          {isRegister
            ? <>Already have an account? <Link href="/login">Sign in</Link></>
            : <>Don&apos;t have an account? <Link href="/register">Create one</Link></>}
        </div>
      </div>
    </div>
  );
}
