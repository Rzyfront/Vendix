import { MessagingPricesService } from './messaging-prices.service';
import { MESSAGING_PRICES_SETTINGS_KEY } from './messaging-prices.constants';

const setup = (
  row: { value: unknown } | null,
  env: Record<string, string | undefined> = {},
) => {
  const prisma = {
    platform_settings: { findUnique: jest.fn().mockResolvedValue(row) },
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  const service = new MessagingPricesService(prisma as never, config as never);
  return { service, prisma };
};

describe('MessagingPricesService.resolve', () => {
  it('reads the row by its unique key on every call (no cache)', async () => {
    const { service, prisma } = setup({ value: {} });
    await service.resolve();
    await service.resolve();
    expect(prisma.platform_settings.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.platform_settings.findUnique).toHaveBeenCalledWith({
      where: { key: MESSAGING_PRICES_SETTINGS_KEY },
    });
    expect(MESSAGING_PRICES_SETTINGS_KEY).toBe('messaging:prices');
  });

  it('uses the row for every field and reports platform_settings as source', async () => {
    const { service } = setup(
      {
        value: {
          sms_price_table: { '57': 0.0509 },
          sms_max_price_usd: 0.3,
          sms_max_price_margin: 1.5,
          whatsapp_price_table: { '57': 0.02 },
          email_price_usd: 0.0005,
        },
      },
      {
        SNS_SMS_PRICE_TABLE: '{"57":0.9}',
        SNS_SMS_MAX_PRICE_USD: '0.9',
        SNS_SMS_MAX_PRICE_MARGIN: '3',
        CRM_WHATSAPP_PRICE_TABLE: '{"57":0.9}',
        CRM_EMAIL_PRICE_USD: '0.9',
      },
    );
    expect(await service.resolve()).toEqual({
      sms_price_table: { value: { '57': 0.0509 }, source: 'platform_settings' },
      sms_max_price_usd: { value: 0.3, source: 'platform_settings' },
      sms_max_price_margin: { value: 1.5, source: 'platform_settings' },
      whatsapp_price_table: { value: { '57': 0.02 }, source: 'platform_settings' },
      email_price_usd: { value: 0.0005, source: 'platform_settings' },
    });
  });

  it('falls back to the environment field by field when the row is partial', async () => {
    const { service } = setup(
      { value: { sms_max_price_usd: 0.3 } },
      {
        SNS_SMS_PRICE_TABLE: '{"57":0.0075}',
        SNS_SMS_MAX_PRICE_USD: '0.9',
        SNS_SMS_MAX_PRICE_MARGIN: '1.2',
        CRM_WHATSAPP_PRICE_TABLE: '{"57":0.0125}',
        CRM_EMAIL_PRICE_USD: '0.001',
      },
    );
    expect(await service.resolve()).toEqual({
      sms_price_table: { value: { '57': 0.0075 }, source: 'environment' },
      sms_max_price_usd: { value: 0.3, source: 'platform_settings' },
      sms_max_price_margin: { value: 1.2, source: 'environment' },
      whatsapp_price_table: { value: { '57': 0.0125 }, source: 'environment' },
      email_price_usd: { value: 0.001, source: 'environment' },
    });
  });

  it('treats a null field in the row as missing', async () => {
    const { service } = setup(
      { value: { sms_max_price_usd: null, sms_price_table: null } },
      { SNS_SMS_MAX_PRICE_USD: '0.7' },
    );
    const prices = await service.resolve();
    expect(prices.sms_max_price_usd).toEqual({ value: 0.7, source: 'environment' });
    expect(prices.sms_price_table).toEqual({ value: {}, source: 'default' });
  });

  it.each([
    ['sms_price_table', { abc: 1 }, 'SNS_SMS_PRICE_TABLE', '{"57":0.0075}', { '57': 0.0075 }],
    ['sms_price_table', { '57': -1 }, 'SNS_SMS_PRICE_TABLE', '{"57":0.0075}', { '57': 0.0075 }],
    ['sms_max_price_usd', 0, 'SNS_SMS_MAX_PRICE_USD', '0.7', 0.7],
    ['sms_max_price_usd', '0.3', 'SNS_SMS_MAX_PRICE_USD', '0.7', 0.7],
    ['sms_max_price_margin', 0.5, 'SNS_SMS_MAX_PRICE_MARGIN', '1.4', 1.4],
    ['whatsapp_price_table', [0.1], 'CRM_WHATSAPP_PRICE_TABLE', '{"57":0.0125}', { '57': 0.0125 }],
    ['email_price_usd', -0.1, 'CRM_EMAIL_PRICE_USD', '0.002', 0.002],
  ])(
    'ignores an invalid %s in the row (%p) and uses the environment',
    async (field, bad, envKey, envValue, expected) => {
      const { service } = setup({ value: { [field]: bad } }, { [envKey]: envValue });
      const prices = await service.resolve();
      expect(prices[field as keyof typeof prices]).toEqual({
        value: expected,
        source: 'environment',
      });
    },
  );

  it('keeps the valid entries of a table and drops the invalid ones', async () => {
    const { service } = setup({
      value: { sms_price_table: { '57': 0.05, bad: 1, '1': -2 } },
    });
    expect((await service.resolve()).sms_price_table).toEqual({
      value: { '57': 0.05 },
      source: 'platform_settings',
    });
  });

  it('without a row and without environment returns the code defaults', async () => {
    const { service } = setup(null);
    expect(await service.resolve()).toEqual({
      sms_price_table: { value: {}, source: 'default' },
      sms_max_price_usd: { value: 0.5, source: 'default' },
      sms_max_price_margin: { value: 1, source: 'default' },
      whatsapp_price_table: { value: {}, source: 'default' },
      email_price_usd: { value: 0.0001, source: 'default' },
    });
  });

  it('with only the environment returns exactly what the previous code read', async () => {
    const { service } = setup(null, {
      SNS_SMS_PRICE_TABLE: '{"57":0.0075,"default":0.05,"x":1}',
      SNS_SMS_MAX_PRICE_USD: '0.25',
      SNS_SMS_MAX_PRICE_MARGIN: '1.2',
      CRM_WHATSAPP_PRICE_TABLE: '{"57":0.0125}',
      CRM_EMAIL_PRICE_USD: '0.001',
    });
    expect(await service.resolve()).toEqual({
      sms_price_table: {
        value: { '57': 0.0075, default: 0.05 },
        source: 'environment',
      },
      sms_max_price_usd: { value: 0.25, source: 'environment' },
      sms_max_price_margin: { value: 1.2, source: 'environment' },
      whatsapp_price_table: { value: { '57': 0.0125 }, source: 'environment' },
      email_price_usd: { value: 0.001, source: 'environment' },
    });
  });

  it.each([
    ['SNS_SMS_MAX_PRICE_USD', 'abc', 'sms_max_price_usd', 0.5],
    ['SNS_SMS_MAX_PRICE_USD', '-1', 'sms_max_price_usd', 0.5],
    ['SNS_SMS_MAX_PRICE_MARGIN', '0.5', 'sms_max_price_margin', 1],
    ['CRM_EMAIL_PRICE_USD', 'abc', 'email_price_usd', 0.0001],
    ['CRM_EMAIL_PRICE_USD', '-1', 'email_price_usd', 0.0001],
  ])('an invalid %s=%s falls to the default as before', async (envKey, raw, field, expected) => {
    const { service } = setup(null, { [envKey]: raw });
    const prices = await service.resolve();
    expect(prices[field as keyof typeof prices]).toEqual({
      value: expected,
      source: 'default',
    });
  });
});
