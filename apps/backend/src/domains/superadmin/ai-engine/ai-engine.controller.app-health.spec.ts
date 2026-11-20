import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AIEngineController } from './ai-engine.controller';

/** ia-cargas F6: read-only per-app health board for super admin. */
describe('AIEngineController app-health (ia-cargas F6)', () => {
  const build = () => {
    const report = { date_from: 'a', date_to: 'b', apps: [] };
    const logging = { getAppHealth: jest.fn().mockResolvedValue(report) };
    const responses = {
      success: jest.fn((data, message) => ({ data, message })),
    };
    const controller = new AIEngineController(
      {} as any,
      logging as any,
      responses as any,
    );
    return { controller, logging, report };
  };

  it('es un GET de solo lectura en superadmin/ai-engine/app-health', () => {
    const handler = AIEngineController.prototype.getAppHealth;
    expect(Reflect.getMetadata(PATH_METADATA, AIEngineController)).toBe(
      'superadmin/ai-engine',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('app-health');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
  });

  it('pasa el rango y la app al servicio y devuelve el informe', async () => {
    const { controller, logging, report } = build();
    const res: any = await controller.getAppHealth({
      date_from: '2026-11-13T05:00:00.000Z',
      date_to: '2026-11-21T04:59:59.999Z',
      app_key: 'customer_import_ocr',
    });
    expect(logging.getAppHealth).toHaveBeenCalledWith({
      date_from: new Date('2026-11-13T05:00:00.000Z'),
      date_to: new Date('2026-11-21T04:59:59.999Z'),
      app_key: 'customer_import_ocr',
    });
    expect(res.data).toBe(report);
  });

  it('sin filtros deja que el servicio use los últimos 7 días', async () => {
    const { controller, logging } = build();
    await controller.getAppHealth({});
    expect(logging.getAppHealth).toHaveBeenCalledWith({
      date_from: undefined,
      date_to: undefined,
      app_key: undefined,
    });
  });
});
