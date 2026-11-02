import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('KaamConnectBackend');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;
  const apiPrefix = configService.get<string>('apiPrefix') || 'api/v1';

  // Enable Cross-Origin Resource Sharing
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global Route Prefix
  app.setGlobalPrefix(apiPrefix);

  // Global Input Validation & Sanitization
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global Exception Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(port, '0.0.0.0');
  logger.log(`================================================================`);
  logger.log(`🚀 KaamConnect Backend running on port: ${port}/${apiPrefix}`);
  logger.log(`🛡️  Auth Endpoint: POST http://localhost:${port}/${apiPrefix}/auth/phone-login`);
  logger.log(`🗄️  PostgreSQL Schema: ${configService.get('database.name')}`);
  logger.log(`🔥 Firebase Project: ${configService.get('firebase.projectId')}`);
  logger.log(`================================================================`);
}

bootstrap();
