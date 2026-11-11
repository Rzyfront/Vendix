import { unpaidFinalConsumerConfirm } from './unpaid-final-consumer-confirm.util';

describe('unpaidFinalConsumerConfirm', () => {
  it('without a holder: warns the invoice goes out to Consumidor final 222222222222', () => {
    const data = unpaidFinalConsumerConfirm();
    expect(data.message).toContain('Consumidor final 222222222222');
    expect(data.confirmText).toBe('Sí, emitir a Consumidor final');
  });

  it('with a complete holder: names the holder and never mentions Consumidor final', () => {
    const data = unpaidFinalConsumerConfirm(1, 'ESPUMADOS <S.A.>');
    expect(data.message).toContain('a nombre de ESPUMADOS &lt;S.A.&gt;');
    expect(data.message).toContain('«Acuerdo mutuo»');
    expect(data.message).not.toContain('Consumidor final');
    expect(data.message).not.toContain('222222222222');
    expect(data.confirmText).toBe('Sí, emitir de contado');
  });

  it('bulk wording (count > 1) keeps Consumidor final', () => {
    const data = unpaidFinalConsumerConfirm(3);
    expect(data.title).toBe('Órdenes sin pagar');
    expect(data.message).toContain('Consumidor final 222222222222');
  });
});
