import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  CheckIfPhoneNumberIsOptedOutCommand,
  PublishCommand,
  SNSClient,
} from '@aws-sdk/client-sns';
import { mapSnsError, SnsSmsMessagingProvider } from './sns-sms.provider';
import { OutboundMessage, ResolvedChannel } from '../interfaces/messaging.interface';

function setup(env: Record<string, string | undefined> = {}) {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          SNS_REGION: 'us-east-1',
          SNS_SMS_MAX_PRICE_USD: '0.25',
          SNS_SMS_PRICE_TABLE: '{"57":0.0075}',
          ...env,
        })[key],
    ),
  } as unknown as ConfigService;
  const cache = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => cache.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      cache.set(key, value);
      return 'OK';
    }),
  };
  // Every SNS call goes through this spy: no test reaches AWS.
  const send = jest.spyOn(SNSClient.prototype, 'send') as unknown as jest.Mock;
  send.mockResolvedValue({ MessageId: 'sns-msg-1' });
  const provider = new SnsSmsMessagingProvider(config, redis as never);
  return { provider, send, redis, cache };
}

const channel = (settings: Record<string, unknown> = {}): ResolvedChannel => ({
  id: 7,
  store_id: 10,
  channel_type: 'sms',
  provider: 'sns_sms',
  phone_number_id: null,
  waba_id: null,
  access_token: null,
  graph_version: '',
  settings,
});

const message = (overrides: Partial<OutboundMessage> = {}): OutboundMessage => ({
  store_id: 10,
  channel: 'sms',
  to: '+57 300 123 4567',
  body: '  Tu pedido está listo  ',
  idempotency_key: '83',
  ...overrides,
});

