import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from '@common/filters/http-exception.filter';
import { DomainConfigService } from '@common/config/domain.config';
import { GlobalPrismaService } from './prisma/services/global-prisma.service';
import { PublicSeoService } from './domains/public/seo/public-seo.service';
import { DynamicCorsService } from './common/cors/dynamic-cors.service';
import { json, urlencoded } from 'express';
import * as v8 from 'v8';
import { Server } from 'http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase payload limit for base64 images
  app.use(
    json({
      limit: '50mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Deshabilita la cache HTTP en endpoints privados de la API.
  // Bug fix: el backend emitía ETag (Express por defecto) pero NO Cache-Control,
  // lo que permitía al browser cachear GETs a /api/*. Al re-abrir un producto
  // recién editado, el browser servía la respuesta vieja y los cambios no se
  // veían aplicados, aunque el PATCH sí había persistido.
  // Las rutas explícitamente públicas (sitemap.xml, robots.txt, healthcheck,
  // imágenes S3 firmadas) ya tienen sus propios Cache-Control en sus handlers
  // y NO empiezan con /api/, así que este middleware no las afecta.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

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
  const corsOriginEnv = process.env.CORS_ORIGIN?.split(',') || [];
  const additionalCorsOriginEnv =
    process.env.ADDITIONAL_CORS_ORIGINS?.split(',') || [];
  const allCustomOrigins = [...corsOriginEnv, ...additionalCorsOriginEnv];

  const additionalStaticOrigins: string[] = [];
  const additionalRegexOrigins: RegExp[] = [];

  allCustomOrigins.forEach((origin) => {
    const trimmed = origin.trim();
    if (!trimmed) return;

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
    'http://localhost:8081', // Expo Go (mobile dev)
    'http://localhost:8082', // Metro web dev (reservado)
    'http://localhost:8083', // Metro web dev con Expo SDK 54+
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
    `^https?://([a-zA-Z0-9-]+\\.)?${baseDomain.replace(/\./g, '\\.')}$`,
  );

  // Allow any CloudFront distribution
  const cloudfrontRegex = /^https:\/\/[a-z0-9]+\.cloudfront\.net$/;
  const corsService = app.get(DynamicCorsService);
  const corsLogger = new Logger('CORS');

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

      corsService
        .isAllowed(origin)
        .then((allowed) => {
          if (!allowed && process.env.NODE_ENV === 'development') {
            corsLogger.warn(`Blocked request from origin: ${origin}`);
          }
          callback(null, allowed);
        })
        .catch((error) => {
          corsLogger.error(
            `Failed to evaluate dynamic CORS origin: ${origin}`,
            error instanceof Error ? error.stack : undefined,
          );
          callback(null, false);
        });
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Cache-Control',
      'Content-Type',
      'Origin',
      'Pragma',
      'X-Requested-With',
      'x-store-id',
    ],
    exposedHeaders: ['Authorization', 'Cache-Control', 'Pragma'],
  });

  // Swagger configuration (disabled in development to save memory and avoid SWC metadata issues)
  if (process.env.NODE_ENV !== 'development') {
    const config = new DocumentBuilder()
      .setTitle('Vendix API')
      .setDescription('Documentación de la API de Vendix')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);
  }

  // SEO routes (must be registered before global prefix)
  const seoService = app.get(PublicSeoService);
  const httpAdapter = app.getHttpAdapter();

  httpAdapter.get('/sitemap.xml', async (req, res) => {
    try {
      const hostname = req.headers['x-forwarded-host'] || req.headers['host'];
      const xml = await seoService.generateSitemap(hostname);
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).send(xml);
    } catch (error) {
      res
        .status(500)
        .send('<?xml version="1.0"?><error>Internal Server Error</error>');
    }
  });

  httpAdapter.get('/robots.txt', async (req, res) => {
    try {
      const hostname = req.headers['x-forwarded-host'] || req.headers['host'];
      const txt = await seoService.generateRobotsTxt(hostname);
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(200).send(txt);
    } catch (error) {
      res.status(500).send('User-agent: *\nAllow: /');
    }
  });

  httpAdapter.get('/google002d194fa98388f5.html', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res
      .status(200)
      .send('google-site-verification: google002d194fa98388f5.html');
  });

  // API prefix
  app.setGlobalPrefix(process.env.API_PREFIX || 'api');

  // Health check endpoint
  app.getHttpAdapter().get('/api/health', (req, res) => {
    const mem = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapTotal: heapStats.heap_size_limit,
        heapUsed: mem.heapUsed,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  const prismaService = app.get(GlobalPrismaService);
  await prismaService.enableShutdownHooks(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  // TCP keep-alive reaper: detect and clean up dead sockets (e.g. abandoned SSE
  // connections) without cutting long-lived streams. We only tune keep-alive /
  // header timeouts here — we intentionally DO NOT set requestTimeout, which
  // would kill legitimate long-running SSE requests by design.
  const httpServer: Server = app.getHttpServer();
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.on('connection', (socket) => socket.setKeepAlive(true, 60_000));

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Vendix Backend is running on: http://localhost:${port}/api`);
  logger.log(`❤️  Health Check: http://localhost:${port}/api/health`);
  logger.log(`📄  API Docs: http://localhost:${port}/api-docs`);
}
bootstrap();
