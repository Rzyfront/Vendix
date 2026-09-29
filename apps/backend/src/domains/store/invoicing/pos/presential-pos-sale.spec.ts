import {
  INVOICE_AUTO_SEND_FAILED_ALERT,
  isPresentialPosSale,
} from './presential-pos-sale';

describe('isPresentialPosSale', () => {
  it.each([
    ['pos', 'direct_delivery', true],
    ['pos', 'pickup', true],
    ['pos', 'home_delivery', true],
    ['pos', 'dine_in', true],
    // Mesa abierta por QR: nace ecommerce + dine_in (openTableSessionPublic).
    ['ecommerce', 'dine_in', true],
    ['ecommerce', 'home_delivery', false],
    ['ecommerce', 'pickup', false],
    ['ecommerce', 'other', false],
    ['whatsapp', 'home_delivery', false],
    [null, null, false],
  ])('channel=%s delivery_type=%s ⇒ %s', (channel, delivery_type, expected) => {
    expect(isPresentialPosSale({ channel, delivery_type })).toBe(expected);
  });

  it('el código del banner es el que lee el diccionario del frontend', () => {
    expect(INVOICE_AUTO_SEND_FAILED_ALERT).toBe('INVOICE_AUTO_SEND_FAILED');
  });
});
