import { NestFactory } from '@nestjs/core';
import {
  Logger,
  ValidationPipe,
  BadRequestException,
  INestApplication,
  Type,
} from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Worker } from 'bullmq';
import {
  AppModule,
  VendixProcessRole,
  isKnownVendixProcessRole,
  resolveVendixProcessRole,
} from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from '@common/filters/http-exception.filter';
import { DomainConfigService } from '@common/config/domain.config';
import { GlobalPrismaService } from './prisma/services/global-prisma.service';
import { PublicSeoService } from './domains/public/seo/public-seo.service';
import { PublicPwaService } from './domains/public/pwa/public-pwa.service';
import { isPwaIconVariant } from '@common/config/image-presets';
import { resolveTenantHostname } from '@common/utils/tenant-hostname.util';
import {
  extractClientIp,
  resolveTrustProxySetting,
  createTrustProxyPredicate,
} from '@common/utils/client-ip.util';
import { DynamicCorsService } from './common/cors/dynamic-cors.service';
import {
  flattenBulkValidationErrors,
  flattenValidationMessages,
  isBulkValidationError,
} from '@common/validators/bulk-validation.util';
import { json, urlencoded } from 'express';
import * as v8 from 'v8';
import { Server } from 'http';

/**
 * Worker de BullMQ que se construye pero NO arranca su bucle de consumo.
 *
 * ## Por qué esto y no «no registrar el provider»
 *
 * Los 11 `@Processor` del repo viven repartidos en una docena de módulos de
 * dominio. Volverlos condicionales exigiría tocar los doce y dejaría el
 * interruptor duplicado en doce sitios, donde el próximo `@Processor` se
 * olvidaría de él en silencio.
 *
 * `@nestjs/bullmq` construye cada worker con `new BullExplorer._workerClass(...)`,
 * y expone `BullModule.workerClass` como API pública precisamente para sustituir
 * esa clase (su caso documentado es BullMQ Pro). Sustituirla por esta subclase
 * fuerza `autorun: false` en TODOS los workers, presentes y futuros, desde un
 * único punto: el worker se instancia, `instance.worker.on(...)` y `close()`
 * siguen funcionando como espera el explorer, pero nunca pide un job a Redis.
 *
 * Sigue siendo un objeto `Worker` real a propósito: un doble falso obligaría a
 * reimplementar EventEmitter y el ciclo de cierre del explorer, y cualquier
 * hueco ahí reventaría en el arranque de producción, no en un test.
 *
 * Coste: las conexiones ociosas a Redis del worker inerte (Redis es un
 * contenedor aparte en `vendix-net`, así que no compite por el event loop).
 */
class DormantWorker extends Worker {
  constructor(name: string, processor?: any, opts?: any) {
    super(name, processor, { ...(opts ?? {}), autorun: false });
  }
}

/**
 * Desmonta los `@Cron` ya montados por `ScheduleModule`.
 *
 * `SchedulerOrchestrator` los monta en `onApplicationBootstrap`, así que esto
 * SOLO puede correr después de `app.init()` — de ahí el `init()` explícito antes
 * de `listen()` en modo `api`. Se desmontan también intervalos y timeouts porque
 * el registro los gobierna igual y un `@Interval` futuro no debe colarse.
 *
 * `ScheduleModule.forRoot({ cronJobs: false })` sería más limpio, pero ese
 * `forRoot` vive dentro de `JobsModule` y ahí el interruptor no puede leerse por
 * proceso sin acoplar el módulo a la variable de entorno.
 */
function unmountScheduledJobs(app: INestApplication): number {
  const registry = app.get(SchedulerRegistry, { strict: false });
  let unmounted = 0;

  // Se copia la lista antes de borrar: se está mutando el mismo registro que se
  // recorre.
  for (const name of Array.from(registry.getCronJobs().keys())) {
    registry.deleteCronJob(name);
    unmounted++;
  }
  for (const name of [...registry.getIntervals()]) {
    registry.deleteInterval(name);
    unmounted++;
  }
  for (const name of [...registry.getTimeouts()]) {
    registry.deleteTimeout(name);
    unmounted++;
  }

  return unmounted;
}

