// Cloudflare Access puts a signed JWT on every request it lets through. This
// verifies it inside the Function.
//
// Access already blocks unauthenticated requests at the edge for the routes its
// policy covers -- but the Function is a worker, and a worker is reachable by
// anything that reaches the project: a preview deployment on *.pages.dev, a
// route the Access application's path list does not actually match, a
// misconfiguration I make later in the dashboard. The edge check is the lock;
// this is the Function refusing to open for anyone who did not come through it.

const CERT_TTL_MS = 60 * 60 * 1000;

// Module scope, so it survives between requests on a warm isolate and is simply
// refetched on a cold one. No KV, nothing to invalidate.
let cache = { url: "", keys: null, fetchedAt: 0 };

function base64urlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(part)));
}

async function getKeys(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const fresh = cache.url === url && cache.keys && Date.now() - cache.fetchedAt < CERT_TTL_MS;
  if (fresh) return cache.keys;

  const response = await fetch(url, { cf: { cacheTtl: 3600 } });
  if (!response.ok) throw new Error(`could not fetch Access certs (${response.status})`);
  const body = await response.json();
  if (!body || !Array.isArray(body.keys)) throw new Error("Access certs response had no keys");

  cache = { url, keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

/**
 * Returns { ok: true, email } or { ok: false, reason }. Never throws for a bad
 * token: a bad token is an answer, not an accident.
 */
export async function verifyAccessJwt(request, env) {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD;
  if (!teamDomain || !aud) {
    return { ok: false, reason: "server is missing CF_ACCESS_TEAM_DOMAIN or CF_ACCESS_AUD" };
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    readCookie(request.headers.get("Cookie"), "CF_Authorization");
  if (!token) return { ok: false, reason: "no Access token on the request" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed Access token" };

  let header;
  let payload;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: "unreadable Access token" };
  }

  if (header.alg !== "RS256") return { ok: false, reason: `unexpected token algorithm ${header.alg}` };

  let keys;
  try {
    keys = await getKeys(teamDomain);
  } catch (error) {
    return { ok: false, reason: error.message };
  }

  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return { ok: false, reason: "token was signed by an unknown key" };

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch (error) {
    return { ok: false, reason: `could not verify signature: ${error.message}` };
  }
  if (!verified) return { ok: false, reason: "token signature did not verify" };

  // The aud claim is the whole point of checking: a valid token from another
  // application in the same Access team is still not a token for this one.
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(aud)) return { ok: false, reason: "token was issued for another application" };

  if (payload.iss !== `https://${teamDomain}`) return { ok: false, reason: "token came from another team" };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return { ok: false, reason: "token has expired" };
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return { ok: false, reason: "token is not valid yet" };

  const email = typeof payload.email === "string" ? payload.email : "";
  // Belt and braces: the Access policy is the list of who may in, and this is
  // the same list written where I can read it in the repo. Unset means "trust
  // the policy", which is the honest default -- an empty check is not a check.
  if (env.ADMIN_EMAIL && email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
    return { ok: false, reason: "that account is not allowed here" };
  }

  return { ok: true, email };
}

function readCookie(header, name) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function forbidden(reason) {
  return new Response(JSON.stringify({ error: `forbidden: ${reason}` }), {
    status: 403,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
