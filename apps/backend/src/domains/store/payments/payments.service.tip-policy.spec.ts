import { PaymentsService } from './payments.service';

/**
 * El helper sólo usa la tx y roundMoney, así que se prueba sin montar el
 * servicio completo. Lee settings e industria en una sola consulta liviana.
 */
const build = () => {
  const svc: any = Object.create(PaymentsService.prototype);
  svc.roundMoney = (v: number) => Math.round(v * 100) / 100;
  return svc;
};
const txWith = (industries: string[], tips?: any) => ({
  stores: {
    findUnique: jest.fn().mockResolvedValue({
      industries,
      store_settings: { settings: { pos: { tips } } },
    }),
  },
});

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
});
