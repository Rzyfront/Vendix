import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { MetaWhatsappSignupConfigController } from './meta-whatsapp-signup-config.controller';

describe('MetaWhatsappSignupConfigController', () => {
  it('is reachable without a session, because the signup bridge has none', () => {
    const isPublic = new Reflector().get<boolean>(
      IS_PUBLIC_KEY,
      MetaWhatsappSignupConfigController.prototype.getSignupConfig,
    );
    expect(isPublic).toBe(true);
  });

  it('wraps the public signup config in the standard response', async () => {
    const config = {
      can_start_signup: true,
      app_id: 'row-app',
      whatsapp_config_id: 'row-config',
      graph_version: 'v24.0',
    };
    const service = { getPublicSignupConfig: jest.fn().mockResolvedValue(config) };
    const responseService = {
      success: jest.fn((data: unknown) => ({ success: true, data })),
    };
    const controller = new MetaWhatsappSignupConfigController(
      service as any,
      responseService as any,
    );

    const result = await controller.getSignupConfig();

    expect(service.getPublicSignupConfig).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: config });
  });
});
