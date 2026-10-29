import { RequestContextService } from '@common/context/request-context.service';
import { ManufacturingSettingsService } from './manufacturing-settings.service';

describe('ManufacturingSettingsService', () => {
  let prisma: any;
  let service: ManufacturingSettingsService;

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1 } as any);
    prisma = {
      manufacturing_settings: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      inventory_locations: { findFirst: jest.fn() },
    };
    service = new ManufacturingSettingsService(prisma);
  });

  afterEach(() => jest.restoreAllMocks());

  it('devuelve los valores por defecto cuando no hay fila', async () => {
    prisma.manufacturing_settings.findFirst.mockResolvedValue(null);
    await expect(service.get()).resolves.toEqual({
      default_input_location_id: null,
      default_output_location_id: null,
      cost_method: 'fifo',
      lot_required: false,
      wip_account_id: null,
    });
  });

  it('crea la fila en el primer PATCH', async () => {
    prisma.manufacturing_settings.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        default_input_location_id: null,
        default_output_location_id: null,
        cost_method: 'cpp',
        lot_required: true,
        wip_account_id: null,
      });
    const result = await service.update({ cost_method: 'cpp', lot_required: true });
    expect(prisma.manufacturing_settings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ store_id: 1, cost_method: 'cpp', lot_required: true }),
    });
    expect(result.cost_method).toBe('cpp');
    expect(result.lot_required).toBe(true);
  });

  it('actualiza la fila existente y valida la bodega', async () => {
    prisma.manufacturing_settings.findFirst
      .mockResolvedValueOnce({ id: 9 })
      .mockResolvedValueOnce({ cost_method: 'fifo', lot_required: false });
    prisma.inventory_locations.findFirst.mockResolvedValue({ id: 5 });
    await service.update({ default_input_location_id: 5 });
    expect(prisma.manufacturing_settings.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ default_input_location_id: 5 }),
    });
  });

  it('rechaza una bodega inexistente', async () => {
    prisma.inventory_locations.findFirst.mockResolvedValue(null);
    await expect(
      service.update({ default_output_location_id: 99 }),
    ).rejects.toMatchObject({ errorCode: 'MFG_INVALID_LOCATION' });
    expect(prisma.manufacturing_settings.create).not.toHaveBeenCalled();
  });
});
