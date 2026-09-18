import { database } from "@/lib/server-store";

export type DbUser = {
  id: string;
  email: string | null;
  passwordHash: string | null;
  name: string;
  created: string;
};

let ensured = false;

export async function ensureUserTables() {
  if (ensured) return;
  const db = database();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY NOT NULL,
        email text,
        password_hash text,
        name text NOT NULL,
        created text NOT NULL
      )`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS oauth_accounts (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        provider text NOT NULL,
        provider_user_id text NOT NULL,
        created text NOT NULL
      )`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_uid ON oauth_accounts (provider, provider_user_id)`,
    )
    .bind()
    .run();
  ensured = true;
}

function rowUser(row: Record<string, unknown> | null): DbUser | null {
  if (!row) return null;
  return {
    id: String(row.id),
    email: row.email ? String(row.email) : null,
    passwordHash: row.password_hash ? String(row.password_hash) : null,
    name: String(row.name || ""),
    created: String(row.created || ""),
  };
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  await ensureUserTables();
  const row = await database()
    .prepare("SELECT * FROM users WHERE email=?")
    .bind(email.toLowerCase())
    .first();
  return rowUser(row);
}

export async function findUserById(id: string): Promise<DbUser | null> {
  await ensureUserTables();
  const row = await database()
    .prepare("SELECT * FROM users WHERE id=?")
    .bind(id)
    .first();
  return rowUser(row);
}

export async function findOAuthUser(
  provider: string,
  providerUserId: string,
): Promise<DbUser | null> {
  await ensureUserTables();
  const link = await database()
    .prepare(
      "SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_user_id=?",
    )
    .bind(provider, providerUserId)
    .first();
  if (!link?.user_id) return null;
  return findUserById(String(link.user_id));
}

export async function createUser(input: {
  email?: string | null;
  passwordHash?: string | null;
  name: string;
}): Promise<DbUser> {
  await ensureUserTables();
  const user: DbUser = {
    id: crypto.randomUUID(),
    email: input.email ? input.email.toLowerCase() : null,
    passwordHash: input.passwordHash || null,
    name: input.name.slice(0, 120) || "Пользователь",
    created: new Date().toISOString(),
  };
  await database()
    .prepare(
      "INSERT INTO users (id,email,password_hash,name,created) VALUES (?,?,?,?,?)",
    )
    .bind(user.id, user.email, user.passwordHash, user.name, user.created)
    .run();
  return user;
}

export async function linkOAuth(
  userId: string,
  provider: string,
  providerUserId: string,
) {
  await ensureUserTables();
  const existing = await database()
    .prepare(
      "SELECT id FROM oauth_accounts WHERE provider=? AND provider_user_id=?",
    )
    .bind(provider, providerUserId)
    .first();
  if (existing) return;
  await database()
    .prepare(
      "INSERT INTO oauth_accounts (id,user_id,provider,provider_user_id,created) VALUES (?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      userId,
      provider,
      providerUserId,
      new Date().toISOString(),
    )
    .run();
}

export async function upsertOAuthUser(input: {
  provider: string;
  providerUserId: string;
  email?: string | null;
  name: string;
}): Promise<DbUser> {
  const linked = await findOAuthUser(input.provider, input.providerUserId);
  if (linked) return linked;
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const byEmail = await findUserByEmail(email);
    if (byEmail) {
      await linkOAuth(byEmail.id, input.provider, input.providerUserId);
      return byEmail;
    }
  }
  const user = await createUser({
    email,
    name: input.name,
  });
  await linkOAuth(user.id, input.provider, input.providerUserId);
  return user;
}

export async function listUserIdsForCron(): Promise<
  { userId: string; email: string; name: string }[]
> {
  await ensureUserTables();
  const rows = await database()
    .prepare("SELECT id,email,name FROM users")
    .bind()
    .all();
  return (rows.results || []).map((row) => ({
    userId: String(row.id),
    email: row.email ? String(row.email) : "",
    name: String(row.name || "Пользователь"),
  }));
}
