import {
  buildPaymentInstructions,
  buildPaymentMethodsWhere,
  ONLINE_PAGE_PROCESSING_MODES,
  toPublicPaymentMethod,
} from './online-payment-methods.util';

describe('online-payment-methods.util', () => {
  describe('buildPaymentMethodsWhere', () => {
    it('hides cash unless the buyer picks up, and wallet unless authenticated', () => {
      const where = buildPaymentMethodsWhere({
        allowedModes: ['DIRECT', 'ONLINE'] as any,
        isPickup: false,
        isAuthenticated: false,
      });
      expect(where).toEqual({
        state: 'enabled',
        AND: [
          { system_payment_method: { processing_mode: { in: ['DIRECT', 'ONLINE'] } } },
          { system_payment_method: { type: { not: 'cash' } } },
          { system_payment_method: { NOT: { type: 'wallet' } } },
        ],
      });
    });

    it('keeps cash and wallet filters off for authenticated pickup', () => {
      const where = buildPaymentMethodsWhere({
        allowedModes: ['DIRECT'] as any,
        isPickup: true,
        isAuthenticated: true,
      });
      expect(where.AND).toHaveLength(1);
    });

    it('the payment page modes exclude cash on delivery', () => {
      expect(ONLINE_PAGE_PROCESSING_MODES).not.toContain('ON_DELIVERY');
    });
  });

  describe('buildPaymentInstructions', () => {
    it('whitelists bank transfer fields and drops empties', () => {
      expect(
        buildPaymentInstructions('bank_transfer', {
          bank_name: 'Bancolombia',
          account_number: '123',
          secret_token: 'x',
          instructions: '',
        }),
      ).toEqual({ bank_name: 'Bancolombia', account_number: '123' });
    });

    it('returns null for other types or empty config', () => {
      expect(buildPaymentInstructions('wompi', { a: 1 })).toBeNull();
      expect(buildPaymentInstructions('bank_transfer', {})).toBeNull();
      expect(buildPaymentInstructions('voucher', null)).toBeNull();
    });
  });

  describe('toPublicPaymentMethod', () => {
    it('maps a store method and attaches instructions only when present', () => {
      const row = {
        id: 4,
        display_name: null,
        min_amount: null,
        max_amount: null,
        custom_config: { voucher_instructions: 'Llama', private: 'x' },
        system_payment_method: {
          display_name: 'Bono',
          type: 'voucher',
          provider: 'x',
          processing_mode: 'ONLINE',
          logo_url: null,
        },
      };
      expect(toPublicPaymentMethod(row as any)).toEqual({
        id: 4,
        name: 'Bono',
        type: 'voucher',
        provider: 'x',
        processing_mode: 'ONLINE',
        logo_url: null,
        min_amount: null,
        max_amount: null,
        payment_instructions: { voucher_instructions: 'Llama' },
      });
    });
  });
});
