'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A sub-tab that knows whether it is the current page. */
export default function SubLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  // `/admin` should only light up on exactly /admin, not on every child route.
  const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
  return <Link href={href} className={`subtab${active ? ' on' : ''}`}>{children}</Link>;
}
