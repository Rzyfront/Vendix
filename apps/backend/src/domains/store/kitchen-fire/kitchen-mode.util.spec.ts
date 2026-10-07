import { normalizeKitchenMode, resolveKitchenMode } from './kitchen-mode.util';

describe('normalizeKitchenMode', () => {
  it.each([undefined, null, 'foo', 'virtual', '', 'PHYSICAL', 1, true])(
    '%p => virtual',
    (raw) => {
      expect(normalizeKitchenMode(raw)).toBe('virtual');
    },
  );

  it("'physical' => physical", () => {
    expect(normalizeKitchenMode('physical')).toBe('physical');
  });
});

describe('resolveKitchenMode', () => {
  const clientWith = (row: any) => ({
    store_settings: { findFirst: jest.fn().mockResolvedValue(row) },
  });

  it('physical solo si el setting es exactamente physical', async () => {
    const c = clientWith({ settings: { restaurant: { kitchen_mode: 'physical' } } });
    await expect(resolveKitchenMode(c, 1)).resolves.toBe('physical');
    expect(c.store_settings.findFirst).toHaveBeenCalledWith({
      where: { store_id: 1 },
      select: { settings: true },
    });
  });

  it('fila ausente o sin restaurant => virtual', async () => {
    await expect(resolveKitchenMode(clientWith(null), 1)).resolves.toBe('virtual');
    await expect(resolveKitchenMode(clientWith({ settings: {} }), 1)).resolves.toBe('virtual');
  });
});
