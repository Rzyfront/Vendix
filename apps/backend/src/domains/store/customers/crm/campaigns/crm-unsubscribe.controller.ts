import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../../../../../common/decorators/public.decorator';
import { CrmUnsubscribeService } from './crm-unsubscribe.service';

const page = (title: string, text: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1f2937"><h1 style="font-size:20px">${title}</h1><p>${text}</p></body></html>`;

/**
 * Public opt-out link of campaign emails. `GET` is the link a person opens;
 * `POST` is the one-click form mail clients use (RFC 8058). Both answer the
 * same way for valid and invalid tokens about anything but the result, and
 * never reveal who the token belongs to.
 */
@Controller('public/crm/unsubscribe')
export class CrmUnsubscribeController {
  constructor(private readonly unsubscribe: CrmUnsubscribeService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async open(@Query('t') token?: string): Promise<string> {
    return (await this.apply(token))
      ? page('Listo, te diste de baja', 'No volverás a recibir correos de marketing de esta tienda.')
      : page('Enlace no válido', 'Este enlace de baja no es válido o ya no está disponible.');
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async oneClick(@Query('t') token?: string) {
    return { unsubscribed: await this.apply(token) };
  }

  private async apply(token: string | undefined): Promise<boolean> {
    const payload = this.unsubscribe.verify(token);
    if (!payload) return false;
    return this.unsubscribe.optOut(payload, 'email_link');
  }
}
