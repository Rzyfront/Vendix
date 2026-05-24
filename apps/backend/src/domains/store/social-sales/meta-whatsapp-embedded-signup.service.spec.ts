import { ConfigService } from '@nestjs/config';
import { RequestContextService } from '@common/context/request-context.service';
import { MetaWhatsappEmbeddedSignupService } from './meta-whatsapp-embedded-signup.service';
import { SocialChannelEncryptionService } from './social-channel-encryption.service';

const configValues: Record<string, string> = {
  META_APP_ID: '123',
  META_APP_SECRET: 'app-secret',
  META_WHATSAPP_CONFIG_ID: 'config-123',
  META_WHATSAPP_VERIFY_TOKEN: 'verify-token',
  META_GRAPH_VERSION: 'v23.0',
  META_WHATSAPP_APP_REVIEW_STATUS: 'approved',
  SOCIAL_CHANNEL_ENCRYPTION_KEY: 'test-social-channel-encryption-key',
};

function createService(overrides?: {
  config?: Record<string, string | undefined>;
  findFirst?: jest.Mock;
  create?: jest.Mock;
  updateMany?: jest.Mock;
  platformFindUnique?: jest.Mock;
}) {
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          ...configValues,
          ...(overrides?.config ?? {}),
        })[key],
    ),
  } as any as ConfigService;
  const encryption = new SocialChannelEncryptionService(config);
  const prisma = {
    social_channels: {
      findFirst: overrides?.findFirst ?? jest.fn(),
      create: overrides?.create ?? jest.fn(),
      updateMany: overrides?.updateMany ?? jest.fn(),
    },
  } as any;
  const globalPrisma = {
    platform_settings: {
      findUnique:
        overrides?.platformFindUnique ?? jest.fn().mockResolvedValue(null),
    },
  } as any;

  return {
    service: new MetaWhatsappEmbeddedSignupService(
      prisma,
      globalPrisma,
      config,
      encryption,
    ),
    prisma,
  };
}

describe('MetaWhatsappEmbeddedSignupService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports missing platform configuration in readiness', async () => {
    const { service } = createService({
      config: {
        META_APP_ID: undefined,
        META_APP_SECRET: undefined,
        META_WHATSAPP_CONFIG_ID: undefined,
      },
    });

    const readiness = await service.getReadiness();

    expect(readiness.status).toBe('missing_env');
    expect(readiness.missing_envs).toEqual(
      expect.arrayContaining([
        'META_APP_ID',
        'META_APP_SECRET',
        'META_WHATSAPP_CONFIG_ID',
      ]),
    );
  });

  it('stores a connected WhatsApp channel with an encrypted token', async () => {
    const connectedChannel = {
      id: 7,
      status: 'connected',
      provider: 'meta_cloud',
      channel_type: 'whatsapp',
      waba_id: 'waba-1',
      phone_number_id: 'phone-1',
      access_token_encrypted: 'hidden',
    };
    const create = jest.fn().mockResolvedValue(connectedChannel);
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(connectedChannel);
    const { service, prisma } = createService({ create, findFirst });
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'plain-meta-token',
          token_type: 'bearer',
          expires_in: 3600,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as unknown as Response);

    const result = await RequestContextService.run(
      {
        store_id: 10,
        organization_id: 20,
        is_super_admin: false,
        is_owner: false,
      },
      () =>
        service.completeEmbeddedSignup({
          code: 'oauth-code',
          waba_id: 'waba-1',
          phone_number_id: 'phone-1',
          display_phone_number: '+57 300 000 0000',
        }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prisma.social_channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_id: 10,
          status: 'connected',
          access_token_encrypted:
            expect.not.stringContaining('plain-meta-token'),
        }),
      }),
    );
    expect(result.connected).toBe(true);
  });
});
