import { verifyAccessJwt, forbidden } from "../../src/lib/access.js";

// Runs before every /api/* Function. Cloudflare Access guards the edge; this is
// the Function checking the assertion itself, so a request that reaches the
// worker another way -- a preview deployment, a path the Access application
// does not cover -- gets a 403 rather than my repo.
export const onRequest = async (context) => {
  const result = await verifyAccessJwt(context.request, context.env);
  if (!result.ok) return forbidden(result.reason);
  context.data.email = result.email;
  return context.next();
};
