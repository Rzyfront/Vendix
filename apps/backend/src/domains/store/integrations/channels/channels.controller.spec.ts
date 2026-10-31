import { RequestMethod } from '@nestjs/common';
import {
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { ChannelsController } from './channels.controller';
import { SocialSalesLegacyController } from './social-sales-legacy.controller';

type Handler = (...args: unknown[]) => unknown;

function routeOf(controller: { prototype: object }, method: string) {
  const handler = (controller.prototype as Record<string, Handler>)[method];
  return {
    path: Reflect.getMetadata(PATH_METADATA, handler) as string,
    method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
    permissions: Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[],
    headers: (Reflect.getMetadata(HEADERS_METADATA, handler) ?? []) as Array<{
      name: string;
      value: string;
    }>,
  };
}

const expectedRoutes = [
  {
    method: 'getMetaReadiness',
    verb: RequestMethod.GET,
    newPath: 'meta/readiness',
    legacyPath: 'meta/readiness',
    permission: 'store:social_sales:read',
  },
  {
    method: 'getWhatsappChannel',
    verb: RequestMethod.GET,
    newPath: 'whatsapp',
    legacyPath: 'channels/whatsapp',
    permission: 'store:social_sales:read',
  },
  {
    method: 'completeWhatsappEmbeddedSignup',
    verb: RequestMethod.POST,
    newPath: 'whatsapp/embedded-signup/complete',
    legacyPath: 'channels/whatsapp/embedded-signup/complete',
    permission: 'store:social_sales:manage',
  },
  {
    method: 'disconnectWhatsapp',
    verb: RequestMethod.POST,
    newPath: 'whatsapp/disconnect',
    legacyPath: 'channels/whatsapp/disconnect',
    permission: 'store:social_sales:manage',
  },
];

function createService() {
  return {
    getReadiness: jest.fn().mockResolvedValue({ status: 'approved' }),
    getWhatsappChannel: jest.fn().mockResolvedValue({ connected: true }),
    completeEmbeddedSignup: jest.fn().mockResolvedValue({ connected: true }),
    disconnectWhatsapp: jest.fn().mockResolvedValue({ connected: false }),
  };
}

const responseService = {
  success: jest.fn((data: unknown, message: string) => ({
    success: true,
    data,
    message,
  })),
};

describe('ChannelsController (Integraciones → Canales)', () => {
  it('is mounted under store/integrations/channels', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ChannelsController)).toBe(
      'store/integrations/channels',
    );
  });

  it.each(expectedRoutes)(
    'exposes $method with the existing permission',
    ({ method, verb, newPath, permission }) => {
      const route = routeOf(ChannelsController, method);
      expect(route.path).toBe(newPath);
      expect(route.method).toBe(verb);
      expect(route.permissions).toEqual([permission]);
      expect(route.headers).toEqual([]);
    },
  );

  it('delegates every endpoint to the Meta WhatsApp service', async () => {
    const service = createService();
    const controller = new ChannelsController(
      service as never,
      responseService as never,
    );
    const dto = { code: 'c', waba_id: 'w', phone_number_id: 'p' };

    const readiness: unknown = await controller.getMetaReadiness();
    expect(readiness).toMatchObject({
      data: { status: 'approved' },
    });
    await controller.getWhatsappChannel();
    await controller.completeWhatsappEmbeddedSignup(dto);
    await controller.disconnectWhatsapp();

    expect(service.getReadiness).toHaveBeenCalledTimes(1);
    expect(service.getWhatsappChannel).toHaveBeenCalledTimes(1);
    expect(service.completeEmbeddedSignup).toHaveBeenCalledWith(dto);
    expect(service.disconnectWhatsapp).toHaveBeenCalledTimes(1);
  });
});

describe('SocialSalesLegacyController (deprecated alias)', () => {
  it('keeps the old store/social-sales prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SocialSalesLegacyController)).toBe(
      'store/social-sales',
    );
  });

  it.each(expectedRoutes)(
    'keeps $method on its old path and marks it deprecated',
    ({ method, verb, legacyPath, permission }) => {
      const route = routeOf(SocialSalesLegacyController, method);
      expect(route.path).toBe(legacyPath);
      expect(route.method).toBe(verb);
      expect(route.permissions).toEqual([permission]);
      expect(route.headers).toEqual(
        expect.arrayContaining([{ name: 'Deprecation', value: 'true' }]),
      );
    },
  );

  it('returns the same payload as the new controller', async () => {
    const service = createService();
    const legacy = new SocialSalesLegacyController(
      service as never,
      responseService as never,
    );

    const channel: unknown = await legacy.getWhatsappChannel();
    expect(channel).toMatchObject({
      data: { connected: true },
    });
    await legacy.disconnectWhatsapp();
    expect(service.disconnectWhatsapp).toHaveBeenCalledTimes(1);
  });
});
