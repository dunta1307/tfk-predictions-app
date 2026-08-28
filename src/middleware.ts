import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PUBLIC = ['/login', '/register', '/auth', '/unsubscribe', '/deactivated'];

/**
 * Middleware must never be the slow part of a page load.
 *
 * supabase.auth.getUser() makes a NETWORK CALL to Supabase's auth server on
 * every single request. When that server is slow, the middleware hangs and
 * Vercel kills the request at 25 seconds — a 504 on a site that is otherwise
 * fine. That is what was happening.
 *
 * So:
 *   1. getClaims() verifies the JWT locally, no network call in the normal case.
 *   2. getUser() is only called when the token is close to expiring and
 *      genuinely needs refreshing.
 *   3. Everything is timeboxed. If auth is slow we let the request through
 *      rather than hanging.
 *
 * Point 3 is safe because middleware is only a fast pre-filter for redirects.
 * The real gate is unchanged: every page calls getUser() in its server
 * component and redirects, and the database enforces row level security
 * regardless. Nobody sees another player's predictions because middleware
 * waved them past.
 */
const AUTH_TIMEOUT_MS = 3000;
const REFRESH_IF_EXPIRING_WITHIN_S = 300;   // 5 minutes

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: CookieToSet[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path.startsWith(p));

  let signedIn: boolean | null = null;   // null = we could not tell in time

  try {
    signedIn = await withTimeout(resolveSignedIn(supabase), AUTH_TIMEOUT_MS);
  } catch {
    // Auth was slow or errored. Fail open — the page will do the real check.
    signedIn = null;
  }

  if (signedIn === false && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  if (signedIn === true && (path === '/login' || path === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/predictions';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

type SupabaseClient = ReturnType<typeof createServerClient>;

async function resolveSignedIn(supabase: SupabaseClient): Promise<boolean> {
  // Fast path: verify the JWT locally.
  try {
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims as { sub?: string; exp?: number } | undefined;
    if (claims?.sub) {
      const secondsLeft = claims.exp ? claims.exp - Math.floor(Date.now() / 1000) : 0;
      if (secondsLeft > REFRESH_IF_EXPIRING_WITHIN_S) return true;
      // Close to expiry — fall through so getUser() refreshes the cookie.
    } else if (claims === null || claims === undefined) {
      // No usable token at all; confirm with the slower call below.
    }
  } catch {
    // getClaims unavailable (older project keys) — fall back.
  }

  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('auth timeout')), ms))
  ]);
}

export const config = {
  // `api` must stay excluded — API routes do their own auth, and middleware
  // would redirect machine requests to the login page instead of running them.
  matcher: [
    '/((?!api|_next/static|_next/image|_next/data|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2)$).*)'
  ]
};