/**
 * Proceso worker: mismo grafo de módulos, sin servidor HTTP.
 *
 * `createApplicationContext` instancia todos los providers —y con ellos los
 * `@Processor` y los `@Cron`— sin abrir un puerto ni montar el router. Es el
 * mismo `AppModule`, así que el trabajo de fondo ve exactamente los mismos
 * servicios que veía cuando compartía proceso con la API.
 *
 * `enableShutdownHooks()` sí se activa aquí (la API nunca lo tuvo): en el cierre
 * ordenado `BullExplorer.onApplicationShutdown` cierra los workers, lo que da a
 * un job en vuelo la oportunidad de terminar en vez de dejar su lock huérfano.
 */
async function bootstrapWorker(): Promise<void> {
  const logger = new Logger('BootstrapWorker');

  // El resolvedor de dominio es estático y lo consultan jobs que construyen URLs
  // (correos, aprovisionamiento de dominios), así que se inicializa igual que en
  // la API.
  DomainConfigService.initialize();

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  logger.log('⚙️  Vendix Backend arrancó como WORKER (sin servidor HTTP)');
  logger.log('   Consume las colas BullMQ y ejecuta los @Cron programados.');
  // PR 3 — ancla canónica que el gate del workflow (PR 2) busca con
  // `docker logs ... | grep -q "WORKER_READY pid="`. Se emite DESPUÉS de
  // `createApplicationContext` y `enableShutdownHooks`, lo que prueba que
  // `onModuleInit` de @nestjs/bullmq ya construyó los Workers y que
  // `onApplicationBootstrap` de ScheduleModule ya montó los @Cron. Mover
  // este log a un punto anterior haría que mienta.
  logger.log(`WORKER_READY pid=${process.pid} role=worker`);
}

async function bootstrap() {
  const role = resolveVendixProcessRole();

  if (!isKnownVendixProcessRole()) {
    new Logger('Bootstrap').warn(
      `VENDIX_PROCESS_ROLE="${process.env.VENDIX_PROCESS_ROLE}" no se reconoce. ` +
        'Se arranca como "all" (API + trabajo de fondo), que es el comportamiento ' +
        'histórico. Valores válidos: all | api | worker.',
    );
  }

  if (role === 'worker') {
    await bootstrapWorker();
    return;
  }

  await bootstrapApi(role);
}

