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

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Public opt-out link of campaign emails. `GET` only shows a confirmation
 * button, so mail scanners that open links never unsubscribe anyone; the
 * `POST` it submits (also the one-click form of RFC 8058) applies the
 * opt-out. Valid and invalid tokens never reveal who the token belongs to.
 */
@Controller('public/crm/unsubscribe')
export class CrmUnsubscribeController {
  constructor(private readonly unsubscribe: CrmUnsubscribeService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  open(@Query('t') token?: string): string {
    if (!this.unsubscribe.verify(token)) return INVALID;
    return page(
      'Darte de baja',
      `¿No quieres recibir más correos de marketing de esta tienda?</p>` +
        `<form method="post" action="?t=${escapeAttr(encodeURIComponent(token as string))}">` +
        `<button type="submit" style="padding:10px 16px;font-size:14px">Confirmar baja</button></form><p>`,
    );
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async confirm(@Query('t') token?: string): Promise<string> {
    const payload = this.unsubscribe.verify(token);
    if (!payload || !(await this.unsubscribe.optOut(payload, 'email_link'))) {
      return INVALID;
    }
    return page('Listo, te diste de baja', 'No volverás a recibir correos de marketing de esta tienda.');
  }
}

const INVALID = page('Enlace no válido', 'Este enlace de baja no es válido o ya no está disponible.');
