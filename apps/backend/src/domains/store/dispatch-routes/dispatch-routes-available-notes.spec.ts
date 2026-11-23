import { RequestContextService } from '@common/context/request-context.service';
import { DispatchRoutesService } from './dispatch-routes.service';

/**
 * `listAvailableNotes` alimenta el selector de remisiones del wizard de
 * planilla y del modal "Agregar remisiones". La exclusión de remisiones ya
 * planilladas debe ir en la consulta (no en memoria después de un `take`), con
 * paginación, búsqueda en servidor y el total real.
 */
describe('DispatchRoutesService — listAvailableNotes (remisiones disponibles)', () => {
  const STORE_ID = 100;
  let prisma: any;
  let service: DispatchRoutesService;

  const note = (id: number) => ({
    id,
    dispatch_number: `REM-${id}`,
    customer_name: `Cliente ${id}`,
    customer: null,
    grand_total: 1000,
    status: 'confirmed',
    needs_collection: true,
    customer_address: null,
    order: null,
  });

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID } as any);
    prisma = {
      dispatch_route_stops: { findMany: jest.fn() },
      dispatch_notes: {
        findMany: jest.fn().mockResolvedValue([note(30), note(29)]),
        count: jest.fn().mockResolvedValue(30),
      },
    };
    service = new DispatchRoutesService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('excluye en la consulta las remisiones con parada no liberada (incluye rutas draft)', async () => {
    await service.listAvailableNotes();

    const args = prisma.dispatch_notes.findMany.mock.calls[0][0];
    expect(args.where).toEqual(
      expect.objectContaining({
        store_id: STORE_ID,
        direction: 'outbound',
        subtype: 'customer_delivery',
        status: { in: ['draft', 'confirmed'] },
        // Solo `released` libera: `rejected` sigue ocupando el índice único
        // parcial de `dispatch_note_id`, así que también bloquea.
        dispatch_route_stops: { none: { status: { not: 'released' } } },
      }),
    );
    // Ya no se consultan las paradas aparte para filtrar en memoria.
    expect(prisma.dispatch_route_stops.findMany).not.toHaveBeenCalled();
  });

  it('devuelve el total real con el mismo filtro y no recorta en memoria', async () => {
    const result = await service.listAvailableNotes();

    const findArgs = prisma.dispatch_notes.findMany.mock.calls[0][0];
    expect(prisma.dispatch_notes.count).toHaveBeenCalledWith({
      where: findArgs.where,
    });
    expect(result.total).toBe(30);
    expect(result.data.map((n) => n.id)).toEqual([30, 29]);
  });

  it('pagina por defecto 50 por página desde la primera', async () => {
    const result = await service.listAvailableNotes();

    const args = prisma.dispatch_notes.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
    expect(args.orderBy).toEqual([{ created_at: 'desc' }, { id: 'desc' }]);
    expect(result).toEqual(expect.objectContaining({ page: 1, limit: 50 }));
  });

  it('respeta page/limit y recorta el limit a 100', async () => {
    await service.listAvailableNotes({ page: 3, limit: 20 });
    let args = prisma.dispatch_notes.findMany.mock.calls[0][0];
    expect(args.skip).toBe(40);
    expect(args.take).toBe(20);

    const result = await service.listAvailableNotes({ page: 2, limit: 500 });
    args = prisma.dispatch_notes.findMany.mock.calls[1][0];
    expect(args.take).toBe(100);
    expect(args.skip).toBe(100);
    expect(result.limit).toBe(100);
  });

  it('busca en el servidor por número, cliente y documento', async () => {
    await service.listAvailableNotes({ search: '  REM-7  ' });

    const { where } = prisma.dispatch_notes.findMany.mock.calls[0][0];
    const contains = { contains: 'REM-7', mode: 'insensitive' };
    expect(where.OR).toEqual([
      { dispatch_number: contains },
      { customer_name: contains },
      { customer_tax_id: contains },
      {
        customer: {
          is: {
            OR: [
              { legal_name: contains },
              { first_name: contains },
              { last_name: contains },
              { document_number: contains },
            ],
          },
        },
      },
    ]);
    // La búsqueda se suma al filtro de bloqueo, no lo reemplaza.
    expect(where.dispatch_route_stops).toEqual({
      none: { status: { not: 'released' } },
    });
  });

  it('sin término de búsqueda no agrega OR', async () => {
    await service.listAvailableNotes({ search: '   ' });

    const { where } = prisma.dispatch_notes.findMany.mock.calls[0][0];
    expect(where.OR).toBeUndefined();
  });

  it('filtra por ids puntuales sin quitar el filtro de bloqueo', async () => {
    await service.listAvailableNotes({ ids: [12, 34] });

    const { where } = prisma.dispatch_notes.findMany.mock.calls[0][0];
    expect(where.id).toEqual({ in: [12, 34] });
    expect(where.dispatch_route_stops).toEqual({
      none: { status: { not: 'released' } },
    });
  });
});
