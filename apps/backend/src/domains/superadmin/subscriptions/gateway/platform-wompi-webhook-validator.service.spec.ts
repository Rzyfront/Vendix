import { PlatformWompiWebhookValidatorService } from './platform-wompi-webhook-validator.service';
import { PlatformGatewayEnvironmentEnum } from './dto/upsert-gateway.dto';
import { WompiEnvironment } from '../../../store/payments/processors/wompi/wompi.types';

describe('PlatformWompiWebhookValidatorService', () => {
  let service: PlatformWompiWebhookValidatorService;
  let platformGwMock: any;
  let wompiClientMock: any;

  beforeEach(() => {
    platformGwMock = { getActiveCredentials: jest.fn() };
    wompiClientMock = {
      configure: jest.fn(),
      validateWebhookSignature: jest.fn(),
    };
    service = new PlatformWompiWebhookValidatorService(
      platformGwMock,
      wompiClientMock,
    );
  });

  function bodyWithReference(reference: string | null) {
    return {
      data: {
        transaction:
          reference === null
            ? { status: 'APPROVED' }
            : { reference, status: 'APPROVED' },
      },
    };
  }

  function activeCreds(overrides: any = {}) {
    return {
      public_key: 'pub_test_xxx',
      private_key: 'priv_test_xxx',
      events_secret: 'events_test',
      integrity_secret: 'integ_test',
      environment: PlatformGatewayEnvironmentEnum.SANDBOX,
      ...overrides,
    };
  }

  it('returns valid=true with subscriptionId and invoiceId for valid SaaS reference + good signature', async () => {
    platformGwMock.getActiveCredentials.mockResolvedValue(activeCreds());
    wompiClientMock.validateWebhookSignature.mockReturnValue(true);

    const result = await service.validate(
      bodyWithReference('vendix_saas_42_99_1700000000000'),
    );

    expect(result.valid).toBe(true);
    expect(result.subscriptionId).toBe(42);
    expect(result.invoiceId).toBe(99);
    expect(platformGwMock.getActiveCredentials).toHaveBeenCalledWith('wompi');

    expect(wompiClientMock.configure).toHaveBeenCalledTimes(1);
    const cfgArg = wompiClientMock.configure.mock.calls[0][0];
    expect(cfgArg.public_key).toBe('pub_test_xxx');
    expect(cfgArg.environment).toBe(WompiEnvironment.SANDBOX);

    expect(wompiClientMock.validateWebhookSignature).toHaveBeenCalledTimes(1);
  });

  it('maps PRODUCTION environment from platform creds', async () => {
    platformGwMock.getActiveCredentials.mockResolvedValue(
      activeCreds({ environment: PlatformGatewayEnvironmentEnum.PRODUCTION }),
    );
    wompiClientMock.validateWebhookSignature.mockReturnValue(true);

    await service.validate(bodyWithReference('vendix_saas_1_2_3'));

    expect(wompiClientMock.configure).toHaveBeenCalledTimes(1);
    const cfgArg = wompiClientMock.configure.mock.calls[0][0];
    expect(cfgArg.environment).toBe(WompiEnvironment.PRODUCTION);
  });

  it('returns valid=false reason=reference_not_saas for eCommerce-shaped reference', async () => {
    const result = await service.validate(
      bodyWithReference('vendix_5_99_1700000000000'),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('reference_not_saas');
    // We never call platform creds nor signature validation when the
    // reference is the wrong shape — saves API calls and platform_settings
    // reads on misrouted eCommerce traffic.
    expect(platformGwMock.getActiveCredentials).not.toHaveBeenCalled();
    expect(wompiClientMock.validateWebhookSignature).not.toHaveBeenCalled();
  });

  it('returns valid=false reason=no_reference when reference is missing', async () => {
    const result = await service.validate(bodyWithReference(null));

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_reference');
    expect(platformGwMock.getActiveCredentials).not.toHaveBeenCalled();
  });

  it('returns valid=false reason=no_platform_creds when platform creds are missing', async () => {
    platformGwMock.getActiveCredentials.mockResolvedValue(null);

    const result = await service.validate(
      bodyWithReference('vendix_saas_42_99_1700000000000'),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_platform_creds');
    expect(wompiClientMock.validateWebhookSignature).not.toHaveBeenCalled();
  });

  it('returns valid=false reason=bad_signature when signature does not match', async () => {
    platformGwMock.getActiveCredentials.mockResolvedValue(activeCreds());
    wompiClientMock.validateWebhookSignature.mockReturnValue(false);

    const result = await service.validate(
      bodyWithReference('vendix_saas_42_99_1700000000000'),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_signature');
  });

  it('returns valid=false reason=validation_error on unexpected exception', async () => {
    platformGwMock.getActiveCredentials.mockRejectedValue(new Error('boom'));

    const result = await service.validate(
      bodyWithReference('vendix_saas_42_99_1700000000000'),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('validation_error');
  });

  it('rejects malformed numeric components (out-of-shape reference)', async () => {
    // The regex requires \d+ on both, so this should be treated as not-SaaS.
    const result = await service.validate(
      bodyWithReference('vendix_saas_NaN_99_1700000000000'),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('reference_not_saas');
  });
});
