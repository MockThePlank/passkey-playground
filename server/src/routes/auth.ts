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
import { rememberChallenge, consumeChallenge } from '../lib/challenges.js';

// ─── Config ──────────────────────────────────────────────────────────
const rpID = process.env.RP_ID || 'localhost';
const rpName = process.env.RP_NAME || 'Passkey Playground';
const rpOrigin = process.env.RP_ORIGIN || 'http://localhost:5173';
const MAX_USERNAME_LENGTH = 255; // Matches users.username in the schema
const USERNAME_TAKEN = 'Username is already taken';

// The passkey is the only factor, so the authenticator must verify the user
// (biometrics or PIN). The options ask for it and the verification insists
// on it: the two have to agree.
const USER_VERIFICATION = 'required' as const;

// Shape check for both verify endpoints. @simplewebauthn validates the
// contents; this only stops requests that are not a WebAuthn response at all.
const verifySchema = {
  body: {
    type: 'object',
    required: ['id', 'rawId', 'response', 'type'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 512 },
      rawId: { type: 'string', minLength: 1 },
      response: { type: 'object' },
      type: { const: 'public-key' },
    },
  },
};

/** Name of the violated unique constraint, or null for any other error. */
function uniqueViolation(err: unknown): string | null {
  // Drizzle wraps the driver error, so walk the cause chain
  for (let e = err as any; e; e = e.cause) {
    if (e.code === '23505') return e.constraint_name ?? '';
  }
  return null;
}

export async function authRoutes(fastify: FastifyInstance) {
  // ─── Registration: Generate Options ──────────────────────────────
  fastify.post<{ Body?: { username?: unknown } }>(
    '/register/options',
    async (request, reply) => {
      const rawUsername = request.body?.username;
      const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';

      if (username.length === 0) {
        return reply.code(400).send({ error: 'Username is required' });
      }

      if (username.length > MAX_USERNAME_LENGTH) {
        return reply.code(400).send({ error: 'Username is too long' });
      }

      // Check if user already exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.username, username),
      });

      // Get existing credentials for this user (if re-registering)
      let existingCredentials: { id: string; transports: string[] | null }[] =
        [];

      if (existingUser) {
        // Only the signed-in owner may add a passkey to an existing account.
        // Anyone else would otherwise take the account over by registering
        // their own passkey under this username.
        if (request.session.get('userId') !== existingUser.id) {
          return reply.code(409).send({ error: USERNAME_TAKEN });
        }

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
          userVerification: USER_VERIFICATION,
        },
      });

      // Store challenge in session for verification
      rememberChallenge(options.challenge);
      request.session.set('challenge', options.challenge);
      // Kept apart from `username`, which names the signed-in user
      request.session.set('pendingUsername', username);

      return reply.send(options);
    },
  );

  // ─── Registration: Verify Response ───────────────────────────────
  fastify.post<{ Body: RegistrationResponseJSON }>(
    '/register/verify',
    { schema: verifySchema },
    async (request, reply) => {
      const expectedChallenge = request.session.get('challenge');
      const username = request.session.get('pendingUsername');

      // One attempt per challenge, whether it succeeds or not
      request.session.set('challenge', undefined);
      request.session.set('pendingUsername', undefined);

      if (
        !expectedChallenge ||
        !username ||
        !consumeChallenge(expectedChallenge)
      ) {
        return reply.code(400).send({ error: 'No pending registration' });
      }

      try {
        const verification = await verifyRegistrationResponse({
          response: request.body,
          expectedChallenge,
          expectedOrigin: rpOrigin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });

        if (!verification.verified || !verification.registrationInfo) {
          return reply.code(400).send({ error: 'Verification failed' });
        }

        const { credential } = verification.registrationInfo;
        const sessionUserId = request.session.get('userId');

        // User and passkey are stored together or not at all. A user row
        // without a passkey would block its username for good.
        const user = await db.transaction(async (tx) => {
          let user = await tx.query.users.findFirst({
            where: eq(users.username, username),
          });

          if (!user) {
            [user] = await tx.insert(users).values({ username }).returning();
          } else if (sessionUserId !== user.id) {
            // Re-checked here: the name may have been claimed since the
            // options were issued, or the session may be an older copy of
            // the cookie
            return null;
          }

          await tx.insert(credentials).values({
            id: credential.id,
            userId: user.id,
            publicKey: Buffer.from(credential.publicKey),
            counter: credential.counter,
            transports: request.body.response.transports ?? [],
          });

          return user;
        });

        if (!user) {
          return reply.code(409).send({ error: USERNAME_TAKEN });
        }

        // Set session
        request.session.set('userId', user.id);
        request.session.set('username', username);

        return reply.send({ verified: true, username });
      } catch (err) {
        // Two registrations can pass the checks above at the same moment;
        // the database then lets only one of them through
        const constraint = uniqueViolation(err);
        if (constraint !== null) {
          return reply.code(409).send({
            error: constraint.includes('username')
              ? USERNAME_TAKEN
              : 'Passkey is already registered',
          });
        }

        request.log.error(err, 'Registration verification error');
        return reply.code(400).send({ error: 'Verification failed' });
      }
    },
  );

  // ─── Login: Generate Options ─────────────────────────────────────
  fastify.post('/login/options', async (request, reply) => {
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: USER_VERIFICATION,
      // Empty allowCredentials = discoverable credential (passkey)
    });

    rememberChallenge(options.challenge);
    request.session.set('challenge', options.challenge);

    return reply.send(options);
  });

  // ─── Login: Verify Response ──────────────────────────────────────
  fastify.post<{ Body: AuthenticationResponseJSON }>(
    '/login/verify',
    { schema: verifySchema },
    async (request, reply) => {
      const expectedChallenge = request.session.get('challenge');

      // One attempt per challenge, whether it succeeds or not
      request.session.set('challenge', undefined);

      if (!expectedChallenge || !consumeChallenge(expectedChallenge)) {
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
          requireUserVerification: true,
          credential: {
            id: credential.id,
            publicKey: new Uint8Array(credential.publicKey),
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

        return reply.send({ verified: true, username: user.username });
      } catch (err) {
        request.log.error(err, 'Login verification error');
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
