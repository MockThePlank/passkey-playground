import './env.js';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import secureSession from '@fastify/secure-session';
import { authRoutes } from './routes/auth.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production!';

async function main() {
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // ─── Session Plugin ──────────────────────────────────────────────
  await fastify.register(secureSession, {
    // The cookie cipher needs exactly 32 bytes; hashing gives that for a
    // secret of any length without throwing part of it away
    key: createHash('sha256').update(SESSION_SECRET).digest(),
    cookie: {
      path: '/',
      httpOnly: true,
      secure: IS_PRODUCTION, // Production runs behind HTTPS
      sameSite: 'lax',
      maxAge: 60 * 60 * 24, // 24 hours
    },
  });

  // ─── Auth Routes ─────────────────────────────────────────────────
  await fastify.register(authRoutes, { prefix: '/api/auth' });

  // ─── Health Check ────────────────────────────────────────────────
  fastify.get('/api/health', async () => ({ status: 'ok' }));

  // ─── Start ───────────────────────────────────────────────────────
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\n🚀 Server running at http://${HOST}:${PORT}\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
