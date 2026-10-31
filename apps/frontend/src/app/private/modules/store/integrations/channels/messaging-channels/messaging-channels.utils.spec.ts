import {
  emailChannelState,
  formatUsd,
  smsChannelState,
  smsSpendPercent,
} from './messaging-channels.utils';
import {
  EmailChannel,
  SmsChannel,
  SmsSpend,
} from './messaging-channels.interface';

const spend = (patch: Partial<SmsSpend> = {}): SmsSpend => ({
  currency: 'USD',
  period_start: '2026-10-01',
  limit: 50,
  used: 10,
  remaining: 40,
  ...patch,
});

const base = {
  provider: 'aws',
  status: 'connected',
  connected_at: null,
  disconnected_at: null,
  updated_at: '2026-10-01T00:00:00.000Z',
};

const sms = (patch: Partial<SmsChannel> = {}): SmsChannel => ({
  ...base,
  id: 1,
  channel_type: 'sms',
  enabled: true,
  sender_id: null,
  spend: spend(),
  ...patch,
});

const email = (patch: Partial<EmailChannel> = {}): EmailChannel => ({
  ...base,
  id: 2,
  channel_type: 'email',
  enabled: true,
  from_name: null,
  reply_to: null,
  ...patch,
});

describe('messaging-channels.utils', () => {
  describe('smsChannelState', () => {
    it('reports Error when the load failed, whatever was stored', () => {
      expect(smsChannelState(sms(), true)).toEqual({ label: 'Error', variant: 'error' });
      expect(smsChannelState(null, true).label).toBe('Error');
    });

    it('reports Sin configurar when the store never saved SMS', () => {
      expect(smsChannelState(null, false)).toEqual({
        label: 'Sin configurar',
        variant: 'neutral',
      });
    });

    it('reports Desactivado when SMS is off', () => {
      expect(smsChannelState(sms({ enabled: false }), false).label).toBe('Desactivado');
    });

    it('asks for a cap when the limit is missing or 0', () => {
      for (const limit of [null, 0]) {
        expect(smsChannelState(sms({ spend: spend({ limit }) }), false)).toEqual({
          label: 'Pendiente: define un tope',
          variant: 'warning',
        });
      }
    });

    it('reports Tope alcanzado when nothing remains', () => {
      for (const remaining of [0, -1]) {
        expect(smsChannelState(sms({ spend: spend({ remaining }) }), false)).toEqual({
          label: 'Tope alcanzado',
          variant: 'error',
        });
      }
    });

    it('reports Conectado with budget left', () => {
      expect(smsChannelState(sms(), false)).toEqual({ label: 'Conectado', variant: 'success' });
    });
  });

  describe('emailChannelState', () => {
    it('reports Error, Sin configurar, Desactivado and Conectado', () => {
      expect(emailChannelState(email(), true).label).toBe('Error');
      expect(emailChannelState(null, false).label).toBe('Sin configurar');
      expect(emailChannelState(email({ enabled: false }), false).label).toBe('Desactivado');
      expect(emailChannelState(email(), false)).toEqual({
        label: 'Conectado',
        variant: 'success',
      });
    });
  });

  describe('smsSpendPercent', () => {
    it('is 0 without spend or without a cap', () => {
      expect(smsSpendPercent(null)).toBe(0);
      expect(smsSpendPercent(undefined)).toBe(0);
      expect(smsSpendPercent(spend({ limit: null }))).toBe(0);
    });

    it('is full when the cap is 0, because 0 blocks every SMS', () => {
      expect(smsSpendPercent(spend({ limit: 0, used: 0 }))).toBe(100);
    });

    it('rounds the used share and never passes 100', () => {
      expect(smsSpendPercent(spend({ limit: 30, used: 10 }))).toBe(33);
      expect(smsSpendPercent(spend({ limit: 50, used: 80 }))).toBe(100);
    });
  });

  describe('formatUsd', () => {
    it('always shows two decimals', () => {
      expect(formatUsd(0)).toBe('US$ 0.00');
      expect(formatUsd(12.5)).toBe('US$ 12.50');
    });
  });
});
