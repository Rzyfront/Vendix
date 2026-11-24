import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Get,
  INestApplication,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import * as request from 'supertest';
import { RequestContextService } from '../context/request-context.service';
import { RequestContextInterceptor } from '../interceptors/request-context.interceptor';
import { requestIdMiddleware } from '../middleware/request-id.middleware';
import { AllExceptionsFilter } from './http-exception.filter';

/**
 * QUI-1049 P3 / QUI-1019: respuestas de error distintas traían el MISMO
 * `request_id`. El filtro leía `RequestContextService.getRequestId()`, que fuera
 * del AsyncLocalStorage cae al estático `currentContext` del último
 * `RequestContextService.run(...)` — el id de otra petición.
 */

class CreateDto {
  @IsString()
  name!: string;
}

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    throw new UnauthorizedException('no session');
  }
}

@Controller('t')
class TestController {
  @Get('guard')
  @UseGuards(DenyGuard)
  guarded() {
    return { ok: true };
  }

  @Post('validate')
  validate(@Body() _dto: CreateDto) {
    return { ok: true };
  }

  @Get('service')
  async service() {
    await Promise.resolve();
    throw new BadRequestException('service failure');
  }

  @Get('ok')
  ok() {
    return { request_id: RequestContextService.getRequestId() ?? null };
  }
}

describe('request_id único por petición (QUI-1049 P3 / QUI-1019)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(requestIdMiddleware);
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Lo que deja en producción cualquier SSE/worker que use `run`: el
    // contexto de OTRA petición en el estático `currentContext`.
    RequestContextService.run(
      { is_super_admin: false, is_owner: false, request_id: 'stale-id' },
      () => undefined,
    );
  });

  const errorCalls: Array<[string, () => request.Test]> = [
    ['guard 401', () => request(app.getHttpServer()).get('/t/guard')],
    [
      'ValidationPipe 400',
      () => request(app.getHttpServer()).post('/t/validate').send({ name: 1 }),
    ],
    ['excepción en servicio', () => request(app.getHttpServer()).get('/t/service')],
  ];

  it.each(errorCalls)(
    '%s: el request_id del cuerpo coincide con X-Request-Id y no es de otra petición',
    async (_label, call) => {
      const res = await call();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.request_id).toBeDefined();
      expect(res.body.request_id).not.toBe('stale-id');
      expect(res.headers['x-request-id']).toBe(res.body.request_id);
    },
  );

  it('varias peticiones con error obtienen ids distintos', async () => {
    const ids: string[] = [];
    for (const [, call] of [...errorCalls, ...errorCalls]) {
      const res = await call();
      ids.push(res.body.request_id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respeta un X-Request-Id entrante en cabecera, cuerpo de error y ALS', async () => {
    const err = await request(app.getHttpServer())
      .get('/t/guard')
      .set('X-Request-Id', 'client-abc');
    expect(err.headers['x-request-id']).toBe('client-abc');
    expect(err.body.request_id).toBe('client-abc');

    const ok = await request(app.getHttpServer())
      .get('/t/ok')
      .set('X-Request-Id', 'client-def');
    expect(ok.headers['x-request-id']).toBe('client-def');
    expect(ok.body.request_id).toBe('client-def');
  });

  it('getRequestId() fuera de un contexto no devuelve el id de otra petición', () => {
    expect(RequestContextService.getRequestId()).toBeUndefined();
  });
});
