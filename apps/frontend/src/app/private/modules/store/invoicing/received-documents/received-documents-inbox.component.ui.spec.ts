import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'received-documents-page.component.ts'), 'utf8');
const facade = readFileSync(join(__dirname, 'received-documents-inbox.facade.ts'), 'utf8');
const service = readFileSync(join(__dirname, 'received-documents.service.ts'), 'utf8');

describe('received inbox wiring source guards (static, not runtime E2E)', () => {
  it('uses four shared stats, a responsive card, shared filters and server pagination', () => {
    expect((page.match(/<app-stats\b/g) ?? []).length).toBe(4);
    expect(page).toContain('Buzón de facturas');
    expect(page).toContain('<app-card [responsive]="true" [padding]="false" overflow="visible">');
    expect(page).toContain('<app-options-dropdown');
    expect(page).toContain('[filterValues]="filterValues()"');
    expect(page).toContain('(filterChange)="onFilterChange($event)"');
    expect(page).toContain('onFilterChange(values: FilterValues)');
    expect(page).toMatch(/<app-responsive-data-view\b[^>]*?(?:\/>|>\s*<\/app-responsive-data-view>)(?:\s*<\/div>)?\s*<app-pagination\b/);
    expect((page.match(/<app-pagination\b/g) ?? []).length).toBe(1);
    expect(page).toContain('[currentPage]="page()"');
    expect(page).toContain('[total]="inbox.total()"');
    expect(page).not.toContain('<app-sticky-header');
    expect(page).not.toContain('<select');
    expect(page).toContain('new ResizeObserver');
    expect(page).toContain('[style.top.px]="statsOffset()"');
  });
  it('uses server counts rather than page counts and never presents failed summaries as zero', () => {
    expect(page).toContain("this.inbox.summaryError() ? '—' : this.inbox.summary()?.[key] ?? '—'");
    expect(page).toContain('No se pudo actualizar el resumen');
    expect(service).toContain('/summary');
    expect(service).toContain("['search', 'source_channel', 'document_type']");
    expect(facade).toContain('summaryError.set(summary.error !== null)');
    expect(page).not.toContain('rows().filter');
  });
  it('keeps table and cards on the same Spanish attention/legal labels and honest OCR wording', () => {
    expect(page).toContain('transform: receivedInboxLabel, badgeTransform: receivedInboxLabel');
    expect(page).toContain('transform: receivedLegalLabel, badgeTransform: receivedLegalLabel');
    expect(page).toContain("badgeKey: 'inbox_state', badgeConfig: this.inboxBadgeConfig, badgeTransform: receivedInboxLabel");
    expect(page).toContain("{ key: 'legal_status', label: 'Legal', transform: receivedLegalLabel }");
    expect(page).toContain("label: 'Lectura / OCR'");
    expect(page).toContain('Leer por OCR no acepta ni contabiliza');
    expect(page).not.toContain('Procesadas IA');
    expect(page).toContain('legal_status: this.legalStatus()');
    expect(page).toContain("this.storeSettings.settings()?.general?.timezone ?? 'America/Bogota'");
    expect(page).not.toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
  });
  it('keeps organization fiscal selection and query params when visiting details', () => {
    expect(page).toContain("this.auth.fiscalScope() === 'STORE'");
    expect(page).toContain('(storeChange)="onFiscalStoreChange($event)"');
    expect(page).toContain('store_id: storeId || null, page: 1');
    expect(page).toContain('queryParams: this.route.snapshot.queryParams');
    expect(page).toContain("queryParamsHandling: 'merge'");
    expect(page).toContain('if (value !== this.searchValue()) return;');
    expect(page).toContain("['inbox_state', 'legal_status', 'source_channel', 'document_type']");
  });
  it('polls only read endpoints and cleans subscriptions, timers and availability listeners', () => {
    expect(facade).toContain('this.service.list(scope, query)');
    expect(facade).toContain('this.service.getSummary(scope, query)');
    expect(facade).toContain('this.service.getReceptionStatus(scope, query.store_id)');
    expect(facade).toContain('receivedInboxRefreshDelay(this.failures)');
    expect(facade).toContain('receivedInboxCanPoll(');
    expect(facade).toContain('if (this.inFlight) {');
    expect(facade).toContain('takeUntilDestroyed(this.destroyRef)');
    expect(facade).toContain("removeEventListener('visibilitychange'");
    expect(facade).toContain("removeEventListener('focus'");
    expect(facade).toContain('this.activeRequest?.unsubscribe()');
    expect(facade).toContain('clearTimeout(this.timer)');
    expect(facade).not.toContain('toast.');
    expect(facade).not.toContain('.sync(');
    expect(facade).not.toContain('setInterval');
  });
  it('isolates auth tenant changes and ignores superseded query responses without losing prior rows on errors', () => {
    expect(page).toContain('this.auth.userId(), this.auth.userStore()?.id ?? null, this.auth.userOrganization()?.id ?? null');
    expect(page).toContain('const ready = this.scopeReady() && this.canRead()');
    expect(facade).toContain('receivedInboxContextKey(scope, query, tenantKey)');
    expect(facade).toContain('this.context?.tenantKey !== tenantKey');
    expect(facade).toContain('if (generation !== this.generation || this.destroyed) return;');
    expect(facade).toContain('if (list.value) {');
    expect(facade).toContain('this.error.set(list.error)');
    expect(facade).toContain('if (summary.value) this.summary.set(summary.value)');
  });
  it('buffers list membership changes during focused work or a modal without resetting the current page', () => {
    expect(page).toContain('this.uploading() || this.scanImportOpen() || this.manualFormOpen() || this.listFocused()');
    expect(page).toContain('Aplicar actualización');
    expect(facade).toContain('receivedInboxProtectedRows(this.rows(), incoming)');
    expect(facade).toContain('this.pendingRows.set(incoming)');
    expect(facade).toContain('this.rows.set(pending)');
    expect(page).not.toContain('this.page.set(1)');
    expect(page).toContain('this.inbox.refreshAfterMutation()');
  });
  it('keeps import/capture/scan on existing write seams without gating them on DIAN or connection health', () => {
    expect(page).toContain('this.service.importXml(scope, file, storeId)');
    expect(page).toContain('<app-received-document-import');
    expect(page).toContain('<app-received-document-form');
    expect(page).toContain('canImport() && this.scopeReady()');
    expect(page).toContain('Documento guardado para revisión. No fue aceptado ni contabilizado.');
    expect(page).toContain('Solicita configuración al administrador');
    expect(service).toContain('/reception-status');
    expect(facade).not.toContain('getConnections');
  });
});
