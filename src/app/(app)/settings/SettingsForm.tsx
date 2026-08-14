'use client';

import { useState, useTransition } from 'react';
import { setEmailOptin, setDisplayName } from './actions';

export default function SettingsForm({ name, optin }: { name: string; optin: boolean }) {
  const [displayName, setName] = useState(name);
  const [emails, setEmails] = useState(optin);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [, startTransition] = useTransition();

  function flash(msg: string, err?: boolean) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2600);
  }

  function toggleEmails(next: boolean) {
    setEmails(next);
    startTransition(async () => {
      const res = await setEmailOptin(next);
      if (!res.ok) { setEmails(!next); flash(res.error ?? 'Could not save', true); }
      else flash(next ? 'Reminders back on' : 'Reminders off');
    });
  }

  function saveName(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await setDisplayName(displayName);
      flash(res.ok ? 'Name updated' : res.error ?? 'Could not save', !res.ok);
    });
  }

  return (
    <>
      <div className="card">
        <div className="card-hd"><h2>Emails</h2></div>
        <div className="card-bd">
          <label className="optin" style={{ marginBottom: 0, cursor: 'pointer' }}>
            <input type="checkbox" checked={emails} onChange={(e) => toggleEmails(e.target.checked)} />
            <span style={{ color: 'var(--ink)' }}>
              <strong>Deadline reminders and the results round-up</strong><br />
              <span style={{ color: 'var(--muted)' }}>
                A nudge 24 hours and 1 hour before each deadline, but only if you haven&apos;t finished
                your entry. Plus the results and standings once the Gameweek is settled.
              </span>
            </span>
          </label>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12 }}>
            Turning these off doesn&apos;t affect your predictions or your points — you just won&apos;t be chased.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-hd"><h2>Display name</h2></div>
        <div className="card-bd">
          <form onSubmit={saveName} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
              <label htmlFor="dn">How you appear on the leaderboard</label>
              <input id="dn" value={displayName} maxLength={30} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn" type="submit" disabled={displayName.trim() === name}>Save</button>
          </form>
        </div>
      </div>

      {toast && <div className={`toast${toast.err ? ' err' : ''}`}>{toast.msg}</div>}
    </>
  );
}
