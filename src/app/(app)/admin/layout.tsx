import SubLink from '@/components/SubLink';
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
        <SubLink href="/admin">Status</SubLink>
        <SubLink href="/admin/players">Players</SubLink>
        <SubLink href="/admin/results">Results</SubLink>
        <SubLink href="/admin/predictions">Picks</SubLink>
        <SubLink href="/admin/emails">Emails</SubLink>
        <SubLink href="/admin/bot">Bot</SubLink>
      </div>
      {children}
    </>
  );
}
