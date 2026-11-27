import { orderSummaryUrl, vexiOrderHandoffUrl } from './vexi-public.handoff';
import { buildOrderInquiryMessage } from '../../shared/utils/order-whatsapp-inquiry.util';

const ORIGIN = 'https://tienda.vendix.com';

describe('Vexi público handoff to WhatsApp (F2, D5)', () => {
  it('guest order: wa.me to the store with the order number and its public summary link', () => {
    const url = vexiOrderHandoffUrl(
      '573001234567',
      'Tienda Demo',
      { order_id: 9, order_number: 'ORD-77', public_order_token: 'tok-1' },
      ORIGIN,
    );
    const expectedText = buildOrderInquiryMessage({
      storeName: 'Tienda Demo',
      orderNumber: 'ORD-77',
      summaryUrl: `${ORIGIN}/pedido/tok-1`,
    });
    expect(url).toBe(
      `https://wa.me/573001234567?text=${encodeURIComponent(expectedText)}`,
    );
    expect(decodeURIComponent(url!.split('?text=')[1])).toContain('*Pedido:* #ORD-77');
  });

  it('logged-in customer: the summary link is the account order', () => {
    expect(orderSummaryUrl({ order_id: 9, order_number: 'X' }, ORIGIN)).toBe(
      `${ORIGIN}/account/orders/9`,
    );
  });

  it('no valid store WhatsApp → no link', () => {
    for (const number of [null, '', '123'])
      expect(
        vexiOrderHandoffUrl(number, 'T', { order_id: 1, order_number: 'A' }, ORIGIN),
      ).toBeNull();
  });
});
