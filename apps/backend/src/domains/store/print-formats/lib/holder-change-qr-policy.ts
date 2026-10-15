import { PrintFormatDefinition } from '../interfaces/print-format.interface';
/** The opt-in is confined to POS FE. It never changes DIAN or fiscal workflow gates. */
export function allowsHolderChangeQr(formatType: string | undefined, definition?: Pick<PrintFormatDefinition, 'show_holder_change_qr'>): boolean {
  return formatType !== 'pos_electronic_invoice' || definition?.show_holder_change_qr === true;
}
/** Remove only the automatic block our renderer owns, never arbitrary manual QR markup. */
export function stripAutomaticHolderQr(html: string): string {
  return html.replace(/<section\b[^>]*\bdata-vx-holder-change=["']cf-holder-v1["'][^>]*>[\s\S]*?<\/section\s*>/gi, '');
}
