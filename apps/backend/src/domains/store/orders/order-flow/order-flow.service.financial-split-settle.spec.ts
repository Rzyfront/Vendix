import { OrderFlowService } from './order-flow.service';

/**
 * Reparto financiero saldado en orden de mesa (caso prod 9635): la orden debe
 * promoverse draft->created->processing sin cerrar la sesion, sin commit de
 * stock direct_delivery y debe poder finalizarse via fast_track sin cobrar.
 * Los demas pagos/mutaciones de dinero siguen bloqueados.
 */
describe('OrderFlowService — reparto financiero saldado (mesa)', () => {
  const paid = (amount: number) => ({ state: 'succeeded', amount });

  const build = (opts: {
    state?: string;
    payments?: any[];
    table?: boolean;
    split?: number | null;
  }) => {
    const state = { value: opts.state ?? 'draft' };
    const prisma: any = {
      table_sessions: { findFirst: jest.fn(async () => (opts.table === false ? null : { id: 910 })) },
      orders: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => ({ channel: 'pos', delivery_type: 'direct_delivery', order_items: [] })),
      },
    };
    const commit = { commitOrderDelivery: jest.fn(async () => undefined) };
    const service = new OrderFlowService(
      prisma, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (service as any).orderStockCommit = commit;
    (service as any).eventEmitter = { emit: jest.fn() };
    const base = () => ({
      id: 9635,
      store_id: 105,
      state: state.value,
      order_number: 'X',
      delivery_type: 'dine_in',
      shipping_method_id: null,
      grand_total: 138500,
      active_financial_split_id: opts.split === undefined ? 3 : opts.split,
      payments: opts.payments ?? [paid(60000), paid(78500)],
      order_items: [{ id: 1 }],
    });
    jest.spyOn(service as any, 'getOrder').mockImplementation(async () => base());
    const promote = jest
      .spyOn(service as any, 'promoteDraftToCreated')
      .mockImplementation(async () => { state.value = 'created'; return true; });
    const updateState = jest
      .spyOn(service as any, 'updateOrderState')
      .mockImplementation(async (_id: number, s: string) => { state.value = s; return { id: 9635, state: s }; });
    jest.spyOn(service as any, 'validateTransition').mockReturnValue(undefined);
    const payOrder = jest.spyOn(service, 'payOrder').mockResolvedValue({} as any);
    const ship = jest.spyOn(service, 'shipOrder').mockImplementation(async () => { state.value = 'shipped'; return {} as any; });
    const deliver = jest.spyOn(service, 'deliverOrder').mockImplementation(async () => { state.value = 'delivered'; return {} as any; });
    const confirm = jest.spyOn(service, 'confirmDelivery').mockImplementation(async () => { state.value = 'finished'; return {} as any; });
    jest.spyOn(service as any, 'fastTrackIncludes').mockReturnValue({});
    return { service, prisma, commit, promote, updateState, payOrder, ship, deliver, confirm };
  };

  describe('settleFinancialSplitSource', () => {
    it('mesa saldada en draft: promueve a created, avanza a processing y NO hace commit direct_delivery', async () => {
      const h = build({});
      await h.service.settleFinancialSplitSource(9635);
      expect(h.promote).toHaveBeenCalledWith(9635, 105);
      expect(h.prisma.orders.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'processing' }) }),
      );
      expect(h.commit.commitOrderDelivery).not.toHaveBeenCalled();
      expect(h.prisma.orders.findFirst).not.toHaveBeenCalled();
    });

    it('mesa con pago incompleto: no promueve ni avanza', async () => {
      const h = build({ payments: [paid(60000)] });
      await h.service.settleFinancialSplitSource(9635);
      expect(h.promote).not.toHaveBeenCalled();
      expect(h.prisma.orders.updateMany).not.toHaveBeenCalled();
    });

    it('mesa: si la reserva falla no propaga (pago ya hecho) ni avanza a processing', async () => {
      const h = build({});
      h.promote.mockRejectedValueOnce(new Error('stock'));
      await expect(h.service.settleFinancialSplitSource(9635)).resolves.toBeUndefined();
      expect(h.prisma.orders.updateMany).not.toHaveBeenCalled();
    });

    it('sin mesa conserva el commit direct_delivery', async () => {
      const h = build({ table: false });
      await h.service.settleFinancialSplitSource(9635);
      expect(h.commit.commitOrderDelivery).toHaveBeenCalledTimes(1);
    });
  });

  describe('fastTrackOrder', () => {
    it('recuperacion: draft con split saldado -> promote, processing, ship, deliver, finish SIN pagar', async () => {
      const h = build({});
      await h.service.fastTrackOrder(9635, {} as any);
      expect(h.payOrder).not.toHaveBeenCalled();
      expect(h.promote).toHaveBeenCalledWith(9635, 105);
      expect(h.updateState).toHaveBeenCalledWith(9635, 'processing', {});
      expect(h.ship).toHaveBeenCalled();
      expect(h.deliver).toHaveBeenCalled();
      expect(h.confirm).toHaveBeenCalledWith(9635);
    });

    it('split saldado ya en processing: no re-promueve, finaliza sin pagar', async () => {
      const h = build({ state: 'processing' });
      await h.service.fastTrackOrder(9635, {} as any);
      expect(h.promote).not.toHaveBeenCalled();
      expect(h.payOrder).not.toHaveBeenCalled();
      expect(h.confirm).toHaveBeenCalled();
    });

    it('split SIN saldar: SPLIT_ACCOUNT_LOCKED, no muta nada', async () => {
      const h = build({ payments: [paid(60000)] });
      await expect(h.service.fastTrackOrder(9635, {} as any)).rejects.toMatchObject({
        errorCode: 'SPLIT_ACCOUNT_LOCKED',
      });
      expect(h.payOrder).not.toHaveBeenCalled();
      expect(h.promote).not.toHaveBeenCalled();
      expect(h.ship).not.toHaveBeenCalled();
    });

    it('pay sigue bloqueado con split saldado (aun con payment en el dto)', async () => {
      jest.restoreAllMocks();
      const real = new OrderFlowService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
      jest.spyOn(real as any, 'getOrder').mockResolvedValue({
        id: 9635, store_id: 105, state: 'created', delivery_type: 'dine_in',
        grand_total: 138500, active_financial_split_id: 3, payments: [paid(138500)],
      });
      await expect(real.confirmPayment(9635)).rejects.toMatchObject({ errorCode: 'SPLIT_ACCOUNT_LOCKED' });
    });
  });
});
