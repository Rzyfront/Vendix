import { SSE_METADATA } from '@nestjs/common/constants';
import { lastValueFrom, of } from 'rxjs';
import { PerformanceInterceptor } from './performance.interceptor';

describe('PerformanceInterceptor — latencia para el bot de monitoreo (QUI-1010)', () => {
  const collector = { record: jest.fn(), trackActiveRequest: jest.fn() };

  const contextFor = (handler: () => void) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ url: '/api/store/x', method: 'GET', route: { path: '/api/store/x' } }),
        getResponse: () => ({ statusCode: 200 }),
      }),
      getHandler: () => handler,
    }) as never;

  it('cada respuesta normal pasa al bot con su duración y ruta', async () => {
    const alerts = { captureSlowRequest: jest.fn() };
    const interceptor = new PerformanceInterceptor(collector as never, alerts as never);
    await lastValueFrom(interceptor.intercept(contextFor(() => undefined), { handle: () => of('ok') }));
    expect(alerts.captureSlowRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', route: '/api/store/x', statusCode: 200 }),
    );
    expect(collector.record).toHaveBeenCalled();
  });

  it('la alerta lleva tienda, organización, usuario y parámetros resueltos del request', async () => {
    const alerts = { captureSlowRequest: jest.fn() };
    const interceptor = new PerformanceInterceptor(collector as never, alerts as never);
    const authContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          url: '/api/store/invoicing/orders/987/emit',
          method: 'POST',
          route: { path: '/api/store/invoicing/orders/:orderId/emit' },
          params: { orderId: '987' },
          user: { id: 7, organization_id: 82, store_id: 105 },
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
      getHandler: () => () => undefined,
    } as never;

    await lastValueFrom(interceptor.intercept(authContext, { handle: () => of('ok') }));

    expect(alerts.captureSlowRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 82,
        storeId: 105,
        userId: 7,
        params: { orderId: '987' },
      }),
    );
  });

  it('los handlers SSE no cuentan como respuesta lenta', async () => {
    const alerts = { captureSlowRequest: jest.fn() };
    const handler = () => undefined;
    Reflect.defineMetadata(SSE_METADATA, true, handler);
    const interceptor = new PerformanceInterceptor(collector as never, alerts as never);
    await lastValueFrom(interceptor.intercept(contextFor(handler), { handle: () => of('a', 'b') }));
    expect(alerts.captureSlowRequest).not.toHaveBeenCalled();
  });

  it('sin el bot (proveedor opcional) sigue midiendo', async () => {
    const interceptor = new PerformanceInterceptor(collector as never);
    await expect(
      lastValueFrom(interceptor.intercept(contextFor(() => undefined), { handle: () => of('ok') })),
    ).resolves.toBe('ok');
  });
});
