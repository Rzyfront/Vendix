import { RequestContextService } from '@common/context/request-context.service';
import { DispatchRoutesService } from './dispatch-routes.service';

describe('DispatchRoutesService — remisión con nombre de referencia', () => {
  afterEach(() => jest.restoreAllMocks());

  it('muestra alias y dirección en el pool y resuelve la parada sin ficha de cliente', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 100 } as any);
    const address = {
      address_line1: 'Cra 7 # 1-3',
      city: 'Bogotá',
      latitude: 4.61,
      longitude: -74.08,
    };
    const note = {
      id: 900,
      dispatch_number: 'REM-900',
      customer_id: null,
      customer_name: 'Portería Torre Norte',
      customer_address: address,
      grand_total: 50000,
      status: 'confirmed',
      needs_collection: true,
      order: null,
    };
    const prisma = {
      dispatch_route_stops: { findMany: jest.fn().mockResolvedValue([]) },
      dispatch_notes: { findMany: jest.fn().mockResolvedValue([note]) },
      dispatch_routes: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          origin_location: null,
          stops: [{ id: 1, stop_sequence: 1, status: 'pending', dispatch_note: note }],
        }),
      },
    };
    const service = new DispatchRoutesService(prisma as any, {} as any, {} as any, {} as any);

    await expect(service.listAvailableNotes()).resolves.toEqual([
      expect.objectContaining({
        customer_name: 'Portería Torre Norte',
        customer_address: address,
      }),
    ]);
    await expect(service.getMapStops(7)).resolves.toEqual(
      expect.objectContaining({
        stops: [expect.objectContaining({
          customerName: 'Portería Torre Norte',
          lat: 4.61,
          lng: -74.08,
        })],
        unlocated: [],
      }),
    );
  });
});
