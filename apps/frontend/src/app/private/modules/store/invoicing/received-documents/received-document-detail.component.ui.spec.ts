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
    expect(detail).toMatch(/@if \(!isElectronicPos\(doc\)\) \{\s*<app-received-buyer-event-command/);
    expect((detail.match(/<app-received-buyer-event-command\b/g) ?? []).length).toBe(1);
    expect((detail.match(/<app-card\b/g) ?? []).length).toBe(7);
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


describe('Received detail honest reception evidence and POS source guards (static, not E2E)', () => {
  it('keeps a persistent warning and one responsive unverified badge without deriving verification from AR', () => {
    const banner = 'Esta factura no ha sido verificada ante la DIAN. Confirma los datos con tu proveedor antes de pagar';
    expect(detail).toContain(banner);
    expect(detail.indexOf(banner)).toBeLessThan(detail.indexOf('Resumen de la factura recibida'));
    expect(detail).toContain('readonly dianLabel = receivedDianLabel');
    expect(detail).toContain('{{ dianLabel(doc) }}');
    expect(detail).toContain('dianStatusLabel(doc: ReceivedDocument): string { return this.dianLabel(doc); }');
    expect(detail).not.toContain("value === 'not_checked' ? 'No consultada'");
    expect(detail).toContain('readonly receiptEvidence = receivedReceiptEvidence');
    expect(detail).toContain("receipt.included ? 'Constancia incluida' : 'No incluye constancia'");
    expect(detail).toContain('receipt.included && !receipt.reference_matches');
    expect(detail).toContain('ResponseCode incluido: {{ receipt.response_code }}');
    expect(detail).toContain('no valida la factura ante la DIAN ni registra una aceptación legal');
    expect(detail).not.toContain('[innerHTML]');
    expect(detail).not.toContain('receipt.response_code ===');
    expect(detail).not.toContain('doc.accepted_at =');
  });

  it('hides only buyer commands for explicit POS classification, preserving legal events and FEV fallback', () => {
    expect(detail).toContain('readonly isElectronicPos = receivedIsElectronicPos');
    expect(detail).toContain("isElectronicPos(doc) ? 'Documento POS electrónico' : typeLabel(doc.document_type)");
    expect(detail).toMatch(/@if \(!isElectronicPos\(doc\)\) \{\s*<app-received-buyer-event-command/);
    expect(detail).toContain('Las acciones RADIAN de factura electrónica de venta (FEV) no están disponibles');
    expect(detail).toContain('Su historial legal y sus evidencias siguen disponibles');
    expect(detail).toContain('doc.events ?? []');
    expect(detail).toContain('doc.confirmed_goods_at || doc.accepted_at');
    expect(detail).toContain("event.event_code === '034' && event.status === 'accepted'");
    expect(detail).not.toContain("doc.document_type !== 'invoice'");
    expect(detail).not.toContain('getReadiness(');
  });

  it('uses authoritative transport/source helpers, safe filenames and explicit derived XML evidence', () => {
    expect(detail).toContain('readonly sourceLabel = receivedDocumentSourceLabel');
    expect(detail).toContain('Origen: {{ sourceLabel(doc) }}');
    expect(detail).not.toContain('Origen: {{ channelLabel(doc.source_channel) }}');
    expect(detail).toContain('{{ displayFilename(file) }}');
    expect(detail).toContain('return this.safeFilename(file.file_name)');
    expect(detail).toContain("file.role === 'commercial' && !!doc.files?.some((entry) => entry.role === 'container')");
    expect(detail).toContain('evidencia derivada del DOM');
    expect(detail).toContain('CRLF a LF');
    expect(detail).toContain('AttachedDocument conserva el original autoritativo');
    expect(detail).toContain('SHA-256 del archivo almacenado');
    expect(detail).toContain('this.service.downloadFile(this.scope, doc.id, file.id, this.storeId())');
    expect(detail).toContain("if (contextKey !== this.contextKey) return;");
  });

  it('shows only a fixed complement warning for authoritative email trace with bounded code arrays', () => {
    expect(detail).toContain('if (doc.email_transport_received !== true) return false');
    expect(detail).toContain("this.metadataObject(this.metadataObject(doc.metadata)['email_reception'])");
    expect(detail).toContain('warnings.slice(0, 4)');
    expect(detail).toContain("technicalWarnings.includes('COMPLEMENT_ARCHIVE_NOT_EXPANDED')");
    expect(detail).toContain("warning.code === 'COMPLEMENT_ARCHIVE_NOT_EXPANDED'");
    expect(detail).toContain('Complemento archivado dentro del ZIP original, sin expandir ni abrir');
    expect(detail).not.toContain('{{ technicalWarnings');
  });
});
