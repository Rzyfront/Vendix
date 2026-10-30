import { NotFoundException } from '@nestjs/common';
import { ProviderScheduleService } from './provider-schedule.service';

/**
 * QUI-966 (S2) — `provider_schedules` / `provider_exceptions` are not in the
 * store scope, so every read/delete must first prove the provider belongs to
 * the current store through the scoped `service_providers` delegate.
 */
describe('ProviderScheduleService (QUI-966 S2 tenant isolation)', () => {
  let prisma: any;
  let service: ProviderScheduleService;

  beforeEach(() => {
    prisma = {
      // Scoped delegate: returns null for providers of other stores.
      service_providers: { findFirst: jest.fn() },
      provider_schedules: { findMany: jest.fn().mockResolvedValue([]) },
      provider_exceptions: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new ProviderScheduleService(prisma);
  });

  it('does not read the schedule of a provider from another store', async () => {
    prisma.service_providers.findFirst.mockResolvedValue(null);
    await expect(service.getSchedule(1)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.provider_schedules.findMany).not.toHaveBeenCalled();
  });

  it('reads the schedule of an own provider', async () => {
    prisma.service_providers.findFirst.mockResolvedValue({ id: 1 });
    await expect(service.getSchedule(1)).resolves.toEqual([]);
  });

  it('does not list exceptions of a provider from another store', async () => {
    prisma.service_providers.findFirst.mockResolvedValue(null);
    await expect(service.getExceptions(1)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.provider_exceptions.findMany).not.toHaveBeenCalled();
  });

  it('does not delete an exception of a provider from another store', async () => {
    prisma.service_providers.findFirst.mockResolvedValue(null);
    await expect(service.deleteException(1, 7)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.provider_exceptions.delete).not.toHaveBeenCalled();
  });

  it('does not delete an exception that belongs to a different provider', async () => {
    prisma.service_providers.findFirst.mockResolvedValue({ id: 1 });
    prisma.provider_exceptions.findFirst.mockResolvedValue(null);
    await expect(service.deleteException(1, 7)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.provider_exceptions.findFirst).toHaveBeenCalledWith({
      where: { id: 7, provider_id: 1 },
    });
    expect(prisma.provider_exceptions.delete).not.toHaveBeenCalled();
  });

  it('deletes an exception of an own provider', async () => {
    prisma.service_providers.findFirst.mockResolvedValue({ id: 1 });
    prisma.provider_exceptions.findFirst.mockResolvedValue({ id: 7, provider_id: 1 });
    await service.deleteException(1, 7);
    expect(prisma.provider_exceptions.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});
