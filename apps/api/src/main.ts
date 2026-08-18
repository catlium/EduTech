import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  const port = process.env['API_PORT'] ?? 3000;
  await app.listen(port);

  console.log(`API is running on: http://localhost:${port}`);
}

bootstrap();
