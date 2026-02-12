import './env.js';
import Fastify from 'fastify';
import secureSession from '@fastify/secure-session';
import { authRoutes } from './routes/auth.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || 'localhost';
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
    // Pad or truncate secret to exactly 32 bytes
    key: Buffer.from(SESSION_SECRET.padEnd(32, '0').slice(0, 32)),
    cookie: {
      path: '/',
      httpOnly: true,
      secure: false, // Set to true in production with HTTPS
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
