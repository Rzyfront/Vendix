import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { MessagingChannelsController } from './messaging-channels.controller';
import { UpdateSmsChannelDto } from './dto/update-sms-channel.dto';
import { UpdateEmailChannelDto } from './dto/update-email-channel.dto';

describe('MessagingChannelsController', () => {
  const meta = (key: string, handler: keyof MessagingChannelsController) =>
    Reflect.getMetadata(key, MessagingChannelsController.prototype[handler]);

  it('lives under store/integrations/channels', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MessagingChannelsController)).toBe(
      'store/integrations/channels',
    );
  });

  it.each([
    ['updateSms', 'sms'],
    ['updateEmail', 'email'],
  ] as const)('%s is PUT /%s and requires store:social_sales:manage', (handler, path) => {
    expect(meta(METHOD_METADATA, handler)).toBe(RequestMethod.PUT);
    expect(meta(PATH_METADATA, handler)).toBe(path);
    expect(meta(PERMISSIONS_KEY, handler)).toEqual(['store:social_sales:manage']);
  });

  it('list is GET / and requires store:social_sales:read', () => {
    expect(meta(METHOD_METADATA, 'list')).toBe(RequestMethod.GET);
    expect(meta(PATH_METADATA, 'list')).toBe('/');
    expect(meta(PERMISSIONS_KEY, 'list')).toEqual(['store:social_sales:read']);
  });

  describe('validation (global pipe options)', () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const validate = (metatype: unknown, value: unknown) =>
      pipe.transform(value, { type: 'body', metatype: metatype as never });

    it('accepts a valid SMS payload and trims an empty sender_id to null', async () => {
      await expect(
        validate(UpdateSmsChannelDto, { enabled: true, sender_id: '  ', monthly_spend_limit: 25.5 }),
      ).resolves.toMatchObject({ enabled: true, sender_id: null, monthly_spend_limit: 25.5 });
    });

    it.each([
      [{ enabled: true }],
      [{ enabled: true, monthly_spend_limit: -1 }],
      [{ enabled: true, monthly_spend_limit: 10_001 }],
      [{ enabled: true, monthly_spend_limit: 1.234 }],
      [{ enabled: true, monthly_spend_limit: 5, sender_id: '123' }],
      [{ enabled: true, monthly_spend_limit: 5, sender_id: 'DemasiadoLargo' }],
      [{ enabled: true, monthly_spend_limit: 5, store_id: 99 }],
    ])('rejects SMS payload %p', async (payload) => {
      await expect(validate(UpdateSmsChannelDto, payload)).rejects.toBeDefined();
    });

    it('accepts a valid email payload and rejects header injection or bad addresses', async () => {
      await expect(
        validate(UpdateEmailChannelDto, { enabled: true, from_name: 'Tienda', reply_to: 'hola@tienda.co' }),
      ).resolves.toMatchObject({ from_name: 'Tienda', reply_to: 'hola@tienda.co' });
      await expect(
        validate(UpdateEmailChannelDto, { enabled: true, from_name: 'A\r\nBcc: x@y.co' }),
      ).rejects.toBeDefined();
      await expect(
        validate(UpdateEmailChannelDto, { enabled: true, reply_to: 'no-es-correo' }),
      ).rejects.toBeDefined();
    });
  });
});
