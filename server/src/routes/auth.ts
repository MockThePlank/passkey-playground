import type { FastifyInstance } from 'fastify';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, credentials } from '../db/schema.js';
import { requireAuth } from '../lib/session.js';

// ─── Config ──────────────────────────────────────────────────────────
const rpID = process.env.RP_ID || 'localhost';
const rpName = process.env.RP_NAME || 'Passkey Playground';
const rpOrigin = process.env.RP_ORIGIN || 'http://localhost:5173';

export async function authRoutes(fastify: FastifyInstance) {
  // ─── Registration: Generate Options ──────────────────────────────
  fastify.post<{ Body: { username: string } }>(
    '/register/options',
    async (request, reply) => {
      const { username } = request.body;

      if (!username || username.trim().length === 0) {
        return reply.code(400).send({ error: 'Username is required' });
      }

      // Check if user already exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.username, username),
      });

      // Get existing credentials for this user (if re-registering)
      let existingCredentials: { id: string; transports: string[] | null }[] =
        [];

      if (existingUser) {
        const creds = await db.query.credentials.findMany({
          where: eq(credentials.userId, existingUser.id),
        });
        existingCredentials = creds.map((c) => ({
          id: c.id,
          transports: c.transports,
        }));
      }

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: username,
        // Don't re-register existing credentials
        excludeCredentials: existingCredentials.map((c) => ({
          id: c.id,
          transports: c.transports as AuthenticatorTransport[] | undefined,
        })),
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred',
        },
      });

      // Store challenge in session for verification
      request.session.set('challenge', options.challenge);
      request.session.set('username', username);

      return reply.send(options);
    },
  );

  // ─── Registration: Verify Response ───────────────────────────────
  fastify.post<{ Body: RegistrationResponseJSON }>(
    '/register/verify',
    async (request, reply) => {
      const expectedChallenge = request.session.get('challenge');
      const username = request.session.get('username');

      if (!expectedChallenge || !username) {
        return reply.code(400).send({ error: 'No pending registration' });
      }

      try {
        const verification = await verifyRegistrationResponse({
          response: request.body,
          expectedChallenge,
          expectedOrigin: rpOrigin,
          expectedRPID: rpID,
        });

        if (!verification.verified || !verification.registrationInfo) {
          return reply.code(400).send({ error: 'Verification failed' });
        }

        const { credential } = verification.registrationInfo;

        // Create or find user
        let user = await db.query.users.findFirst({
          where: eq(users.username, username),
        });

        if (!user) {
          const [newUser] = await db
            .insert(users)
            .values({ username })
            .returning();
          user = newUser;
        }

        // Store credential
        await db.insert(credentials).values({
          id: credential.id,
          userId: user.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: credential.counter,
          transports: request.body.response.transports ?? [],
        });

        // Set session
        request.session.set('userId', user.id);
        request.session.set('username', username);
        request.session.set('challenge', undefined);

        return reply.send({ verified: true, username });
      } catch (err) {
        console.error('Registration verification error:', err);
        return reply.code(400).send({ error: 'Verification failed' });
      }
    },
  );

  // ─── Login: Generate Options ─────────────────────────────────────
  fastify.post('/login/options', async (request, reply) => {
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      // Empty allowCredentials = discoverable credential (passkey)
    });

    request.session.set('challenge', options.challenge);

    return reply.send(options);
  });

  // ─── Login: Verify Response ──────────────────────────────────────
  fastify.post<{ Body: AuthenticationResponseJSON }>(
    '/login/verify',
    async (request, reply) => {
      const expectedChallenge = request.session.get('challenge');

      if (!expectedChallenge) {
        return reply.code(400).send({ error: 'No pending login' });
      }

      try {
        // Find the credential
        const credential = await db.query.credentials.findFirst({
          where: eq(credentials.id, request.body.id),
        });

        if (!credential) {
          return reply.code(400).send({ error: 'Credential not found' });
        }

        const verification = await verifyAuthenticationResponse({
          response: request.body,
          expectedChallenge,
          expectedOrigin: rpOrigin,
          expectedRPID: rpID,
          credential: {
            id: credential.id,
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports:
              (credential.transports as AuthenticatorTransport[]) ?? [],
          },
        });

        if (!verification.verified) {
          return reply.code(400).send({ error: 'Verification failed' });
        }

        // Update counter
        await db
          .update(credentials)
          .set({ counter: verification.authenticationInfo.newCounter })
          .where(eq(credentials.id, credential.id));

        // Get user
        const user = await db.query.users.findFirst({
          where: eq(users.id, credential.userId),
        });

        if (!user) {
          return reply.code(400).send({ error: 'User not found' });
        }

        // Set session
        request.session.set('userId', user.id);
        request.session.set('username', user.username);
        request.session.set('challenge', undefined);

        return reply.send({ verified: true, username: user.username });
      } catch (err) {
        console.error('Login verification error:', err);
        return reply.code(400).send({ error: 'Verification failed' });
      }
    },
  );

  // ─── Current User ────────────────────────────────────────────────
  fastify.get(
    '/me',
    { preHandler: requireAuth },
    async (request, reply) => {
      return reply.send({
        userId: request.session.get('userId'),
        username: request.session.get('username'),
      });
    },
  );

  // ─── Logout ──────────────────────────────────────────────────────
  fastify.post('/logout', async (request, reply) => {
    request.session.delete();
    return reply.send({ ok: true });
  });
}
