// Shared shape for every editor API response, so the client only ever has to
// read `error` on a failure.
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Nothing here is cacheable and one stale post list is one post silently
      // overwritten.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex"
    }
  });
}

export function fail(message, status = 400) {
  return json({ error: message }, status);
}
