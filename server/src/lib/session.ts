import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ─── Session Data Shape ──────────────────────────────────────────────
declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string;
    username: string;
    // Challenge storage for WebAuthn ceremonies
    challenge: string;
    // Username requested by a registration that has not been verified yet
    pendingUsername: string;
  }
}

// ─── Auth Guard ──────────────────────────────────────────────────────
export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
) {
  const userId = request.session.get('userId');
  if (!userId) {
    reply.code(401).send({ error: 'Not authenticated' });
    return;
  }
  done();
}
