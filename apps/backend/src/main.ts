import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from '@common/filters/http-exception.filter';
import { DomainConfigService } from '@common/config/domain.config';
import { GlobalPrismaService } from './prisma/services/global-prisma.service';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase payload limit for base64 images
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Initialize domain configuration
  DomainConfigService.initialize();

  // Apply the global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Enable validation pipes globally
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  ); // Build dynamic CORS origins based on base domain configuration
  const baseDomain = DomainConfigService.getBaseDomain();

  // Parse additional origins from env
  const additionalOriginsRaw =
    process.env.ADDITIONAL_CORS_ORIGINS?.split(',') || [];
  const additionalStaticOrigins: string[] = [];
  const additionalRegexOrigins: RegExp[] = [];

  additionalOriginsRaw.forEach((origin) => {
    const trimmed = origin.trim();
    if (trimmed.includes('*')) {
      // Convert wildcard string to regex (e.g. https://*.example.com -> ^https://.*\.example\.com$)
      try {
        const regexStr =
          '^' +
          trimmed.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') +
          '$';
        additionalRegexOrigins.push(new RegExp(regexStr));
      } catch (e) {
        console.error(`Invalid wildcard CORS origin: ${trimmed}`, e);
      }
    } else {
      additionalStaticOrigins.push(trimmed);
    }
  });

  const staticOrigins = [
    'http://localhost:4200',
    'http://localhost',
    'http://localhost:3000',
    // Production - Dynamically generated using BASE_DOMAIN env var
    `https://${baseDomain}`,
    `https://www.${baseDomain}`,
    `https://api.${baseDomain}`,
    // CloudFront distributions (infrastructure)
    'https://d10fsx06e3z6rc.cloudfront.net',
    'https://d1y0m1duatgngc.cloudfront.net',
    ...additionalStaticOrigins,
  ];

  // Allow any subdomain for multi-tenant (HTTP and HTTPS)
  // Modified to be more permissive with protocol and subdomains
  const subdomainRegex = new RegExp(
    `^https?://([a-zA-Z0-9-]+\\.)?${baseDomain.replace('.', '\\.')}$`,
  );

  // Allow any CloudFront distribution
  const cloudfrontRegex = /^https:\/\/[a-z0-9]+\.cloudfront\.net$/;

  // CORS configuration
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (staticOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (subdomainRegex.test(origin)) {
        return callback(null, true);
      }

      if (cloudfrontRegex.test(origin)) {
        return callback(null, true);
      }

      if (additionalRegexOrigins.some((r) => r.test(origin))) {
        return callback(null, true);
      }

      // Only log in development or if explicitly debug enabled
      if (process.env.NODE_ENV === 'development') {
        const logger = new Logger('CORS');
        logger.warn(`Blocked request from origin: ${origin}`);
      }

      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'x-store-id',
    ],
    exposedHeaders: ['Authorization'],
  });

  // Swagger configuration
  const config = new DocumentBuilder()
    .setTitle('Vendix API')
    .setDescription('Documentación de la API de Vendix')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  // API prefix
  app.setGlobalPrefix(process.env.API_PREFIX || 'api');

  // Health check endpoint
  app.getHttpAdapter().get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  const prismaService = app.get(GlobalPrismaService);
  await prismaService.enableShutdownHooks(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Vendix Backend is running on: http://localhost:${port}/api`);
  logger.log(`❤️  Health Check: http://localhost:${port}/api/health`);
  logger.log(`📄  API Docs: http://localhost:${port}/api-docs`);
}
bootstrap();
