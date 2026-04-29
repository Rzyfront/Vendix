export interface QuotationEmailData {
  quotation_number: string;
  customer_name: string;
  valid_until: string | null;
  items: {
    product_name: string;
    variant_sku?: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  notes?: string;
  terms_and_conditions?: string;
  store_name: string;
}

function formatCurrency(amount: number): string {
  return (
    '$' +
    amount.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}

export function generateQuotationEmailHtml(data: QuotationEmailData): string {
  const itemsHtml = data.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151;">
        ${item.product_name}
        ${item.variant_sku ? `<br><span style="font-size: 12px; color: #9ca3af;">SKU: ${item.variant_sku}</span>` : ''}
      </td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: center;">${item.quantity}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right; font-family: monospace;">${formatCurrency(item.unit_price)}</td>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right; font-weight: 600; font-family: monospace;">${formatCurrency(item.total_price)}</td>
    </tr>
  `,
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cotización ${data.quotation_number}</title>
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
              <p style="margin: 8px 0 0; font-size: 14px; color: #9ca3af;">Cotización</p>
            </td>
          </tr>

          <!-- Quotation Info -->
          <tr>
            <td style="padding: 32px 40px 16px;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h2 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #111827;">${data.quotation_number}</h2>
                    <p style="margin: 0; font-size: 14px; color: #6b7280;">
                      Para: <strong style="color: #374151;">${data.customer_name}</strong>
                    </p>
                    ${data.valid_until ? `<p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">Válida hasta: <strong>${data.valid_until}</strong></p>` : ''}
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
                    <th style="padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Producto</th>
                    <th style="padding: 12px 16px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Cant.</th>
                    <th style="padding: 12px 16px; text-align: right; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">P. Unit.</th>
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
                  <td width="60%"></td>
                  <td width="40%">
                    <table width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Subtotal</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #374151; text-align: right; font-family: monospace;">${formatCurrency(data.subtotal)}</td>
                      </tr>
                      ${
                        data.discount > 0
                          ? `
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Descuento</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #16a34a; text-align: right; font-family: monospace;">-${formatCurrency(data.discount)}</td>
                      </tr>`
                          : ''
                      }
                      <tr>
                        <td style="padding: 6px 0; font-size: 14px; color: #6b7280;">Impuestos</td>
                        <td style="padding: 6px 0; font-size: 14px; color: #374151; text-align: right; font-family: monospace;">${formatCurrency(data.tax)}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="border-top: 2px solid #111827; padding-top: 8px;"></td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; font-size: 18px; font-weight: 700; color: #111827;">Total</td>
                        <td style="padding: 4px 0; font-size: 18px; font-weight: 700; color: #111827; text-align: right; font-family: monospace;">${formatCurrency(data.total)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${
            data.notes
              ? `
          <!-- Notes -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px;">
                <h3 style="margin: 0 0 8px; font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Notas</h3>
                <p style="margin: 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${data.notes}</p>
              </div>
            </td>
          </tr>`
              : ''
          }

          ${
            data.terms_and_conditions
              ? `
          <!-- Terms -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px;">
                <h3 style="margin: 0 0 8px; font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Términos y Condiciones</h3>
                <p style="margin: 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${data.terms_and_conditions}</p>
              </div>
            </td>
          </tr>`
              : ''
          }

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af;">
                Generado por <strong>${data.store_name}</strong> · Powered by Vendix
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
