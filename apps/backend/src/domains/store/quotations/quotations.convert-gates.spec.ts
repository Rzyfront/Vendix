import { QuotationsService } from './quotations.service';
import { ErrorCodes } from 'src/common/errors';

/**
 * F-001/F-002 — bloqueo mutuo venta/contrato sin base de datos: `convertToOrder`
 * rechaza destino distinto de `sale` con QUOTE_DESTINATION_001 sin crear orden,
 * y el mapa admite `accepted->contracted` sin tocar `converted`.
 */
describe('QuotationsService bloqueo mutuo de destino (F-001/F-002)', () => {
  const quotationsMock = { findFirst: jest.fn() };
  const ordersCreate = jest.fn();
  const service = new QuotationsService(
    { quotations: quotationsMock } as any,
    { create: ordersCreate } as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each(['contract', 'other'])(
    'convertToOrder rechaza destino %s sin crear orden',
    async (destination) => {
      quotationsMock.findFirst.mockResolvedValue({
        id: 7,
        status: 'accepted',
        destination,
        customer_id: 3,
        quotation_items: [],
      });

      const err = await service.convertToOrder(7).catch((e) => e);
      expect(err?.errorCode).toBe(ErrorCodes.QUOTE_DESTINATION_001.code);
      expect(ordersCreate).not.toHaveBeenCalled();
    },
  );

  it('accepted admite contracted y converted sigue terminal', () => {
    const map = (service as any).VALID_TRANSITIONS;
    expect(map.accepted).toEqual(
      expect.arrayContaining(['converted', 'contracted']),
    );
    expect(map.contracted).toEqual([]);
    expect(map.converted).toEqual([]);
  });
});
