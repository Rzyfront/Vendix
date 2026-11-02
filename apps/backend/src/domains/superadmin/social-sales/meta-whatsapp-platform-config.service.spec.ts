import { BadRequestException } from '@nestjs/common';
import { MetaWhatsappPlatformConfigService } from './meta-whatsapp-platform-config.service';

const KEY = 'social_sales:meta_whatsapp';

describe('MetaWhatsappPlatformConfigService', () => {
  let prisma: {
    platform_settings: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let encryption: {
    isEnabled: boolean;
    encrypt: jest.Mock;
    decrypt: jest.Mock;
  };
  let audit: { log: jest.Mock };
  let service: MetaWhatsappPlatformConfigService;

  const build = () =>
    new MetaWhatsappPlatformConfigService(
      prisma as any,
      encryption as any,
      audit as any,
    );

  beforeEach(() => {
    prisma = {
      platform_settings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(async ({ create }) => ({
          id: 7,
          updated_at: new Date('2026-01-01T00:00:00Z'),
          value: create?.value,
        })),
      },
    };
    encryption = {
      isEnabled: true,
      encrypt: jest.fn((v: string) => `enc(${v})`),
      decrypt: jest.fn((v: string) => v.replace(/^enc\(|\)$/g, '')),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = build();
  });

  describe('getMaskedConfig', () => {
    it('never returns the full secret, only ****last4', async () => {
      prisma.platform_settings.findUnique.mockResolvedValue({
        value: {
          app_id: '123',
          app_secret_encrypted: 'enc(test-secret-1234)',
          verify_token_encrypted: 'enc(test-verify-5678)',
          whatsapp_config_id: '456',
          graph_version: 'v23.0',
        },
        updated_at: new Date(),
      });

      const result = await service.getMaskedConfig();

      expect(result.app_secret_masked).toBe('****1234');
      expect(result.verify_token_masked).toBe('****5678');
      expect(result.configured).toBe(true);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('test-secret-1234');
      expect(serialized).not.toContain('test-verify-5678');
      expect(serialized).not.toContain('enc(');
    });
  });

  describe('updateConfig audit', () => {
    it('audits who and which fields changed, without secret values', async () => {
      prisma.platform_settings.findUnique.mockResolvedValue({
        value: { app_id: 'old-app', graph_version: 'v22.0' },
        updated_at: new Date(),
      });

      await service.updateConfig(
        {
          app_id: 'new-app',
          app_secret: 'test-secret-1234',
          verify_token: 'test-verify-5678',
        },
        42,
      );

      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.userId).toBe(42);
      expect(entry.action).toBe('UPDATE');
      expect(entry.resource).toBe('settings');
      expect(entry.metadata.key).toBe(KEY);
      expect(entry.metadata.changed_fields.sort()).toEqual([
        'app_id',
        'app_secret',
        'verify_token',
      ]);
      expect(entry.oldValues).toEqual({ app_id: 'old-app' });
      expect(entry.newValues).toEqual({ app_id: 'new-app' });
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain('test-secret-1234');
      expect(serialized).not.toContain('test-verify-5678');
      expect(serialized).not.toContain('enc(');
    });

    it('does not list non-secret fields whose value did not change', async () => {
      prisma.platform_settings.findUnique.mockResolvedValue({
        value: { app_id: 'same', allow_dev_signup: false },
        updated_at: new Date(),
      });

      await service.updateConfig({ app_id: 'same', allow_dev_signup: true }, 1);

      const entry = audit.log.mock.calls[0][0];
      expect(entry.metadata.changed_fields).toEqual(['allow_dev_signup']);
      expect(entry.oldValues).toEqual({ allow_dev_signup: false });
      expect(entry.newValues).toEqual({ allow_dev_signup: true });
    });

    it('rejects secrets without encryption key: no upsert, no audit', async () => {
      encryption.isEnabled = false;

      await expect(
        service.updateConfig({ app_secret: 'test-secret-1234' }, 1),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.platform_settings.upsert).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('does not fail the PATCH when the audit write fails', async () => {
      audit.log.mockRejectedValue(new Error('db down'));

      await expect(
        service.updateConfig({ graph_version: 'v24.0' }, 1),
      ).resolves.toBeDefined();
    });
  });
});
