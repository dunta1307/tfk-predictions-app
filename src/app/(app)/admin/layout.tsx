import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();   // redirects away if you are not one
  return (
    <>
      <div className="notice info" style={{ marginBottom: 18 }}>
        <div><strong>Admin.</strong> Signed in as {admin.email}. Only accounts flagged as admin can
        see this — everything here is also enforced in the database, not just hidden.</div>
      </div>
      <div className="subtabs">
        <Link href="/admin" className="subtab">Status</Link>
        <Link href="/admin/players" className="subtab">Players</Link>
        <Link href="/admin/results" className="subtab">Results</Link>
        <Link href="/admin/emails" className="subtab">Emails</Link>
      </div>
      {children}
    </>
  );
}
