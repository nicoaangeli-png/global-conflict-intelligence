import { NextResponse, type NextRequest } from "next/server";

/** Nonce unique pour le document HTML. Next.js le reprend pour ses scripts d'hydratation. */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "manifest-src 'self'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  headers.set("x-nonce", nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Les pages 404 utilisent aussi l'hydratation Next ; exclure seulement API et assets.
export const config = { matcher: "/((?!api|_next/static|_next/image|data|favicon.ico).*)" };
