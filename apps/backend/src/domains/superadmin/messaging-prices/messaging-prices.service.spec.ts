import { BadRequestException } from '@nestjs/common';
import { SuperadminMessagingPricesService } from './messaging-prices.service';

const KEY = 'messaging:prices';

describe('SuperadminMessagingPricesService', () => {
  let prisma: {
    platform_settings: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let audit: { log: jest.Mock };
  let env: Record<string, string | undefined>;
  let service: SuperadminMessagingPricesService;

  const row = (value: unknown) => ({
    value,
    updated_at: new Date('2026-01-01T00:00:00Z'),
  });
  const saved = () =>
    prisma.platform_settings.upsert.mock.calls[0][0].update.value;
  const message = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).message;
    }
    throw new Error('expected a BadRequestException');
  };

  beforeEach(() => {
    env = {};
    prisma = {
      platform_settings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(async ({ create }) => ({
          id: 7,
          updated_at: new Date('2026-01-02T00:00:00Z'),
          value: create?.value,
        })),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn((key: string) => env[key]) };
    service = new SuperadminMessagingPricesService(
      prisma as never,
      config as never,
      audit as never,
    );
  });

  describe('getPrices', () => {
    it('shows each field with its source and the fallbacks', async () => {
      env.SNS_SMS_MAX_PRICE_USD = '0.7';
      prisma.platform_settings.findUnique.mockResolvedValue(
        row({
          sms_price_table: { '57': 0.0509 },
          updated_by_user_id: 3,
          updated_at: '2026-01-01T10:00:00.000Z',
        }),
      );

      const view = await service.getPrices();

      expect(prisma.platform_settings.findUnique).toHaveBeenCalledWith({
        where: { key: KEY },
      });
      expect(view).toEqual({
        key: KEY,
        sms_price_table: { value: { '57': 0.0509 }, source: 'platform_settings' },
        sms_max_price_usd: { value: 0.7, source: 'environment' },
        sms_max_price_margin: { value: 1, source: 'default' },
        whatsapp_price_table: { value: {}, source: 'default' },
        email_price_usd: { value: 0.0001, source: 'default' },
        fallbacks: { sms_per_segment_usd: 0.1, whatsapp_per_message_usd: 0.05 },
        updated_by_user_id: 3,
        updated_at: '2026-01-01T10:00:00.000Z',
      });
    });

    it('works without a row', async () => {
      const view = await service.getPrices();
      expect(view.sms_max_price_usd).toEqual({ value: 0.5, source: 'default' });
      expect(view.updated_by_user_id).toBeNull();
      expect(view.updated_at).toBeNull();
    });
  });

  describe('updatePrices save', () => {
    it('saves the given fields, leaves absent ones unchanged and returns the new view', async () => {
      prisma.platform_settings.findUnique.mockResolvedValue(
        row({ sms_max_price_usd: 0.3, email_price_usd: 0.002 }),
      );

      const view = await service.updatePrices(
        { sms_price_table: { '57': 0.0509, default: 0.1 }, sms_max_price_margin: 1.2 },
        42,
      );

      expect(prisma.platform_settings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: KEY } }),
      );
      expect(saved()).toMatchObject({
        sms_price_table: { '57': 0.0509, default: 0.1 },
        sms_max_price_margin: 1.2,
        sms_max_price_usd: 0.3,
        email_price_usd: 0.002,
        updated_by_user_id: 42,
      });
      expect(view.sms_price_table).toEqual({
        value: { '57': 0.0509, default: 0.1 },
        source: 'platform_settings',
      });
      expect(view.sms_max_price_usd).toEqual({ value: 0.3, source: 'platform_settings' });
    });

    it('creates the row when there is none', async () => {
      await service.updatePrices({ email_price_usd: 0.001 }, 1);
      const args = prisma.platform_settings.upsert.mock.calls[0][0];
      expect(args.create.key).toBe(KEY);
      expect(args.create.value).toMatchObject({ email_price_usd: 0.001 });
    });

    it('null removes a field from the panel so it goes back to the fallback', async () => {
      env.SNS_SMS_MAX_PRICE_USD = '0.7';
      prisma.platform_settings.findUnique.mockResolvedValue(
        row({ sms_max_price_usd: 0.3, sms_max_price_margin: 1.5 }),
      );

      const view = await service.updatePrices({ sms_max_price_usd: null }, 1);

      expect(saved().sms_max_price_usd).toBeNull();
      expect(saved().sms_max_price_margin).toBe(1.5);
      expect(view.sms_max_price_usd).toEqual({ value: 0.7, source: 'environment' });
    });

    it('stores an empty table as null', async () => {
      prisma.platform_settings.findUnique.mockResolvedValue(
        row({ whatsapp_price_table: { '57': 0.02 } }),
      );

      const view = await service.updatePrices({ whatsapp_price_table: {} }, 1);

      expect(saved().whatsapp_price_table).toBeNull();
      expect(view.whatsapp_price_table).toEqual({ value: {}, source: 'default' });
    });
  });

  describe('updatePrices validation (400, Spanish message, nothing written)', () => {
    it.each([
      [
        { sms_price_table: { abc: 0.1 } },
        'Código de país inválido "abc" en la tabla de precios de SMS: use solo dígitos (1 a 4) o "default"',
      ],
      [
        { whatsapp_price_table: { '12345': 0.1 } },
        'Código de país inválido "12345" en la tabla de precios de WhatsApp: use solo dígitos (1 a 4) o "default"',
      ],
      [
        { sms_price_table: { '57': 0 } },
        'El precio de "57" en la tabla de precios de SMS debe ser un número mayor que 0',
      ],
      [
        { whatsapp_price_table: { '57': -1 } },
        'El precio de "57" en la tabla de precios de WhatsApp debe ser un número mayor que 0',
      ],
      [
        { sms_price_table: { '57': '0.1' } },
        'El precio de "57" en la tabla de precios de SMS debe ser un número mayor que 0',
      ],
      [
        { sms_price_table: { '57': null } },
        'El precio de "57" en la tabla de precios de SMS debe ser un número mayor que 0',
      ],
      [
        { sms_price_table: [0.1] },
        'La tabla de precios de SMS debe ser un objeto de código de país a precio',
      ],
      [
        { sms_max_price_margin: 0.9 },
        'El margen del tope debe ser un número mayor o igual a 1',
      ],
      [{ sms_max_price_usd: 0 }, 'El tope por SMS debe ser un número mayor que 0'],
      [{ sms_max_price_usd: -0.1 }, 'El tope por SMS debe ser un número mayor que 0'],
      [{ email_price_usd: 0 }, 'El precio por correo debe ser un número mayor que 0'],
      [{ email_price_usd: '0.1' }, 'El precio por correo debe ser un número mayor que 0'],
    ])('%j → %s', async (dto, expected) => {
      expect(await message(service.updatePrices(dto as never, 1))).toBe(expected);
      expect(prisma.platform_settings.upsert).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('rejects a request with one valid and one invalid field as a whole', async () => {
      await message(
        service.updatePrices({ email_price_usd: 0.001, sms_max_price_usd: 0 }, 1),
      );
      expect(prisma.platform_settings.upsert).not.toHaveBeenCalled();
    });

    it('accepts the boundaries: margin 1 and the "default" key', async () => {
      await expect(
        service.updatePrices(
          { sms_max_price_margin: 1, sms_price_table: { default: 0.05, '1': 0.01, '1876': 0.02 } },
          1,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('updatePrices audit', () => {
    it('writes one audit record with the changed fields and their old and new values', async () => {
      prisma.platform_settings.findUnique.mockResolvedValue(
        row({ sms_max_price_usd: 0.3, email_price_usd: 0.002 }),
      );

      await service.updatePrices(
        {
          sms_max_price_usd: 0.4,
          email_price_usd: 0.002,
          sms_price_table: { '57': 0.0509 },
        },
        42,
      );

      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.userId).toBe(42);
      expect(entry.action).toBe('UPDATE');
      expect(entry.resource).toBe('settings');
      expect(entry.resourceId).toBe(7);
      expect(entry.metadata.key).toBe(KEY);
      expect([...entry.metadata.changed_fields].sort()).toEqual([
        'sms_max_price_usd',
        'sms_price_table',
      ]);
      expect(entry.oldValues).toEqual({ sms_max_price_usd: 0.3, sms_price_table: null });
      expect(entry.newValues).toEqual({
        sms_max_price_usd: 0.4,
        sms_price_table: { '57': 0.0509 },
      });
    });

    it('records a removal as a change to null', async () => {
      prisma.platform_settings.findUnique.mockResolvedValue(
        row({ sms_max_price_margin: 1.5 }),
      );
      await service.updatePrices({ sms_max_price_margin: null }, 1);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.metadata.changed_fields).toEqual(['sms_max_price_margin']);
      expect(entry.oldValues).toEqual({ sms_max_price_margin: 1.5 });
      expect(entry.newValues).toEqual({ sms_max_price_margin: null });
    });

    it('does not fail the PATCH when the audit write fails', async () => {
      audit.log.mockRejectedValue(new Error('db down'));
      await expect(
        service.updatePrices({ email_price_usd: 0.001 }, 1),
      ).resolves.toBeDefined();
    });
  });
});