describe('SnsSmsMessagingProvider', () => {
  beforeEach(() => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('publishes a transactional SMS capped at the reserved cost to the E.164 number', async () => {
    const { provider, send } = setup();

    const result = await provider.send(message(), channel());

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as PublishCommand;
    expect(command).toBeInstanceOf(PublishCommand);
    expect(command.input).toEqual({
      PhoneNumber: '+573001234567',
      Message: 'Tu pedido está listo',
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
        'AWS.SNS.SMS.MaxPrice': { DataType: 'Number', StringValue: '0.0075' },
      },
    });
    expect(result).toEqual({
      status: 'sent',
      provider: 'sns_sms',
      provider_message_id: 'sns-msg-1',
      retryable: false,
      cost_amount: 0.0075,
    });
  });

  it('adds a valid Sender ID and ignores an invalid one', async () => {
    const { provider, send } = setup();

    await provider.send(message(), channel({ sender_id: 'Tienda1' }));
    await provider.send(message(), channel({ sender_id: 'no valido!' }));

    const [valid, invalid] = send.mock.calls.map(
      ([command]) => (command as PublishCommand).input.MessageAttributes!,
    );
    expect(valid['AWS.SNS.SMS.SenderID']).toEqual({ DataType: 'String', StringValue: 'Tienda1' });
    expect(invalid['AWS.SNS.SMS.SenderID']).toBeUndefined();
  });

  it.each([
    ['one segment to Colombia', message()],
    ['three UCS-2 segments to Colombia', message({ body: 'ñandú 😀 '.repeat(20) })],
    ['an unlisted country at the fallback price', message({ to: '+1 305 555 1234' })],
  ])('never lets SNS charge more than the reserved cost: %s', async (_label, sms) => {
    const { provider, send } = setup();
    const quote = provider.quote(sms);
    if (!('cost' in quote)) throw new Error('expected a quote');

    const result = await provider.send(sms, channel());

    const input = (send.mock.calls[0][0] as PublishCommand).input;
    const maxPrice = Number(input.MessageAttributes!['AWS.SNS.SMS.MaxPrice'].StringValue);
    expect(maxPrice).toBeGreaterThan(0);
    expect(maxPrice).toBeLessThanOrEqual(quote.cost);
    expect(result.cost_amount).toBe(quote.cost);
  });

  it('applies SNS_SMS_MAX_PRICE_MARGIN and ignores a margin below 1', async () => {
    const withMargin = setup({ SNS_SMS_MAX_PRICE_MARGIN: '1.2' });
    await withMargin.provider.send(message(), channel());
    expect(
      (withMargin.send.mock.calls[0][0] as PublishCommand).input.MessageAttributes![
        'AWS.SNS.SMS.MaxPrice'
      ].StringValue,
    ).toBe('0.0090');
    jest.restoreAllMocks();

    const belowOne = setup({ SNS_SMS_MAX_PRICE_MARGIN: '0.5' });
    await belowOne.provider.send(message(), channel());
    expect(
      (belowOne.send.mock.calls[0][0] as PublishCommand).input.MessageAttributes![
        'AWS.SNS.SMS.MaxPrice'
      ].StringValue,
    ).toBe('0.0075');
  });

  it('never exceeds SNS_SMS_MAX_PRICE_USD, falling back to 0.50 when it is missing or invalid', async () => {
    // 7 GSM-7 segments to an unlisted country: 0.70 USD reserved.
    const long = message({ to: '+1 305 555 1234', body: 'a'.repeat(153 * 7) });
    const capped = setup();
    await capped.provider.send(long, channel());
    expect(
      (capped.send.mock.calls[0][0] as PublishCommand).input.MessageAttributes![
        'AWS.SNS.SMS.MaxPrice'
      ].StringValue,
    ).toBe('0.2500');
    jest.restoreAllMocks();

    const invalid = setup({ SNS_SMS_MAX_PRICE_USD: 'abc' });
    await invalid.provider.send(long, channel());
    const input = (invalid.send.mock.calls[0][0] as PublishCommand).input;
    expect(input.MessageAttributes!['AWS.SNS.SMS.MaxPrice'].StringValue).toBe('0.5000');
  });

  it.each([
    [{ to: '12' }, 'INVALID_RECIPIENT'],
    [{ body: '   ' }, 'INVALID_REQUEST'],
    [{ template: { name: 't', language: 'es', variables: [] } }, 'INVALID_REQUEST'],
    [{ media: [{ type: 'image' as const, url: 'https://x/y.jpg' }] }, 'INVALID_REQUEST'],
  ])('validates before calling SNS: %p → %s', async (overrides, code) => {
    const { provider, send } = setup();
    const result = await provider.send(message(overrides), channel());
    expect(result).toMatchObject({ status: 'failed', error_code: code, retryable: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('maps SNS errors to normalized codes', async () => {
    const { provider, send } = setup();
    send.mockRejectedValueOnce(Object.assign(new Error('Rate exceeded'), { name: 'ThrottledException' }));

    expect(await provider.send(message(), channel())).toMatchObject({
      status: 'failed',
      error_code: 'RATE_LIMITED',
      provider_error_code: 'ThrottledException',
      retryable: true,
    });
  });

  it.each([
    ['ThrottledException', 'RATE_LIMITED', true],
    ['InternalErrorException', 'PROVIDER_ERROR', true],
    ['InvalidParameterException', 'INVALID_RECIPIENT', false],
    ['InvalidParameterValueException', 'INVALID_REQUEST', false],
    ['AuthorizationErrorException', 'AUTH', false],
    ['CredentialsProviderError', 'AUTH', false],
    ['OptedOutException', 'OPTED_OUT', false],
    ['TimeoutError', 'TIMEOUT', false],
    ['SomethingNew', 'UNKNOWN', false],
  ])('%s → %s (retryable %s)', (name, code, retryable) => {
    expect(mapSnsError(Object.assign(new Error(name), { name }))).toEqual({
      code,
      retryable,
      provider_error_code: name,
    });
  });

  it('retries network errors before connecting and 5xx responses, never timeouts', () => {
    expect(mapSnsError(Object.assign(new Error('x'), { name: 'Error', code: 'ECONNREFUSED' }))).toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: true,
    });
    expect(mapSnsError(Object.assign(new Error('x'), { name: 'Odd', $metadata: { httpStatusCode: 503 } }))).toMatchObject({
      retryable: true,
    });
    expect(mapSnsError(Object.assign(new Error('x'), { name: 'RequestTimeout' }))).toMatchObject({
      code: 'TIMEOUT',
      retryable: false,
    });
  });

  describe('isOptedOut', () => {
    it('asks SNS once and caches the answer 24 h in Redis', async () => {
      const { provider, send, redis } = setup();
      send.mockResolvedValue({ isOptedOut: true });

      expect(await provider.isOptedOut('+573001234567')).toBe(true);
      expect(await provider.isOptedOut('+573001234567')).toBe(true);

      expect(send).toHaveBeenCalledTimes(1);
      const command = send.mock.calls[0][0] as CheckIfPhoneNumberIsOptedOutCommand;
      expect(command).toBeInstanceOf(CheckIfPhoneNumberIsOptedOutCommand);
      expect(command.input).toEqual({ phoneNumber: '+573001234567' });
      expect(redis.set).toHaveBeenCalledWith('crm:sms:opted-out:+573001234567', '1', 'EX', 86400);
    });

    it('lets the send go on when SNS cannot be asked', async () => {
      const { provider, send } = setup();
      send.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AuthorizationErrorException' }));
      expect(await provider.isOptedOut('+573001234567')).toBe(false);
    });
  });
});
