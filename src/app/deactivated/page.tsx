export const metadata = { title: 'Account deactivated · TFK Predictions League' };

export default function DeactivatedPage() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="mark">TFK</div>
          <div><h1>TFK Predictions League</h1></div>
        </div>
        <p className="tagline" style={{ marginBottom: 16 }}>Your account has been deactivated.</p>
        <div className="notice warn" style={{ marginBottom: 18 }}>
          <div>
            Your predictions, points and league position are all still there — you just can&apos;t
            sign in at the moment. Have a word with Donnacha if that&apos;s not what you expected.
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button className="btn ghost" type="submit" style={{ width: '100%', justifyContent: 'center' }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
