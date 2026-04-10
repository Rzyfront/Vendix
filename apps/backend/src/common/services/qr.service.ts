import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

@Injectable()
export class QrService {
  async generateDataUrl(content: string, size = 200): Promise<string> {
    return QRCode.toDataURL(content, {
      width: size,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
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
