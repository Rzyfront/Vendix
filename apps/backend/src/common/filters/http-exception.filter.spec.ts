import { HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './http-exception.filter';
import { ErrorCodes, VendixHttpException } from '../errors';

function makeHost() {
  const res: any = {
    statusCode: 0,
    body: null as any,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'GET', url: '/api/ecommerce/catalog' }),
    }),
  };
  return { host, res };
}

describe('AllExceptionsFilter throttler mapping (D.3 / ERR-22)', () => {
  const filter = new AllExceptionsFilter();

  it('429 sin código (ThrottlerException de fábrica) ⇒ RATE_LIMIT_001', () => {
    const { host, res } = makeHost();

    filter.catch(new ThrottlerException(), host as any);

    expect(res.statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(res.body.error_code).toBe('RATE_LIMIT_001');
    expect(res.body.error_code).toBe(ErrorCodes.RATE_LIMIT_001.code);
  });

  it('429 de dominio conserva su código (no lo tapa RATE_LIMIT_001)', () => {
    const { host, res } = makeHost();

    filter.catch(
      new VendixHttpException(ErrorCodes.SUP_PQR_005),
      host as any,
    );

    expect(res.statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(res.body.error_code).toBe('SUP_PQR_005');
  });
});

describe('AllExceptionsFilter — transacción vencida y pool agotado (S4)', () => {
  const filter = new AllExceptionsFilter();
  const BUSY = 'El sistema está ocupado, intenta de nuevo en unos segundos';
  const prismaError = (code: string, message: string) =>
    new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => consoleError.mockRestore());

  it('P2028 (transacción vencida) ⇒ 503 SYS_BUSY_001 con el mensaje exacto, sin el texto de Prisma', () => {
    const { host, res } = makeHost();

    filter.catch(
      prismaError(
        'P2028',
        'Transaction API error: Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 7344 ms passed since the start of the transaction.',
      ),
      host as any,
    );

    expect(res.statusCode).toBe(503);
    expect(res.body.error_code).toBe('SYS_BUSY_001');
    expect(res.body.message).toBe(BUSY);
    expect(JSON.stringify(res.body)).not.toContain('Transaction API error');
  });

  it('P2024 (pool agotado) ⇒ 503 SYS_BUSY_001 con el mensaje exacto', () => {
    const { host, res } = makeHost();

    filter.catch(
      prismaError('P2024', 'Timed out fetching a new connection from the connection pool.'),
      host as any,
    );

    expect(res.statusCode).toBe(503);
    expect(res.body.error_code).toBe('SYS_BUSY_001');
    expect(res.body.message).toBe(BUSY);
  });

  it('el código del catálogo lleva el mismo 503 y el mismo mensaje cuando un servicio lo lanza', () => {
    const { host, res } = makeHost();

    filter.catch(new VendixHttpException(ErrorCodes.SYS_BUSY_001), host as any);

    expect(res.statusCode).toBe(503);
    expect(res.body.error_code).toBe('SYS_BUSY_001');
    expect(res.body.message).toBe(BUSY);
  });

  it('otro error conocido de Prisma (P2025) sigue siendo 500 SYS_INTERNAL_001 (sin cambios)', () => {
    const { host, res } = makeHost();

    filter.catch(prismaError('P2025', 'Record to update not found.'), host as any);

    expect(res.statusCode).toBe(500);
    expect(res.body.error_code).toBe('SYS_INTERNAL_001');
  });
});

describe('AllExceptionsFilter — bot de monitoreo (QUI-1010)', () => {
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => consoleError.mockRestore());

  const hostFor = (req: Record<string, unknown>) => {
    const { host, res } = makeHost();
    host.switchToHttp = () => ({ getResponse: () => res, getRequest: () => req });
    return { host, res };
  };

  it('cada 5xx llega al bot con la ruta sin valores y sin cuerpo ni cabeceras', () => {
    const sink = { captureHttpFailure: jest.fn() };
    const filter = new AllExceptionsFilter(sink);
    const { host, res } = hostFor({
      method: 'POST',
      originalUrl: '/api/store/orders/123?email=a@b.co',
      body: { password: 'x' },
      headers: { authorization: 'Bearer y' },
    });

    filter.catch(new Error('boom'), host as any);

    expect(res.statusCode).toBe(500);
    expect(sink.captureHttpFailure).toHaveBeenCalledTimes(1);
    const input = sink.captureHttpFailure.mock.calls[0][0];
    expect(input).toMatchObject({ method: 'POST', route: '/api/store/orders/:id', status: 500 });
    expect(JSON.stringify(input)).not.toContain('a@b.co');
    expect(input).not.toHaveProperty('body');
    expect(input).not.toHaveProperty('headers');
  });

  it('los 4xx no se reportan', () => {
    const sink = { captureHttpFailure: jest.fn() };
    const { host } = hostFor({ method: 'GET', url: '/api/x' });
    new AllExceptionsFilter(sink).catch(
      new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001),
      host as any,
    );
    expect(sink.captureHttpFailure).not.toHaveBeenCalled();
  });

  it('si el bot lanza, la respuesta al cliente no cambia', () => {
    const sink = {
      captureHttpFailure: jest.fn(() => {
        throw new Error('sink down');
      }),
    };
    const { host, res } = hostFor({ method: 'GET', url: '/api/x' });
    new AllExceptionsFilter(sink).catch(new Error('boom'), host as any);
    expect(res.statusCode).toBe(500);
    expect(res.body.error_code).toBeDefined();
  });
});
