// ─── Single-Use Challenges ───────────────────────────────────────────
//
// The session lives entirely in the cookie, so the server cannot take a
// challenge back out of a copy of that cookie. Without this list, a captured
// cookie plus the matching WebAuthn response could be sent a second time.
//
// Every challenge handed out is noted here and removed on its first use.
// The list is in memory: enough for one server process, as in this demo.
// Several instances would need a shared store such as Redis.

const TTL_MS = 5 * 60 * 1000;

const pending = new Map<string, number>();

export function rememberChallenge(challenge: string) {
  const now = Date.now();
  for (const [key, expiresAt] of pending) {
    if (expiresAt <= now) pending.delete(key);
  }
  pending.set(challenge, now + TTL_MS);
}

/** Returns true once per challenge, and only before it expires. */
export function consumeChallenge(challenge: string): boolean {
  const expiresAt = pending.get(challenge);
  pending.delete(challenge);
  return expiresAt !== undefined && expiresAt > Date.now();
}
