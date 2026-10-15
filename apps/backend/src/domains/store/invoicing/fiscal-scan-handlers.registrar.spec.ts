import { AiScanHandlerRegistry } from '@common/ai-scan-jobs/ai-scan-handler.registry';
import { FiscalScanHandlersRegistrar } from './fiscal-scan-handlers.registrar';
import { RutScanHandlerRegistrar } from './../settings/rut-scan-handler.registrar';

const ctx = {
  store_id: 1,
  organization_id: 1,
  user_id: 1,
  is_super_admin: false,
};
const files = [
  { buffer: Buffer.from('x'), mimeType: 'application/pdf', originalName: 'x.pdf', size: 1 },
];

describe('fiscal scan handler registrars', () => {
  it('registers dian_habilitation and dian_resolution and delegates', async () => {
    const registry = new AiScanHandlerRegistry();
    const hab = { scanHabilitationFromFiles: jest.fn().mockResolvedValue('H') };
    const res = { scanResolutionFromFiles: jest.fn().mockResolvedValue('R') };
    new FiscalScanHandlersRegistrar(registry, hab as any, res as any, {} as any).onModuleInit();

    await expect(
      registry.get('dian_habilitation')!({ files, params: {}, context: ctx }),
    ).resolves.toBe('H');
    await expect(
      registry.get('dian_resolution')!({ files, params: {}, context: ctx }),
    ).resolves.toBe('R');
    expect(hab.scanHabilitationFromFiles).toHaveBeenCalledWith(files);
    expect(res.scanResolutionFromFiles).toHaveBeenCalledWith(files);
  });

  it('registers invoice_draft and forwards the user note', async () => {
    const registry = new AiScanHandlerRegistry();
    const draft = { scanDraftFromFiles: jest.fn().mockResolvedValue('D') };
    new FiscalScanHandlersRegistrar(
      registry,
      {} as any,
      {} as any,
      draft as any,
    ).onModuleInit();

    await expect(
      registry.get('invoice_draft')!({
        files,
        params: { note: '50 % anticipo' },
        context: ctx,
      }),
    ).resolves.toBe('D');
    expect(draft.scanDraftFromFiles).toHaveBeenCalledWith(files, {
      note: '50 % anticipo',
    });

    await registry.get('invoice_draft')!({ files, params: {}, context: ctx });
    expect(draft.scanDraftFromFiles).toHaveBeenLastCalledWith(files, {
      note: null,
    });
  });

  it('registers rut and delegates', async () => {
    const registry = new AiScanHandlerRegistry();
    const rut = { scanRutFromFiles: jest.fn().mockResolvedValue('RUT') };
    new RutScanHandlerRegistrar(registry, rut as any).onModuleInit();
    await expect(
      registry.get('rut')!({ files, params: {}, context: ctx }),
    ).resolves.toBe('RUT');
    expect(rut.scanRutFromFiles).toHaveBeenCalledWith(files);
  });

  it('both registrars together cover the 4 kinds without duplicates', () => {
    const registry = new AiScanHandlerRegistry();
    new FiscalScanHandlersRegistrar(registry, {} as any, {} as any, {} as any).onModuleInit();
    new RutScanHandlerRegistrar(registry, {} as any).onModuleInit();
    expect(
      ['rut', 'dian_habilitation', 'dian_resolution', 'invoice_draft'].every((k) =>
        registry.get(k as any),
      ),
    ).toBe(true);
  });
});
