import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
  customType,
} from 'drizzle-orm/pg-core';

// Custom type for bytea (binary data for public keys)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ─── Users ──────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── WebAuthn Credentials ───────────────────────────────────────────
export const credentials = pgTable('credentials', {
  // base64url-encoded credential ID
  id: varchar('id', { length: 512 }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // COSE public key as binary
  publicKey: bytea('public_key').notNull(),
  // Signature counter for replay protection
  counter: integer('counter').notNull().default(0),
  // Transports supported by this credential (e.g. 'internal', 'hybrid')
  transports: text('transports').array(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Types ──────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;