async function bootstrapApi(role: VendixProcessRole) {
  if (role === 'api') {
    // DEBE quedar antes de `NestFactory.create`: el explorer lee esta clase en
    // `onModuleInit`, que corre dentro del `init()` de la app. (El otro efecto
    // del setter, `BullModule._workerClass`, solo lo consume la opción legacy
    // `registerQueue({ processors })`, que este repo no usa.)
    BullModule.workerClass = DormantWorker as unknown as Type;
  }

  const app = await NestFactory.create(AppModule);

  // Confía en los proxies propios para que `req.ip` sea la IP real del cliente.
  //
  // Sin esto Express ignora `X-Forwarded-For` por completo y `req.ip` es la IP
  // del socket TCP entrante — es decir, la de nginx / la gateway de Docker —
  // idéntica para todo el tráfico del planeta. Como los rate limits se
  // llavean por `req.ip`, TODOS los usuarios comparten una sola cubeta: diez
  // renovaciones de sesión legítimas en cinco minutos agotaban el límite de
  // `auth/refresh` y expulsaban a la plataforma entera.
  //
  // El número (ver `resolveTrustProxySetting`) es la cantidad de saltos
  // propios delante del backend, NUNCA `true`: `true` haría que Express tome
  // el primer elemento de `X-Forwarded-For`, que es el que escribe el cliente,
  // y cualquiera podría falsificar su IP para evadir todos los límites.
  //
  // Tampoco basta el número pelado: el contenedor publica `-p 3000:3000` y el
  // security group de EC2 abre ese puerto a `0.0.0.0/0`, así que se le puede
  // hablar al backend saltándose nginx. Con `trust proxy: N` esa conexión
  // directa cuenta igual como salto de confianza y el `X-Forwarded-For` que
  // traiga se acepta sin más. Por eso el valor de `set()` es el predicado
  // `createTrustProxyPredicate` (ver su docblock en `client-ip.util.ts` para
  // la lógica completa), no `trustProxyHops` directo.
  const trustProxyHops = resolveTrustProxySetting();
  // Vía `getInstance()` y no `app.set(...)`: `NestFactory.create` devuelve
  // `INestApplication`, que no expone `set`. Tiparlo como
  // `NestExpressApplication` obligaría a cambiar la firma del create y arrastra
  // el tipo por el resto del arranque; esto toca la instancia de Express, que
  // es justo lo que hay que configurar.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', createTrustProxyPredicate(trustProxyHops));
  new Logger('Bootstrap').log(
    `Trust proxy: ${trustProxyHops} salto(s) — req.ip se resuelve desde X-Forwarded-For`,
  );

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
        // Formato estándar NestJS: array de strings legible para humanos. Se
        // recorre el árbol porque un error dentro de un array anidado
        // (`items.0.total_price`) no tiene `constraints` en la raíz y quedaba
        // como "Valor inválido", sin decir qué campo corregir.
        const messages = flattenValidationMessages(errors);
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

  // Root endpoint (`GET /`) — status JSON estático. Se registra por adapter
  // Express (no por controlador NestJS) para que corra ANTES del router de
  // NestJS, evitando el 404 filtrado por AllExceptionsFilter que filtraba
  // stack con paths internos cuando NODE_ENV estaba unset. Mismo patrón que
  // `/api/health` justo debajo.
  app.getHttpAdapter().get('/', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'Vendix API',
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

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
      // Sonda de `TRUST_PROXY_HOPS`. Un `curl https://api.vendix.com/api/health`
      // desde fuera debe devolver la IP pública de quien llama; si devuelve una
      // IP privada (10.x, 172.x) el número de saltos se quedó corto y los rate
      // limits están agrupando clientes, y si devuelve algo que el llamante
      // pueda elegir vía cabecera, se pasó y son falsificables. Sólo se ve la
      // propia IP, así que no filtra nada de terceros.
      client_ip: extractClientIp(req as any),
      trust_proxy_hops: trustProxyHops,
    });
  });

  const prismaService = app.get(GlobalPrismaService);
  await prismaService.enableShutdownHooks(app);

  // `init()` explícito: `listen()` lo llamaría igual, pero desmontar los `@Cron`
  // exige un punto ENTRE el arranque de los hooks (que los monta) y la apertura
  // del puerto. Todo el cableado HTTP de arriba ya ocurrió, así que el orden
  // efectivo es idéntico al de siempre.
  await app.init();

  if (role === 'api') {
    const unmounted = unmountScheduledJobs(app);
    new Logger('Bootstrap').log(
      `🧵 Modo API: ${unmounted} tarea(s) programada(s) desmontada(s) y ` +
        'workers BullMQ inertes. El trabajo de fondo lo ejecuta el proceso worker.',
    );
  }

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
  // Se registra el rol efectivo para que «¿este despliegue quedó con workers?»
  // se responda leyendo los logs, no deduciéndolo de la ausencia de jobs.
  logger.log(
    role === 'api'
      ? '🧵 Rol del proceso: api (sin workers ni tareas programadas)'
      : '🧵 Rol del proceso: all (API + workers + tareas programadas, comportamiento histórico)',
  );
  // PR 3 — ancla canónica equivalente al `WORKER_READY` del proceso worker.
  // Permite a monitorización / smoke tests confirmar que la API está viva y
  // bajo qué rol.
  logger.log(`API_READY pid=${process.pid} role=${role}`);
}
bootstrap();
