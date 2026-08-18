import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from './schema/index.js';

export { drizzle };
export type Database = ReturnType<typeof drizzle<typeof schema>>;

export { schema };
