import type { ContractQuotationPresentation } from '../../domains/store/quotations/quotation-contract-presentation';

export interface QuotationEmailData {
  quotation_number: string;
  customer_name: string;
  valid_until: string | null;
  items: {
    product_name: string;
    variant_sku?: string;
    applied_price_tier_name_snapshot?: string | null;
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
  contract_presentation?: ContractQuotationPresentation;
  presentation_warning?: string;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateContractQuotationEmailHtml(data: QuotationEmailData): string {
  const presentation = data.contract_presentation!;
  const esc = escapeHtml;
  const lines = presentation.lines.map((line) => `
    <tr>
      <td>${esc(line.description)}<br><small>Grupo: ${esc(line.bucket)}</small></td>
      <td class="center">${esc(String(line.quantity))}</td>
      <td class="money">${esc(line.unit_price_formatted)}</td>
      <td class="money">${esc(line.discount_amount_formatted)}</td>
      <td class="money">${esc(line.net_base_formatted)}</td>
      <td>${line.taxes.map((tax) =>
        `DIAN ${esc(tax.dian_tax_code)} · ${esc(tax.tax_name)} ${esc(tax.tax_rate_formatted)}: ${esc(tax.tax_amount_formatted)}`,
      ).join('<br>') || '—'}</td>
    </tr>`).join('');
  const sourceCosts = presentation.source_cost_details.length
    ? `<section><h3>Detalle de costos de origen</h3><p class="muted">Información incluida en el valor de la línea contractual; no se suma de nuevo.</p><table><thead><tr><th>Detalle</th><th>Cant.</th><th>Unitario</th><th>Descuento</th><th>Base neta</th></tr></thead><tbody>${presentation.source_cost_details.map((line) => `<tr><td>${esc(line.description)}</td><td class="center">${esc(String(line.quantity))}</td><td class="money">${esc(line.unit_price_formatted)}</td><td class="money">${esc(line.discount_amount_formatted)}</td><td class="money">${esc(line.net_base_formatted)}</td></tr>`).join('')}</tbody></table></section>`
    : '';
  const taxes = presentation.tax_summary.map((tax) => `
    <tr><td>DIAN ${esc(tax.dian_tax_code)} · ${esc(tax.tax_name)} ${esc(tax.tax_rate_formatted)}</td>
      <td class="money">${esc(tax.taxable_amount_formatted)}</td><td class="money">${esc(tax.tax_amount_formatted)}</td></tr>`).join('');
  const notes = presentation.agreed_notes
    ? `<section><h3>Notas acordadas</h3><p>${esc(presentation.agreed_notes)}</p></section>`
    : '';
  const terms = presentation.terms_and_conditions
    ? `<section><h3>Términos y condiciones</h3><p>${esc(presentation.terms_and_conditions)}</p></section>`
    : '';
  const dueDate = presentation.due_date_formatted
    ? `<p><strong>Vencimiento acordado:</strong> ${esc(presentation.due_date_formatted)}</p>`
    : '';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cotización contractual ${esc(data.quotation_number)}</title>
  <style>body{font-family:Arial,sans-serif;color:#111827;margin:0;background:#f3f4f6}.page{max-width:900px;margin:24px auto;background:#fff;padding:32px}h1,h2,h3{margin:0 0 10px}h1{font-size:24px}.muted{color:#6b7280;font-size:13px}table{width:100%;border-collapse:collapse;margin:12px 0 24px}th,td{text-align:left;padding:9px;border-bottom:1px solid #e5e7eb;font-size:13px;vertical-align:top}.money{text-align:right;white-space:nowrap;font-family:monospace}.center{text-align:center}.summary{margin-left:auto;width:360px}.summary td:last-child{text-align:right;font-family:monospace}.grand{font-weight:bold;font-size:18px;border-top:2px solid #111827}section{margin-top:22px}section p{white-space:pre-wrap;line-height:1.5}.facts{background:#f9fafb;padding:16px;margin:18px 0}</style></head><body><main class="page">
  <h1>${esc(data.store_name)}</h1><p class="muted">Cotización contractual</p>
  <h2>${esc(data.quotation_number)}</h2><p>Para: <strong>${esc(data.customer_name)}</strong></p>
  ${data.valid_until ? `<p>Válida hasta: ${esc(data.valid_until)}</p>` : ''}
  <div class="facts"><p><strong>Objeto:</strong> ${esc(presentation.contract_object)}</p><p><strong>Perfil de facturación:</strong> ${esc(presentation.invoice_profile_name)} · versión ${esc(String(presentation.invoice_profile_version))}</p>${dueDate}</div>
  <table><thead><tr><th>Descripción</th><th>Cant.</th><th>Unitario</th><th>Descuento</th><th>Base neta</th><th>Tributo</th></tr></thead><tbody>${lines}</tbody></table>
  ${sourceCosts}
  <table class="summary"><tbody>
    <tr><td>Subtotal bruto</td><td>${esc(presentation.gross_subtotal_formatted)}</td></tr>
    <tr><td>Descuento</td><td>−${esc(presentation.discount_total_formatted)}</td></tr>
    <tr><td>Base neta</td><td>${esc(presentation.net_subtotal_formatted)}</td></tr>
    <tr><td>Impuestos</td><td>${esc(presentation.tax_total_formatted)}</td></tr>
    <tr class="grand"><td>Total congelado</td><td>${esc(presentation.grand_total_formatted)}</td></tr>
  </tbody></table>
  ${taxes ? `<section><h3>Resumen de impuestos</h3><table><thead><tr><th>Tributo / tarifa</th><th>Base</th><th>Impuesto</th></tr></thead><tbody>${taxes}</tbody></table></section>` : ''}
  ${notes}${terms}<p class="muted">Generado por ${esc(data.store_name)} · Vendix</p>
  </main></body></html>`;
}

export function generateQuotationEmailHtml(data: QuotationEmailData): string {
  if (data.contract_presentation) return generateContractQuotationEmailHtml(data);

  // Historical contract quotes use the old item/total representation but may
  // still contain customer-entered notes. Escape those strings without
  // changing the long-established sale-email HTML output.
  const legacyText = data.presentation_warning
    ? escapeHtml
    : (value: string) => value;

  const itemsHtml = data.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151;">
        ${legacyText(item.product_name)}
        ${item.variant_sku ? `<br><span style="font-size: 12px; color: #9ca3af;">SKU: ${legacyText(item.variant_sku)}</span>` : ''}
        ${item.applied_price_tier_name_snapshot ? `<br><span style="font-size: 12px; color: #92400e;">Tarifa: ${legacyText(item.applied_price_tier_name_snapshot)}</span>` : ''}
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
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">${legacyText(data.store_name)}</h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: #9ca3af;">Cotización</p>
            </td>
          </tr>

          <!-- Quotation Info -->
          <tr>
            <td style="padding: 32px 40px 16px;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h2 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #111827;">${legacyText(data.quotation_number)}</h2>
                    <p style="margin: 0; font-size: 14px; color: #6b7280;">
                      Para: <strong style="color: #374151;">${legacyText(data.customer_name)}</strong>
                    </p>
                    ${data.valid_until ? `<p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">Válida hasta: <strong>${legacyText(data.valid_until)}</strong></p>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${data.presentation_warning ? `<tr><td style="padding: 0 40px 16px;"><div style="background:#fff7ed;color:#9a3412;padding:12px;border-radius:6px;">${escapeHtml(data.presentation_warning)}</div></td></tr>` : ''}

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
                <p style="margin: 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${legacyText(data.notes)}</p>
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
                <p style="margin: 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${legacyText(data.terms_and_conditions)}</p>
              </div>
            </td>
          </tr>`
              : ''
          }

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #9ca3af;">
                Generado por <strong>${legacyText(data.store_name)}</strong> · Powered by Vendix
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
