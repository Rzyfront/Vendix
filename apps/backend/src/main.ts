import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, BadRequestException } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from '@common/filters/http-exception.filter';
import { DomainConfigService } from '@common/config/domain.config';
import { GlobalPrismaService } from './prisma/services/global-prisma.service';
import { PublicSeoService } from './domains/public/seo/public-seo.service';
import { PublicPwaService } from './domains/public/pwa/public-pwa.service';
import { isPwaIconVariant } from '@common/config/image-presets';
import { resolveTenantHostname } from '@common/utils/tenant-hostname.util';
import { DynamicCorsService } from './common/cors/dynamic-cors.service';
import {
  flattenBulkValidationErrors,
  isBulkValidationError,
} from '@common/validators/bulk-validation.util';
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
      // QUI-606: el `exceptionFactory` del ValidationPipe global detecta si
      // el árbol de errores viene de una carga masiva (patrón
      // `customers.<rowIndex>.<field>`) y, en ese caso, aplana los errores
      // al shape canónico `BulkRowError` con `row`, `column`, `value`,
      // `code` y `suggestion`. Para el resto de endpoints mantiene el
      // formato estándar de NestJS.
      exceptionFactory: (errors) => {
        if (isBulkValidationError(errors)) {
          const flat = flattenBulkValidationErrors(errors);
          return new BadRequestException({
            statusCode: 400,
            message: `Se encontraron ${flat.length} error(es) de validación en la carga masiva`,
            error_code: 'CUST_BULK_VALIDATION',
            validationErrors: flat,
          });
        }
        // Formato estándar NestJS: array de strings legible para humanos.
        const messages = errors
          .map((e) =>
            e.constraints
              ? Object.values(e.constraints).join(', ')
              : 'Valor inválido',
          )
          .filter(Boolean);
        return new BadRequestException({
          statusCode: 400,
          message: messages,
          error: 'Bad Request',
        });
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
    // `exposedHeaders` es lo único que permite al JS del navegador LEER una
    // cabecera de respuesta cross-origin: sin listarla aquí, fetch/XHR la
    // recibe pero `response.headers.get()` devuelve null.
    //
    // Ya no se exponen `X-Total-Count` / `X-Printed-Count` / `X-Skipped-*`:
    // las emitía `POST /store/orders/bulk/print` cuando su body era un PDF
    // binario y el reporte de órdenes omitidas no tenía dónde ir. Ese endpoint
    // devuelve JSON desde QUI-599, así que la partición viaja en el body,
    // completa y sin el truncado que imponía el límite de 8 KB por cabecera de
    // nginx.
    exposedHeaders: [
      'Authorization',
      'Cache-Control',
      'Pragma',
      'Content-Disposition',
    ],
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
      const hostname = resolveTenantHostname(req);
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
      const hostname = resolveTenantHostname(req);
      const txt = await seoService.generateRobotsTxt(hostname);
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.status(200).send(txt);
    } catch (error) {
      res.status(500).send('User-agent: *\nAllow: /');
    }
  });

  // PWA routes (must be registered before the global prefix, and must stay
  // OUTSIDE /api/ so the no-store middleware above does not kill their cache).
  const pwaService = app.get(PublicPwaService);

  httpAdapter.get('/manifest.webmanifest', async (req, res) => {
    try {
      const hostname = resolveTenantHostname(req);
      const manifest = await pwaService.buildManifest(hostname);
      res.setHeader('Content-Type', 'application/manifest+json');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(200).json(manifest);
    } catch (error) {
      // Never 500: a failed manifest makes the app uninstallable. Degrade to a
      // minimal, valid Vendix-branded manifest instead.
      res.setHeader('Content-Type', 'application/manifest+json');
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.status(200).json({
        id: '/',
        name: 'Vendix',
        short_name: 'Vendix',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#2F6F4E',
        background_color: '#2F6F4E',
        icons: [
          {
            src: '/pwa/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/pwa/apple-touch-icon-180.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      });
    }
  });

  // Literal allow-list. The route param is NEVER concatenated into an S3 key —
  // this is what blocks both path traversal and bucket enumeration.
  const PWA_ASSETS = new Set([
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon-180.png',
  ]);

  httpAdapter.get('/pwa/:asset', async (req, res) => {
    const asset = String(req.params?.asset ?? '');
    if (!PWA_ASSETS.has(asset)) {
      res.status(404).send('Not Found');
      return;
    }

    const variant = asset.replace(/\.png$/, '');
    if (!isPwaIconVariant(variant)) {
      res.status(404).send('Not Found');
      return;
    }

    try {
      const hostname = resolveTenantHostname(req);
      const { buffer } = await pwaService.resolveIconBuffer(hostname, variant);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.status(200).send(buffer);
    } catch (error) {
      // An installed app must never show a broken icon: serve the Vendix brand.
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.status(200).send(pwaService.getBrandIconBuffer(variant));
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
