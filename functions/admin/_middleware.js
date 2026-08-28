import { verifyAccessJwt, forbidden } from "../../src/lib/access.js";

// The editor page itself holds no secrets -- it cannot do anything without the
// API, which checks the same token -- but there is no reason to serve it to an
// unauthenticated request either. Same check, one layer earlier.
export const onRequest = async (context) => {
  const result = await verifyAccessJwt(context.request, context.env);
  if (!result.ok) return forbidden(result.reason);

  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
};
