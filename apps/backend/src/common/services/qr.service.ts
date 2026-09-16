import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

// Hex de 6 dígitos con `#` — mismo patrón que valida `primary_color` en
// settings-schemas.dto.ts. Cualquier otra cosa se descarta en silencio.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

@Injectable()
export class QrService {
  /**
   * `darkColor` es un parámetro (no una constante `#000000` fija) porque
   * distintos llamadores tiñen el QR con el color de marca de la tienda
   * (branding.primary_color) cuando ese color es lo bastante oscuro para
   * no comprometer la escaneabilidad (ver `TablesService.resolveQrDarkColor`).
   * Un color inválido nunca debe reventar la generación del QR: se valida
   * aquí y cae a negro en silencio si no matchea el formato esperado.
   */
  async generateDataUrl(
    content: string,
    size = 200,
    darkColor = '#000000',
  ): Promise<string> {
    const dark = HEX_COLOR_RE.test(darkColor) ? darkColor : '#000000';
    return QRCode.toDataURL(content, {
      width: size,
      margin: 1,
      color: { dark, light: '#FFFFFF' },
    });
  }

  async generateBuffer(content: string, size = 200): Promise<Buffer> {
    return QRCode.toBuffer(content, {
      width: size,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  }
}
