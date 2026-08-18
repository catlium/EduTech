import { Module, Global } from '@nestjs/common';
import { createDatabase } from '@catlium/database';
import type { Database } from '@catlium/database';

export const DATABASE_TOKEN = 'DATABASE';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_TOKEN,
      useFactory: (): Database => {
        const url = process.env['DATABASE_URL'];
        if (!url) {
          throw new Error('DATABASE_URL environment variable is required');
        }
        return createDatabase(url);
      },
    },
  ],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule {}
