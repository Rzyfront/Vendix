"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
const prisma_service_1 = require("./prisma/prisma.service");
const swagger_1 = require("@nestjs/swagger");
const http_exception_filter_1 = require("./common/filters/http-exception.filter");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.useGlobalFilters(new http_exception_filter_1.AllExceptionsFilter());
    app.useGlobalPipes(new common_1.ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: {
            enableImplicitConversion: true,
        },
    }));
    app.enableCors({
        origin: process.env.CORS_ORIGIN?.split(',') || [
            'http://localhost:4200',
            'http://localhost',
            'http://app.vendix.com',
            'http://api.vendix.com',
            'https://vendix.com',
            'https://www.vendix.com',
            'https://api.vendix.com',
        ],
        credentials: true,
    });
    const config = new swagger_1.DocumentBuilder()
        .setTitle('Vendix API')
        .setDescription('Documentación de la API de Vendix')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup('api-docs', app, document);
    app.setGlobalPrefix(process.env.API_PREFIX || 'api');
    app.getHttpAdapter().get('/api/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.env.npm_package_version || '1.0.0',
        });
    });
    const prismaService = app.get(prisma_service_1.PrismaService);
    await prismaService.enableShutdownHooks(app);
    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    console.log(`🚀 Vendix Backend is running on: http://localhost:${port}/api`);
    console.log(`❤️  Health Check: http://localhost:${port}/api/health`);
    console.log(`📄  API Docs: http://localhost:${port}/api-docs`);
}
bootstrap();
//# sourceMappingURL=main.js.map