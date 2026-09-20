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
export { subjects, chapters, topics, academicYears, classes, classSubjects, divisions, teacherAssignments, studentPlacements } from './schema/academic.js';
export { contentItems, contentVersions } from './schema/content.js';
export { materials } from './schema/materials.js';
export { materialEnhancements, materialEnhancementSegments, materialEnhancementSegmentMappings } from './schema/material-enhancements.js';
export { questions } from './schema/questions.js';
export { questionTypes } from './schema/question-types.js';
export { assessments, assessmentQuestions } from './schema/examinations.js';
export { questionPapers, questionPaperQuestions } from './schema/question-papers.js';
export { paperPatterns, paperPatternSubjects } from './schema/paper-patterns.js';
export { syllabi } from './schema/syllabus.js';
export { ocrWorkers, ocrChunks, ocrPageCorrections } from './schema/ocr.js';
export { permissions, roles, rolePermissions, platformUserRoles } from './schema/authorization.js';
export { attempts, attemptQuestions, attemptResponses } from './schema/attempts.js';
export {
  practiceSessions,
  practiceSessionItems,
  practiceSessionResponses,
} from './schema/practice.js';
