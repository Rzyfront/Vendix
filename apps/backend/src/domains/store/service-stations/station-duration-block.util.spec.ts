import {
  assertDurationFitsBlocks,
  assertProductFitsLinkedStations,
  assertStationFitsLinkedServices,
} from './station-duration-block.util';

const rate = (service_duration_minutes: number | null) => ({
  service_duration_minutes,
  rental_pricing_mode: 'station_rate',
});

function catchError(fn: () => void): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

describe('station duration vs block (S7-f)', () => {
  it('rejects a duration that is not a multiple of the block with STATION_017 and a Spanish message', () => {
    const err = catchError(() =>
      assertDurationFitsBlocks(rate(45), [{ name: 'Sala 1', rental_block_minutes: 30 }]),
    );
    expect(err.errorCode).toBe('STATION_017');
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse().message).toBe(
      'La duración del servicio (45 min) debe ser múltiplo del bloque de la estación «Sala 1» (30 min).',
    );
  });

  it('accepts a multiple, and stations without block', () => {
    expect(() =>
      assertDurationFitsBlocks(rate(90), [
        { name: 'Sala 1', rental_block_minutes: 30 },
        { name: 'Sala 2', rental_block_minutes: null },
      ]),
    ).not.toThrow();
  });

  it('does not validate services that are not station_rate', () => {
    expect(() =>
      assertDurationFitsBlocks(
        { service_duration_minutes: 45, rental_pricing_mode: 'fixed_price' },
        [{ name: 'Sala 1', rental_block_minutes: 30 }],
      ),
    ).not.toThrow();
    expect(() =>
      assertDurationFitsBlocks({ service_duration_minutes: 45, rental_pricing_mode: null }, [
        { name: 'Sala 1', rental_block_minutes: 30 },
      ]),
    ).not.toThrow();
  });

  it('product wrapper reads the linked stations and rejects the mismatch', async () => {
    const prisma = {
      service_station_services: {
        findMany: jest.fn().mockResolvedValue([{ station: { name: 'Sala 1', rental_block_minutes: 30 } }]),
      },
    };
    await expect(assertProductFitsLinkedStations(prisma, 1, 7, rate(45))).rejects.toMatchObject({
      errorCode: 'STATION_017',
    });
    expect(prisma.service_station_services.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: 1, product_id: 7 } }),
    );
  });

  it('product wrapper skips the query for non station_rate services', async () => {
    const prisma = { service_station_services: { findMany: jest.fn() } };
    await assertProductFitsLinkedStations(prisma, 1, 7, { service_duration_minutes: 45, rental_pricing_mode: null });
    expect(prisma.service_station_services.findMany).not.toHaveBeenCalled();
  });

  it('station wrapper rejects a new block that does not divide a linked service duration', async () => {
    const prisma = {
      service_station_services: {
        findMany: jest.fn().mockResolvedValue([{ product: rate(45) }]),
      },
    };
    await expect(
      assertStationFitsLinkedServices(prisma, 1, { id: 2, name: 'Sala 1', rental_block_minutes: 30 }),
    ).rejects.toMatchObject({ errorCode: 'STATION_017' });
  });
});
