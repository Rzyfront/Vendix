import { PaymentsService } from './payments.service';

/**
 * El helper sólo usa la tx y roundMoney, así que se prueba sin montar el
 * servicio completo. Lee la industria (memoizada por tx, S12) y los settings en consultas livianas.
 */
const build = () => {
  const svc: any = Object.create(PaymentsService.prototype);
  svc.roundMoney = (v: number) => Math.round(v * 100) / 100;
  return svc;
};
const txWith = (industries: string[], tips?: any) => ({
  stores: {
    findUnique: jest.fn(({ select }: { select: Record<string, unknown> }) =>
      Promise.resolve(
        select.industries
          ? { industries }
          : { store_settings: { settings: { pos: { tips } } } },
      ),
    ),
  },
});
const industryReads = (tx: ReturnType<typeof txWith>) =>
  tx.stores.findUnique.mock.calls.filter(([a]) => a.select.industries).length;

describe('PaymentsService.assertPosTipPolicy', () => {
  it('rechaza propina en tienda no restaurante sin config', async () => {
    const svc = build();
    await expect(
      svc.assertPosTipPolicy(txWith(['retail']), { tip_amount: 1000 }, 1, 10000),
    ).rejects.toMatchObject({
      errorCode: 'TIP_NOT_ENABLED_001',
    });
  });

  it('acepta propina en restaurante sin config', async () => {
    const svc = build();
    await expect(
      svc.assertPosTipPolicy(
        txWith(['restaurant']),
        { tip_amount: 1000 },
        1,
        10000,
      ),
    ).resolves.toBeUndefined();
  });

  it('acepta propina en tienda no restaurante con tips.enabled=true', async () => {
    const svc = build();
    await expect(
      svc.assertPosTipPolicy(
        txWith(['retail'], { enabled: true }),
        { tip_amount: 1000 },
        1,
        10000,
      ),
    ).resolves.toBeUndefined();
  });

  it('sin propina no lee settings ni industria', async () => {
    const svc = build();
    const tx = txWith(['retail']);
    await svc.assertPosTipPolicy(tx, {}, 1, 10000);
    expect(tx.stores.findUnique).not.toHaveBeenCalled();
  });

  it('S12: con propina, la industria se lee una sola vez aunque otro paso de la venta la pida antes', async () => {
    const svc = build();
    const tx = txWith(['restaurant']);
    await svc.isRestaurantStore(tx, 1);
    await svc.assertPosTipPolicy(tx, { tip_amount: 1000 }, 1, 10000);
    await svc.isRestaurantStore(tx, 1);
    expect(industryReads(tx)).toBe(1);
  });

  it('S12: otra transacción vuelve a leer la industria (no se comparte entre ventas)', async () => {
    const svc = build();
    const txA = txWith(['restaurant']);
    const txB = txWith(['retail']);
    expect(await svc.isRestaurantStore(txA, 1)).toBe(true);
    expect(await svc.isRestaurantStore(txB, 1)).toBe(false);
    expect(industryReads(txA)).toBe(1);
    expect(industryReads(txB)).toBe(1);
  });

  it('S12: fuera de una transacción (cliente compartido) no memoiza', async () => {
    const svc = build();
    const shared = txWith(['restaurant']);
    svc.prisma = shared;
    await svc.isRestaurantStore(shared, 1);
    await svc.isRestaurantStore(shared, 1);
    expect(industryReads(shared)).toBe(2);
  });
});
