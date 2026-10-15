import * as QRCode from 'qrcode';
/** A separate, full quiet zone for dense signed links. Never alters the DIAN QR payload. */
export function renderInvoiceHolderQr(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    width: 720,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}
