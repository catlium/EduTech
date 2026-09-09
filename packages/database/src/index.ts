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
export { materials } from './schema/materials.js';
export { questions } from './schema/questions.js';
export { assessments, assessmentQuestions } from './schema/examinations.js';
export { paperPatterns } from './schema/paper-patterns.js';
export { syllabusProposals } from './schema/syllabus.js';
export { attempts, attemptQuestions, attemptResponses } from './schema/attempts.js';
export {
  practiceSessions,
  practiceSessionItems,
  practiceSessionResponses,
} from './schema/practice.js';
