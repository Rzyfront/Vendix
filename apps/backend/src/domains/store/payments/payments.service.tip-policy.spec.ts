import { PaymentsService } from './payments.service';

/**
 * El helper no usa dependencias de la clase salvo settingsService/roundMoney,
 * así que se prueba sin montar el servicio completo.
 */
const build = (tips: any) => {
  const svc: any = Object.create(PaymentsService.prototype);
  svc.settingsService = {
    getSettings: jest.fn().mockResolvedValue({ pos: { tips } }),
  };
  svc.roundMoney = (v: number) => Math.round(v * 100) / 100;
  return svc;
};
const txWith = (industries: string[]) => ({
  stores: { findUnique: jest.fn().mockResolvedValue({ industries }) },
});

describe('PaymentsService.assertPosTipPolicy', () => {
  it('rechaza propina en tienda no restaurante sin config', async () => {
    const svc = build(undefined);
    await expect(
      svc.assertPosTipPolicy(txWith(['retail']), { tip_amount: 1000 }, 1, 10000),
    ).rejects.toMatchObject({
      errorCode: 'TIP_NOT_ENABLED_001',
    });
  });

  it('acepta propina en restaurante sin config', async () => {
    const svc = build(undefined);
    await expect(
      svc.assertPosTipPolicy(
        txWith(['restaurant']),
        { tip_amount: 1000 },
        1,
        10000,
      ),
    ).resolves.toBeUndefined();
  });

  it('sin propina no lee settings ni industria', async () => {
    const svc = build(undefined);
    const tx = txWith(['retail']);
    await svc.assertPosTipPolicy(tx, {}, 1, 10000);
    expect(svc.settingsService.getSettings).not.toHaveBeenCalled();
    expect(tx.stores.findUnique).not.toHaveBeenCalled();
  });
});
