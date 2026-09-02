import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

const PUBLIC = ['/login', '/register', '/auth', '/unsubscribe', '/deactivated'];

/**
 * Auth check, timeboxed.
 *
 * The 504s were caused by supabase.auth.getUser() making a network call on
 * every request and occasionally not answering. Vercel kills middleware at
 * 25 seconds, so a slow auth server took the whole site down.
 *
 * The fix is ONLY the timeout. An earlier attempt swapped in getClaims() for
 * local JWT verification, which is faster in theory but broke sign-in, so it
 * has been reverted. getUser() is also what refreshes the session cookie —
 * without it in middleware, people get silently logged out after an hour.
 *
 * If auth does not answer within 4 seconds we let the request through rather
 * than hanging. That is safe: middleware is a fast pre-filter for redirects,
 * and the real gate is unchanged — every page calls getUser() in its server
 * component and redirects, with row level security underneath.
 */
const AUTH_TIMEOUT_MS = 4000;

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

  // null means "could not tell in time" — fail open and let the page decide.
  let signedIn: boolean | null = null;
  try {
    signedIn = await withTimeout(
      supabase.auth.getUser().then(({ data }) => !!data.user),
      AUTH_TIMEOUT_MS
    );
  } catch {
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

/** Races a promise against a timer, and always clears the timer. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('auth timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export const config = {
  // `api` must stay excluded — API routes do their own auth, and middleware
  // would redirect machine requests to the login page instead of running them.
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'
  ]
};
