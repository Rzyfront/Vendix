import { QuotationsService } from './quotations.service';
import { ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * F-001/F-002 — bloqueo mutuo venta/contrato sin base de datos: `convertToOrder`
 * rechaza destino distinto de `sale` con QUOTE_DESTINATION_001 sin crear orden,
 * y el mapa admite `accepted->contracted` sin tocar `converted`.
 */
describe('QuotationsService bloqueo mutuo de destino (F-001/F-002)', () => {
  const quotationsMock = { findFirst: jest.fn() };
  const contractsMock = { findMany: jest.fn() };
  const quotationWrites = { updateMany: jest.fn() };
  const ordersCreate = jest.fn();
  const service = new QuotationsService(
    { quotations: { ...quotationsMock, ...quotationWrites }, contracts: contractsMock } as any,
    { create: ordersCreate } as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

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

  it('solo adjunta referencia contractual consultada con store y organización', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 12,
      organization_id: 34,
    } as any);
    contractsMock.findMany.mockResolvedValue([
      { quotation_id: 7, id: 91, contract_number: 'CT-1', status: 'draft' },
    ]);

    const [result] = await (service as any).withContractReferences([
      { id: 7, status: 'contracted' },
    ]);

    expect(result.contract).toEqual({
      id: 91,
      contract_number: 'CT-1',
      status: 'draft',
    });
    expect(contractsMock.findMany).toHaveBeenCalledWith({
      where: {
        quotation_id: { in: [7] },
        store_id: 12,
        organization_id: 34,
      },
      select: { quotation_id: true, id: true, contract_number: true, status: true },
    });
  });

  it('cancela condicionalmente el estado leído para no pisar una conversión concurrente', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 12,
      organization_id: 34,
    } as any);
    quotationsMock.findFirst.mockResolvedValue({ id: 7, status: 'accepted' });
    quotationWrites.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.cancel(7)).rejects.toThrow(
      'La cotización cambió de estado y ya no puede cancelarse.',
    );
    expect(quotationWrites.updateMany).toHaveBeenCalledWith({
      where: {
        id: 7,
        status: 'accepted',
        store_id: 12,
        store: { is: { organization_id: 34 } },
      },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
  });
});
