export interface InvoiceEmailData {
  invoice_number: string;
  invoice_type: string;
  customer_name: string;
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
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

  const itemsHtml = data.items.map(item => `
    <tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151;">
        ${item.description}
      </td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: center;">${item.quantity}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right; font-family: monospace;">${formatCurrency(item.unit_price, data.currency)}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right; font-family: monospace;">${formatCurrency(item.tax_amount, data.currency)}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right; font-weight: 600; font-family: monospace;">${formatCurrency(item.total_amount, data.currency)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${typeLabel} ${data.invoice_number}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #111827; padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">${data.store_name}</h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: #9ca3af;">${typeLabel}</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 40px 16px;">
              <p style="margin: 0 0 8px; font-size: 16px; color: #374151;">
                Estimado/a <strong>${data.customer_name}</strong>,
              </p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">
                Adjunto encontrará su factura electrónica. A continuación le presentamos un resumen de la misma.
              </p>
            </td>
          </tr>

          <!-- Invoice Info -->
          <tr>
            <td style="padding: 16px 40px;">
              <table width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border-radius: 8px; padding: 16px;">
                <tr>
                  <td style="padding: 16px;">
                    <table width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="50%">
                          <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Número</p>
                          <p style="margin: 0; font-size: 16px; font-weight: 700; color: #111827;">${data.invoice_number}</p>
                        </td>
                        <td width="50%" style="text-align: right;">
                          <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Fecha de Emisión</p>
                          <p style="margin: 0; font-size: 14px; color: #374151;">${data.issue_date}</p>
                        </td>
                      </tr>
                      ${data.due_date ? `
                      <tr>
                        <td colspan="2" style="padding-top: 8px; text-align: right;">
                          <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Fecha de Vencimiento</p>
                          <p style="margin: 0; font-size: 14px; color: #374151;">${data.due_date}</p>
                        </td>
                      </tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Items Table -->
          <tr>
            <td style="padding: 16px 40px;">
              <table width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f9fafb;">
                    <th style="padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Descripción</th>
                    <th style="padding: 12px 16px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Cant.</th>
                    <th style="padding: 12px 16px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">P. Unit.</th>
                    <th style="padding: 12px 16px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Imp.</th>
                    <th style="padding: 12px 16px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Totals -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="50%"></td>
                  <td width="50%">
                    <table width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Subtotal</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #374151; text-align: right; font-family: monospace;">${formatCurrency(data.subtotal, data.currency)}</td>
                      </tr>
                      ${data.discount > 0 ? `
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Descuento</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #16a34a; text-align: right; font-family: monospace;">-${formatCurrency(data.discount, data.currency)}</td>
                      </tr>` : ''}
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Impuestos</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #374151; text-align: right; font-family: monospace;">${formatCurrency(data.tax, data.currency)}</td>
                      </tr>
                      ${data.withholding > 0 ? `
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Retenciones</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #dc2626; text-align: right; font-family: monospace;">-${formatCurrency(data.withholding, data.currency)}</td>
                      </tr>` : ''}
                      <tr>
                        <td colspan="2" style="border-top: 2px solid #111827; padding-top: 8px;"></td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; font-size: 18px; font-weight: 700; color: #111827;">Total</td>
                        <td style="padding: 4px 0; font-size: 18px; font-weight: 700; color: #111827; text-align: right; font-family: monospace;">${formatCurrency(data.total, data.currency)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${data.cufe ? `
          <!-- CUFE -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px;">
                <h3 style="margin: 0 0 8px; font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.5px;">CUFE</h3>
                <p style="margin: 0; font-size: 11px; color: #166534; word-break: break-all; font-family: monospace;">${data.cufe}</p>
              </div>
            </td>
          </tr>` : ''}

          ${data.notes ? `
          <!-- Notes -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px;">
                <h3 style="margin: 0 0 8px; font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Notas</h3>
                <p style="margin: 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${data.notes}</p>
              </div>
            </td>
          </tr>` : ''}

          ${data.pdf_url ? `
          <!-- Download Button -->
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;">
              <a href="${data.pdf_url}" style="display: inline-block; background-color: #111827; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                Ver Factura en PDF
              </a>
            </td>
          </tr>` : ''}

          <!-- Store Info -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="border-top: 1px solid #e5e7eb; padding-top: 16px;">
                <p style="margin: 0 0 4px; font-size: 13px; font-weight: 600; color: #374151;">${data.store_name}</p>
                ${data.store_nit ? `<p style="margin: 0 0 2px; font-size: 12px; color: #6b7280;">NIT: ${data.store_nit}</p>` : ''}
                ${data.store_address ? `<p style="margin: 0 0 2px; font-size: 12px; color: #6b7280;">${data.store_address}</p>` : ''}
                ${data.store_phone ? `<p style="margin: 0 0 2px; font-size: 12px; color: #6b7280;">Tel: ${data.store_phone}</p>` : ''}
                ${data.store_email ? `<p style="margin: 0; font-size: 12px; color: #6b7280;">${data.store_email}</p>` : ''}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af;">
                Generado por <strong>${data.store_name}</strong> · Powered by Vendix
              </p>
              <p style="margin: 8px 0 0; font-size: 11px; color: #d1d5db;">
                Este es un correo generado automáticamente. Si tiene preguntas sobre esta factura, comuníquese con ${data.store_name}.
              </p>
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
  let text = `${typeLabel} ${data.invoice_number}\n\n`;
  text += `Estimado/a ${data.customer_name},\n\n`;
  text += `Adjunto encontrará su factura electrónica.\n\n`;
  text += `Número: ${data.invoice_number}\n`;
  text += `Fecha: ${data.issue_date}\n`;
  if (data.due_date) text += `Vencimiento: ${data.due_date}\n`;
  text += `Total: ${formatCurrency(data.total, data.currency)} ${data.currency}\n`;
  if (data.cufe) text += `\nCUFE: ${data.cufe}\n`;
  text += `\n${data.store_name}`;
  if (data.store_nit) text += ` - NIT: ${data.store_nit}`;
  text += '\n';
  return text;
}
