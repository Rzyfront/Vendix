export interface InvoiceEmailData {
  invoice_number: string;
  invoice_type: string;
  customer_name: string;
  /** Razón social del EMISOR (encabezado y frase de saludo). Cae a `store_name`. */
  issuer_name?: string;
  issue_date: string;
  due_date?: string;
  items: {
    description: string;
    quantity: number;
    unit_price: number;
    tax_amount: number;
    total_amount: number;
  }[];
  subtotal: number;
  discount: number;
  tax: number;
  withholding: number;
  total: number;
  currency: string;
  cufe?: string;
  notes?: string;
  pdf_url?: string;
  store_name: string;
  store_email?: string;
  store_phone?: string;
  store_address?: string;
  store_nit?: string;
}

function formatCurrency(amount: number, currency: string = 'COP'): string {
  // C.7/F-106 — documento que se entrega en Colombia: miles con punto.
  return (
    '$' +
    amount.toLocaleString('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}

const VENDIX_LOGO_URL = 'https://vendix.online/vlogo.png';
const VENDIX_SITE_URL = 'https://vendix.online';

/** Escapa texto de usuario antes de interpolarlo en el HTML del correo. */
function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getInvoiceTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    sales_invoice: 'Factura de Venta',
    purchase_invoice: 'Factura de Compra',
    credit_note: 'Nota Crédito',
    debit_note: 'Nota Débito',
  };
  return labels[type] || 'Factura Electrónica';
}

export function generateInvoiceEmailHtml(data: InvoiceEmailData): string {
  const typeLabel = getInvoiceTypeLabel(data.invoice_type);
  const issuer = esc(data.issuer_name || data.store_name);
  const customer = esc(data.customer_name);

  const summaryRow = (label: string, value: string, strong = false) => `
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #6b7280; width: 45%;">${label}</td>
                  <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-size: ${strong ? '16px' : '14px'}; color: #111827; text-align: right; font-weight: ${strong ? '700' : '500'};">${value}</td>
                </tr>`;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(typeLabel)} ${esc(data.invoice_number)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 24px 16px 40px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">

          <!-- Sello Vendix (arriba, derecha) -->
          <tr>
            <td align="right" style="padding: 0 4px 10px; font-size: 11px; color: #6b7280;">
              Comprobante elaborado y enviado a través de
              <img src="${VENDIX_LOGO_URL}" alt="Vendix" height="22" style="height: 22px; width: auto; vertical-align: middle; border: 0; margin-left: 4px;"><strong style="color: #111827; font-size: 13px; vertical-align: middle; margin-left: 4px;">Vendix</strong>
            </td>
          </tr>

          <tr>
            <td style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">

                <!-- Cabecera: emisor -->
                <tr>
                  <td style="background-color: #111827; padding: 28px 40px; text-align: center;">
                    <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">${issuer}</h1>
                    <p style="margin: 6px 0 0; font-size: 13px; color: #9ca3af;">${esc(typeLabel)} electrónica</p>
                  </td>
                </tr>

                <!-- Saludo -->
                <tr>
                  <td style="padding: 32px 40px 8px;">
                    <p style="margin: 0 0 12px; font-size: 18px; font-weight: 700; color: #111827;">¡Hola, ${customer}!</p>
                    <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #4b5563;">
                      <strong>${issuer}</strong> te informa que se generó el siguiente comprobante:
                    </p>
                  </td>
                </tr>

                <!-- Resumen -->
                <tr>
                  <td style="padding: 16px 40px 8px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top: 2px solid #111827;">
                      ${summaryRow('Número de comprobante', esc(data.invoice_number))}
                      ${summaryRow('A nombre de', customer)}
                      ${summaryRow('Fecha', esc(data.issue_date))}
                      ${data.due_date ? summaryRow('Fecha de vencimiento', esc(data.due_date)) : ''}
                      ${summaryRow('Total a pagar', esc(formatCurrency(data.total, data.currency)), true)}
                    </table>
                  </td>
                </tr>

                ${
                  data.pdf_url
                    ? `
                <tr>
                  <td style="padding: 16px 40px 8px; text-align: center;">
                    <a href="${esc(data.pdf_url)}" style="display: inline-block; background-color: #111827; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600;">Ver comprobante en PDF</a>
                  </td>
                </tr>`
                    : ''
                }

                ${
                  data.cufe
                    ? `
                <tr>
                  <td style="padding: 16px 40px 0;">
                    <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">CUFE</p>
                    <p style="margin: 0; font-size: 11px; color: #4b5563; word-break: break-all; font-family: monospace;">${esc(data.cufe)}</p>
                  </td>
                </tr>`
                    : ''
                }

                ${
                  data.notes
                    ? `
                <tr>
                  <td style="padding: 16px 40px 0;">
                    <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Notas</p>
                    <p style="margin: 0; font-size: 13px; color: #374151; white-space: pre-wrap;">${esc(data.notes)}</p>
                  </td>
                </tr>`
                    : ''
                }

                <!-- Datos del emisor -->
                <tr>
                  <td style="padding: 24px 40px 28px;">
                    <div style="border-top: 1px solid #e5e7eb; padding-top: 14px;">
                      <p style="margin: 0 0 3px; font-size: 13px; font-weight: 600; color: #374151;">${issuer}</p>
                      ${data.store_nit ? `<p style="margin: 0 0 2px; font-size: 12px; color: #6b7280;">NIT: ${esc(data.store_nit)}</p>` : ''}
                      ${data.store_address ? `<p style="margin: 0 0 2px; font-size: 12px; color: #6b7280;">${esc(data.store_address)}</p>` : ''}
                      ${data.store_phone ? `<p style="margin: 0 0 2px; font-size: 12px; color: #6b7280;">Tel: ${esc(data.store_phone)}</p>` : ''}
                      ${data.store_email ? `<p style="margin: 0; font-size: 12px; color: #6b7280;">${esc(data.store_email)}</p>` : ''}
                    </div>
                  </td>
                </tr>

                <!-- Pie Vendix -->
                <tr>
                  <td style="padding: 0 24px 24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; border-radius: 8px;">
                      <tr>
                        <td style="padding: 16px 20px; font-size: 13px; line-height: 1.5; color: #4b5563;">
                          <strong>Comprobante elaborado y enviado a través de Vendix.</strong><br>
                          Si deseas esta funcionalidad, <a href="${VENDIX_SITE_URL}" style="color: #111827; font-weight: 600;">contáctanos</a>.
                        </td>
                        <td align="right" style="padding: 16px 20px 16px 0; width: 80px;">
                          <img src="${VENDIX_LOGO_URL}" alt="Vendix" height="20" style="height: 20px; width: auto; border: 0;">
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding: 16px 16px 0; font-size: 11px; line-height: 1.5; color: #9ca3af;">
              Este es un correo automático. Si tienes preguntas sobre este comprobante, comunícate con ${issuer}.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function generateInvoiceEmailText(data: InvoiceEmailData): string {
  const typeLabel = getInvoiceTypeLabel(data.invoice_type);
  const issuer = data.issuer_name || data.store_name;
  let text = `Comprobante elaborado y enviado a través de Vendix\n\n`;
  text += `${typeLabel} ${data.invoice_number}\n\n`;
  text += `¡Hola, ${data.customer_name}!\n\n`;
  text += `${issuer} te informa que se generó el siguiente comprobante:\n\n`;
  text += `Número de comprobante: ${data.invoice_number}\n`;
  text += `A nombre de: ${data.customer_name}\n`;
  text += `Fecha: ${data.issue_date}\n`;
  if (data.due_date) text += `Fecha de vencimiento: ${data.due_date}\n`;
  text += `Total a pagar: ${formatCurrency(data.total, data.currency)} ${data.currency}\n`;
  if (data.cufe) text += `\nCUFE: ${data.cufe}\n`;
  text += `\n${issuer}`;
  if (data.store_nit) text += ` - NIT: ${data.store_nit}`;
  text += '\n\n';
  text += `Comprobante elaborado y enviado a través de Vendix.\n`;
  text += `Si deseas esta funcionalidad, contáctanos: ${VENDIX_SITE_URL}\n\n`;
  text += `Este es un correo automático. Si tienes preguntas sobre este comprobante, comunícate con el emisor.\n`;
  return text;
}
