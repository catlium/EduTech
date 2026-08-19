import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema/index.js';

export { drizzle, Pool };
export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(databaseUrl: string): Database {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool, { schema });
}

export { schema };

// Re-export all schema tables and types for convenience
export { users } from './schema/users.js';
export { authSessions } from './schema/auth.js';
export { institutes } from './schema/institutes.js';
export { memberships, membershipRoles } from './schema/memberships.js';
export { jobs } from './schema/jobs.js';
export { subjects, chapters, topics } from './schema/academic.js';
export { contentItems, contentVersions } from './schema/content.js';
