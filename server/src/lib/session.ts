import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ─── Session Data Shape ──────────────────────────────────────────────
declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string;
    username: string;
    // Challenge storage for WebAuthn ceremonies
    challenge: string;
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
