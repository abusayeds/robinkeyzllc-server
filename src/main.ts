import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalErrorHandler } from './common/errors/globalErrorHandler';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.useGlobalFilters(new GlobalErrorHandler());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 7000;
  await app.listen(port);

  console.log(`\n🚀 Server running on http://localhost:${port}/api/v1`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}\n`);
}

bootstrap();
