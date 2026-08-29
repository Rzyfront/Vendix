/**
 * [print-editor-dsk P3.1] — Unit tests for DocumentIndexService.
 *
 * The contract this file pins:
 *   1. `listRecent` delegates to `provider.listRecent` when both
 *      exist (registry has provider + provider implements the method).
 *   2. Returns `[]` when the format_type is not registered — does
 *      NOT throw, because the editor's picker must degrade gracefully.
 *   3. Caps the limit at 50 — protects providers from a missing LIMIT
 *      that could blow the orderBy on a large store.
 *
 * No DB: registry and providers are mocked. Mirrors the pattern in
 * `real-print-path.spec.ts` (CP-DTLP-20260827).
 */
import { DocumentIndexService } from '../document-index.service';

describe('DocumentIndexService (P3.1 — picker del editor del Hub)', () => {
  const buildService = (registry: any) => {
    // El servicio recibe un `GlobalPrismaService` (inyectado por Nest)
    // que en estos tests nunca se usa — `listRecent` delega 100% al
    // provider, no consulta la base directamente. Pasamos un stub vacío.
    return new DocumentIndexService({} as any, registry);
  };

  it('1. delega en provider.listRecent cuando el formato está registrado y el provider lo implementa', async () => {
    const listRecent = jest.fn().mockResolvedValue([
      { id: 7, number: 'POS-007', date_formatted: '15/08/26, 10:30' },
    ]);
    const provider = { listRecent };
    const registry = {
      hasProvider: jest.fn().mockReturnValue(true),
      getProvider: jest.fn().mockReturnValue(provider),
    };
    const svc = buildService(registry);

    const data = await svc.listRecent(42, 'pos_sale_ticket', 5);

    expect(data).toEqual([
      { id: 7, number: 'POS-007', date_formatted: '15/08/26, 10:30' },
    ]);
    expect(listRecent).toHaveBeenCalledWith(42, 5);
    expect(registry.hasProvider).toHaveBeenCalledWith('pos_sale_ticket');
  });

  it('2. devuelve [] cuando el formato NO está registrado, sin lanzar', async () => {
    const registry = {
      hasProvider: jest.fn().mockReturnValue(false),
      getProvider: jest.fn(),
    };
    const svc = buildService(registry);

    const data = await svc.listRecent(42, 'inventado_999', 10);

    expect(data).toEqual([]);
    // Sin provider registrado: NO debe consultar nada.
    expect(registry.getProvider).not.toHaveBeenCalled();
  });

  it('3. devuelve [] cuando el provider no implementa listRecent (caso transfer_note, kitchen_ticket)', async () => {
    // provider sin listRecent: es lo que hoy retornan transfer-note y
    // kitchen-ticket (lectores reales llegan en Fase 8).
    const provider = { formatType: 'transfer_note' };
    const registry = {
      hasProvider: jest.fn().mockReturnValue(true),
      getProvider: jest.fn().mockReturnValue(provider),
    };
    const svc = buildService(registry);

    const data = await svc.listRecent(42, 'transfer_note', 10);

    expect(data).toEqual([]);
  });

  it('4. capa el limit a 50 incluso si el caller pide 9999', async () => {
    const listRecent = jest.fn().mockResolvedValue([]);
    const provider = { listRecent };
    const registry = {
      hasProvider: jest.fn().mockReturnValue(true),
      getProvider: jest.fn().mockReturnValue(provider),
    };
    const svc = buildService(registry);

    await svc.listRecent(42, 'pos_sale_ticket', 9999);

    expect(listRecent).toHaveBeenCalledWith(42, 50);
  });

  it('5. un limit=0 (o NaN) cae al default 20', async () => {
    const listRecent = jest.fn().mockResolvedValue([]);
    const provider = { listRecent };
    const registry = {
      hasProvider: jest.fn().mockReturnValue(true),
      getProvider: jest.fn().mockReturnValue(provider),
    };
    const svc = buildService(registry);

    // limit=0: `Number(0) || 20` → 20 (porque 0 es falsy), luego
    // Math.max(20, 1) = 20 y Math.min(20, 50) = 20.
    await svc.listRecent(42, 'pos_sale_ticket', 0);
    expect(listRecent).toHaveBeenLastCalledWith(42, 20);

    // NaN: `Number(NaN) || 20` → 20, mismo camino.
    await svc.listRecent(42, 'pos_sale_ticket', NaN as any);
    expect(listRecent).toHaveBeenLastCalledWith(42, 20);
  });

  it('6. un formatType vacío devuelve [] sin consultar el registry', async () => {
    const registry = {
      hasProvider: jest.fn(),
      getProvider: jest.fn(),
    };
    const svc = buildService(registry);

    const data = await svc.listRecent(42, '', 10);

    expect(data).toEqual([]);
    expect(registry.hasProvider).not.toHaveBeenCalled();
  });
});
