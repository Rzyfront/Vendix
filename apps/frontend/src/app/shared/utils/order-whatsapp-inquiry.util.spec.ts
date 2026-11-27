import { buildOrderInquiryMessage } from './order-whatsapp-inquiry.util';

describe('buildOrderInquiryMessage', () => {
  it('keeps the exact «preguntar por WhatsApp» text of the order summary', () => {
    // Golden copy of the message guest-order-summary built inline before.
    const legacy =
      `¡Hola! 👋 Quisiera consultar el estado de mi pedido en Tienda Demo.\n\n` +
      `*Pedido:* #ORD-77\n` +
      `*Estado:* Confirmado\n` +
      `\n*Productos:*\n  - Camiseta (CAM-M) x2\n` +
      `\n*Total:* $ 100.000\n\n¡Muchas gracias!`;
    expect(
      buildOrderInquiryMessage({
        storeName: 'Tienda Demo',
        orderNumber: 'ORD-77',
        stateLabel: 'Confirmado',
        itemLines: '  - Camiseta (CAM-M) x2',
        totalLabel: '$ 100.000',
      }),
    ).toBe(legacy);
  });

  it('Vexi handoff: order number plus the summary link, no empty lines', () => {
    expect(
      buildOrderInquiryMessage({
        storeName: 'Tienda Demo',
        orderNumber: 'ORD-77',
        summaryUrl: 'https://tienda.vendix.com/pedido/abc',
      }),
    ).toBe(
      `¡Hola! 👋 Quisiera consultar el estado de mi pedido en Tienda Demo.\n\n` +
        `*Pedido:* #ORD-77\n` +
        `\n*Resumen:* https://tienda.vendix.com/pedido/abc\n` +
        `\n¡Muchas gracias!`,
    );
  });
});
