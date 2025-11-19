import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { DomainConfigService } from './common/config/domain.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
  const corsOrigins = process.env.CORS_ORIGIN?.split(',') || [
    'http://localhost:4200',
    'http://localhost',
    // Production origins for base domain
    `https://${baseDomain}`,
    `https://www.${baseDomain}`,
    `https://api.${baseDomain}`,
    // Frontend domain: vendix.online and subdomains
    'https://vendix.online',
    'https://www.vendix.online',
    /^https:\/\/([a-zA-Z0-9-]+\.)?vendix\.online$/,
    // CloudFront distributions
    'https://d10fsx06e3z6rc.cloudfront.net',
    'https://d1y0m1duatgngc.cloudfront.net',
    // AWS App Runner deployment
    'https://2bd2zjyqme.us-east-1.awsapprunner.com',
    // Allow any subdomain for multi-tenant (dynamic based on base domain)
    new RegExp(
      `^https://([a-zA-Z0-9-]+\\.)?${baseDomain.replace('.', '\\.')}$`,
    ),
    // Allow any CloudFront distribution
    /^https:\/\/[a-z0-9]+\.cloudfront\.net$/,
  ];

  // CORS configuration
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
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

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`🚀 Vendix Backend is running on: http://localhost:${port}/api`);
  console.log(`❤️  Health Check: http://localhost:${port}/api/health`);
  console.log(`📄  API Docs: http://localhost:${port}/api-docs`);
}
bootstrap();
