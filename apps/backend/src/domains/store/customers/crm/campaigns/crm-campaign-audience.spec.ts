import {
  buildAudience,
  estimateCampaignCost,
  renderPlaceholders,
  unknownPlaceholders,
} from './crm-campaign-audience';
import type { SegmentRecipientRow } from '../segments/crm-segment-query.service';

const row = (
  id: number,
  overrides: Partial<SegmentRecipientRow> = {},
): SegmentRecipientRow => ({
  id,
  first_name: `Cliente${id}`,
  last_name: 'Pérez',
  email: `c${id}@shop.co`,
  phone: `30012345${String(id).padStart(2, '0')}`,
  whatsapp_consent: 'unknown',
  sms_consent: 'unknown',
  email_consent: 'unknown',
  ...overrides,
});

describe('campaign audience', () => {
  describe('opt-out', () => {
    it('never includes a customer who opted out of SMS or email, even inside the segment', () => {
      const rows = [
        row(1),
        row(2, { sms_consent: 'opted_out', email_consent: 'opted_out' }),
        row(3, { sms_consent: 'opted_in' }),
      ];
      const sms = buildAudience(rows, 'sms');
      expect(sms.eligible.map((r) => r.customer_id)).toEqual([1, 3]);
      expect(sms.excluded_no_consent).toBe(1);

      const email = buildAudience(rows, 'email');
      expect(email.eligible.map((r) => r.customer_id)).toEqual([1, 3]);
      expect(email.excluded_no_consent).toBe(1);
    });

    it('sends WhatsApp marketing only to customers who explicitly opted in', () => {
      const rows = [
        row(1, { whatsapp_consent: 'opted_in' }),
        row(2, { whatsapp_consent: 'unknown' }),
        row(3, { whatsapp_consent: 'opted_out' }),
      ];
      const audience = buildAudience(rows, 'whatsapp');
      expect(audience.eligible.map((r) => r.customer_id)).toEqual([1]);
      expect(audience.excluded_no_consent).toBe(2);
    });

    it('opting out of one channel does not remove the customer from another', () => {
      const rows = [row(1, { sms_consent: 'opted_out' })];
      expect(buildAudience(rows, 'sms').eligible).toHaveLength(0);
      expect(buildAudience(rows, 'email').eligible).toHaveLength(1);
    });
  });

  it('normalizes phones to E.164 and skips customers without a usable address', () => {
    const audience = buildAudience(
      [row(1), row(2, { phone: null }), row(3, { phone: '12' }), row(4, { phone: '+57 300 123 4504' })],
      'sms',
    );
    expect(audience.eligible.map((r) => r.address)).toEqual(['+573001234501', '+573001234504']);
    expect(audience.excluded_no_address).toBe(2);

    const email = buildAudience([row(1, { email: ' Ana@Shop.CO ' }), row(2, { email: 'no-at' })], 'email');
    expect(email.eligible.map((r) => r.address)).toEqual(['ana@shop.co']);
    expect(email.excluded_no_address).toBe(1);
  });

  it('sends one message per address when customers share a phone', () => {
    const audience = buildAudience([row(1, { phone: '3001112233' }), row(2, { phone: '+573001112233' })], 'sms');
    expect(audience.eligible.map((r) => r.customer_id)).toEqual([1]);
    expect(audience.excluded_duplicate).toBe(1);
  });

  describe('placeholders', () => {
    it('accepts only the closed catalog', () => {
      expect(unknownPlaceholders('Hola {first_name} de {store_name}')).toEqual([]);
      expect(unknownPlaceholders('Tu clave {password} y {email}')).toEqual(['{password}', '{email}']);
    });

    it('renders per recipient', () => {
      expect(
        renderPlaceholders('Hola {first_name} {last_name}, {store_name} te espera', { first_name: 'Ana', last_name: 'Gil' }, 'Tienda Sol'),
      ).toBe('Hola Ana Gil, Tienda Sol te espera');
    });
  });

  describe('cost estimate', () => {
    const recipients = buildAudience([row(1), row(2)], 'sms').eligible;

    it('prices SMS per segment and country with the provider price table', () => {
      // 160 GSM-7 characters is one segment; 161 is two.
      const one = estimateCampaignCost(recipients, { channel: 'sms', body: 'a'.repeat(160) }, 'X', {
        sms_price_table: '{"57":0.0075}',
      });
      expect(one).toBe(0.015);
      const two = estimateCampaignCost(recipients, { channel: 'sms', body: 'a'.repeat(161) }, 'X', {
        sms_price_table: '{"57":0.0075}',
      });
      expect(two).toBe(0.03);
    });

    it('counts the rendered text of each recipient', () => {
      const long = buildAudience([row(1, { first_name: 'x'.repeat(30) })], 'sms').eligible;
      const cost = estimateCampaignCost(long, { channel: 'sms', body: `${'a'.repeat(140)}{first_name}` }, 'X', {
        sms_price_table: '{"57":0.0075}',
      });
      expect(cost).toBe(0.015);
    });

    it('falls back to the deliberately high price for unlisted countries', () => {
      const cost = estimateCampaignCost(recipients, { channel: 'sms', body: 'hola' }, 'X', {});
      expect(cost).toBe(0.2);
    });

    it('prices WhatsApp per message and email per send', () => {
      const wa = buildAudience([row(1, { whatsapp_consent: 'opted_in' })], 'whatsapp').eligible;
      expect(estimateCampaignCost(wa, { channel: 'whatsapp' }, 'X', { whatsapp_price_table: '{"57":0.0125}' })).toBe(0.0125);
      expect(estimateCampaignCost(wa, { channel: 'whatsapp' }, 'X', {})).toBe(0.05);

      const mails = buildAudience([row(1), row(2), row(3)], 'email').eligible;
      expect(estimateCampaignCost(mails, { channel: 'email' }, 'X', {})).toBe(0.0003);
      expect(estimateCampaignCost(mails, { channel: 'email' }, 'X', { email_price_usd: 0.001 })).toBe(0.003);
    });

    it('is zero without recipients', () => {
      expect(estimateCampaignCost([], { channel: 'sms', body: 'hola' }, 'X', {})).toBe(0);
    });
  });
});
