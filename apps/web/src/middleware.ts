import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher([
  '/setup(.*)',
  '/api/chat(.*)',
  '/api/setup-plan(.*)',
  '/api/activate-daily-assistant(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Root route: explicit middleware-level redirect (avoids RSC 500 + protect-rewrite 404)
  if (req.nextUrl.pathname === '/') {
    const { userId } = await auth();
    return NextResponse.redirect(new URL(userId ? '/setup' : '/sign-in', req.url));
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
