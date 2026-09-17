import { HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
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
