import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const detail = readFileSync(join(__dirname, 'received-document-detail.component.ts'), 'utf8');
const command = readFileSync(join(__dirname, 'received-buyer-event-command.component.ts'), 'utf8');
const commandTemplate = readFileSync(join(__dirname, 'received-buyer-event-command.component.html'), 'utf8');

describe('Received document detail semantic source guards (static, not E2E)', () => {
  it('places the next action and its server-projected blockers immediately after the invoice summary', () => {
    expect(detail.indexOf('Resumen de la factura recibida')).toBeLessThan(detail.indexOf('Siguiente acción'));
    expect(detail.indexOf('Siguiente acción')).toBeLessThan(detail.indexOf('Originales del proveedor'));
    expect(detail).toContain('inboxLabel(doc.inbox_state)');
    expect(detail).toContain('legalLabel(doc.legal_status)');
    expect(detail).toContain('deliveryLabel(doc.event_delivery_status)');
    expect(detail).toContain('doc.blocking_reasons ?? []');
    expect(detail).toContain("doc.event_delivery_status === 'unknown' || doc.event_delivery_status === 'in_progress'");
    expect(detail).toContain('antes de iniciar otra acción legal');
    expect(detail).toContain('no confirma un reclamo ni una aceptación');
    expect(detail).toContain('Estado legal no está disponible'.toLowerCase());
  });

  it('separates originals, discrepancies, existing purchase links and payable evidence without creating records', () => {
    for (const heading of ['Originales del proveedor', 'Discrepancias y validación', 'Compras y gastos vinculados', 'Evidencia contable y cuentas por pagar', 'Actividad y procedencia']) {
      expect(detail).toContain(heading);
    }
    expect(detail).toContain('No crea una compra, no recibe inventario y no genera cuentas por pagar.');
    expect(detail).toContain('Marcar revisada registra una revisión interna');
    expect(detail).toContain('no acredita autenticidad ni significa aceptación ante la DIAN');
    expect(detail).toContain('<app-received-document-matching [document]="doc"');
    expect(detail).toContain('<app-received-document-accounting-evidence');
    expect(detail).toContain('<app-received-buyer-event-command [document]="doc"');
    expect(detail).not.toContain('confirmMatch(');
    expect(detail).not.toContain('.emit(this.scope');
  });

  it('keeps review eligibility, safe formatting and read-only 034 evidence', () => {
    expect(detail).toContain(':received:review`');
    expect(detail).toContain("source === 'manual_entry'");
    expect(detail).toContain("source === 'ubl_xml'");
    expect(detail).toContain('return !terminal && (editable || xmlNoteOnly)');
    expect(detail).toContain('[disabled]="draftOpen() || loading()"');
    expect(detail).toContain('Revisión guardada. El documento no fue aceptado ni contabilizado.');
    expect(detail).toContain('this.currency.format(value)');
    expect(detail).toContain('formatDateOnlyUTC(date)');
    expect(detail).toContain('this.storeSettings.timezone()');
    expect(detail).toContain("event.event_code === '034' && event.status === 'accepted'");
    expect(detail).toContain('solo se consulta y no se ofrece para emisión');
    expect(command).toContain("const CODES: BuyerCommandCode[] = ['030', '031', '032', '033']");
  });

  it('retains every list query value but only forwards a valid organization store override', () => {
    expect(detail).toContain('for (const key of params.keys)');
    expect(detail).toContain('const values = params.getAll(key)');
    expect(detail).toContain('query[key] = values.length === 1 ? values[0] : values');
    expect(detail).toContain("if (key === 'store_id') continue");
    expect(detail).toContain("if (this.scope === 'organization' && this.storeId()) query['store_id'] = this.storeId()!");
    expect(detail).toContain('Number.isSafeInteger(id) && id > 0');
    expect(detail).toContain('[backQueryParams]="backQueryParams()"');
    expect(detail).toContain('this.service.getById(this.scope, id, this.storeId())');
  });

  it('cancels stale scope reads and downloads while keeping open review and confirmation drafts', () => {
    expect(detail).toContain('this.generation++');
    expect(detail).toContain('if (generation !== this.generation) return;');
    expect(detail).toContain('this.activeRequest?.unsubscribe()');
    expect(detail).toContain('this.downloadRequest?.unsubscribe()');
    expect(detail).toContain('if (contextKey !== this.contextKey) return;');
    expect(detail).toContain('this.auth.userOrganization()?.id');
    expect(detail).toContain('this.auth.userStore()?.id');
    expect(detail).toContain('if (this.draftOpen()) this.deferredDocument.set(response.data)');
    expect(detail).toContain('if (!deferred || this.draftOpen()) return;');
    expect(detail).toContain('sin reemplazar tu borrador');
    const load = detail.match(/\n  load\(\): void \{([\s\S]*?)\n  onReviewSaved/)?.[1] ?? '';
    expect(load).toContain('response.data.id !== id');
    expect(load).not.toContain('this.document.set(null);\n    this.loading.set(true)');
    expect(detail).toContain('takeUntilDestroyed(this.destroyRef)');
  });

  it('distinguishes explicit acceptance and claim confirmation for the actual invoice and supplier', () => {
    expect(command).toContain("'031': 'Reclamar factura'");
    expect(command).toContain("'033': 'Aceptar expresamente ante DIAN'");
    expect(commandTemplate).toContain('document().invoice_number');
    expect(commandTemplate).toContain('document().issuer_name');
    expect(commandTemplate).toContain('document().issuer_tax_id');
    expect(commandTemplate).toContain('No es una revisión interna ni una aceptación de propuesta.');
    expect(commandTemplate).toContain('No equivale a rechazar un evento fallido.');
    expect(commandTemplate).toContain('resultStatusLabel(response.status)');
    expect(commandTemplate).not.toContain('{{ response.status }}');
    expect(command).toContain('idempotency_key: idempotencyKey');
    expect(command).toContain("if (data.status === 'unknown')");
    expect(command).toContain('this.uncertainCode.set(code)');
    expect(commandTemplate).toContain('Reintentar con la misma clave');
    expect(command).toContain('getReadiness(this.scope(), code');
    expect(command).toContain('this.hasPriorAcceptance()');
  });
});
