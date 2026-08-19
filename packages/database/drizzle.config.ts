import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

function loadProjectEnv() {
  const candidates = [resolve(process.cwd(), '../../.env'), resolve(process.cwd(), '.env')];

  for (const path of candidates) {
    try {
      loadEnvFile(path);
      return;
    } catch {
      // Candidate env file not present; try next.
    }
  }
}

loadProjectEnv();

export default defineConfig({
  schema: './src/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
  },
});
