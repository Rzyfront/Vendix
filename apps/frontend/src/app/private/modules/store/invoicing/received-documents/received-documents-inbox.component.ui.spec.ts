import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(__dirname, 'received-documents-page.component.ts'), 'utf8');
const facade = readFileSync(join(__dirname, 'received-documents-inbox.facade.ts'), 'utf8');
const emailChild = readFileSync(join(__dirname, 'received-email-messages.component.ts'), 'utf8');
const emailTypes = readFileSync(join(__dirname, 'received-email-reception.interface.ts'), 'utf8');
const backendEmailTypes = readFileSync(join(__dirname, '../../../../../../../../backend/src/domains/received-documents/interfaces/document-email-reception.interface.ts'), 'utf8');
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
    expect(page).toContain("badgeKey: 'inbox_state', badgeConfig: this.inboxBadgeConfig, badgeTransform: receivedMobileInboxLabel");
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
    expect(page).toContain('this.uploading() || this.scanImportOpen() || this.manualFormOpen() || this.emailWizardOpen() || this.emailWizardProtected() || this.listFocused()');
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


describe('email inbox area integration contracts (source guards, no runtime claim)', () => {
  it('uses local invoice/email areas with only one active paginator and preserves invoice URL state', () => {
    expect(page).toContain("readonly areaView = signal<'invoices' | 'not_processed' | 'history'>('invoices')");
    expect(page).toContain("@if (areaView() === 'invoices')");
    expect(page).toContain('[isActive]="areaView() !== \'invoices\'"');
    expect(page).toContain("No procesados ({{ emailNotProcessedCount() }})");
    expect(page).toContain('Historial de correo');
    expect((page.match(/<app-stats\b/g) ?? []).length).toBe(4);
    expect((page.match(/<app-pagination\b/g) ?? []).length).toBe(1);
    expect((emailChild.match(/<app-pagination\b/g) ?? []).length).toBe(1);
    const change = page.match(/setAreaView\(view:[\s\S]*?\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
    expect(change).toContain('this.areaView.set(view)');
    expect(change).not.toContain('navigate');
    expect(change).not.toContain('form.reset');
    expect(change).not.toContain('searchValue.set');
  });
  it('binds authenticated store context and independent permissions, actual store timezone and safe child outputs', () => {
    expect(page).toContain('[tenantKey]="tenantKey()" [contextReady]="scopeReady()"');
    expect(page).toContain('[canImport]="canImportInCurrentScope()" [canConfigure]="canConfigureEmail()" [canSync]="canSyncEmail()"');
    expect(page).toContain("this.auth.hasPermission('invoicing:received:connections:sync')");
    expect(page).toContain('[timezone]="timezone()"');
    expect(page).toContain("readonly timezone = computed(() => this.storeSettings.settings()?.general?.timezone ?? 'America/Bogota')");
    expect(page).toContain('(documentRequested)="onEmailDocumentRequested($event)"');
    expect(page).toContain('this.emailMessages()?.tenantKey() !== this.tenantKey()');
    expect(emailChild).toContain('this.detail()?.parts.some((part) => part.document_id === id)');
    expect(page).not.toContain('rejected_raw');
    expect(page).not.toContain('transport_facts');
  });
  it('protects buffers and drafts on tabs, and closes wizard only on explicit history intent', () => {
    expect(page).toContain('[disabled]="areaChangeLocked()"');
    expect(page).toContain('(protectedChange)="emailMessagesProtected.set($event)"');
    expect(page).toContain("this.emailMessagesProtected() || this.areaView() !== 'invoices'");
    expect(page).toContain('(historyRequested)="onEmailHistoryRequested()"');
    const completed = page.match(/onEmailCompleted\(\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
    expect(completed).not.toContain('emailWizardOpen.set(false)');
    const history = page.match(/onEmailHistoryRequested\(\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
    expect(history).toContain('wizard.busy()');
    expect(history).toContain('wizard.tenantKey() !== this.tenantKey()');
    expect(history).toContain('this.emailWizardOpen.set(false)');
    expect(history).toContain("this.areaView.set('not_processed')");
  });
  it('uses an honest desktop DIAN badge and exactly one composed mobile attention badge with POS and source labels', () => {
    expect(page).toContain("label: 'Verificación DIAN', badge: true");
    expect(page).toContain('badgeTransform: receivedDianLabel');
    expect(page).toContain("badgeKey: 'inbox_state', badgeConfig: this.inboxBadgeConfig, badgeTransform: receivedMobileInboxLabel");
    expect(page).toContain("receivedIsElectronicPos(doc) ? 'Documento POS electrónico'");
    expect(page).toContain('receivedDocumentSourceLabel(row)');
    expect(page).not.toContain("badgeKey: 'dian_validation_status'");
  });
  it('keeps the exhaustive 32 reason-code mirror aligned with the backend closed catalog', () => {
    const codes = (source: string, name: string) => [...(source.match(new RegExp(name + ' = \\[([\\s\\S]*?)\\] as const'))?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
    const backend = codes(backendEmailTypes, 'DOCUMENT_EMAIL_REASON_CODES');
    expect(backend).toHaveLength(32);
    expect(codes(emailTypes, 'RECEIVED_EMAIL_REASON_CODES')).toEqual(backend);
  });
});


describe('email manual-import fallback selector (source contract, not browser QA)', () => {
  it('offers the three existing import paths without using the rejected email attachments', () => {
    expect(page).toContain('title="Importar manualmente"');
    expect(page).toContain('(clicked)="chooseManualImport(\'xml\')">Importar XML');
    expect(page).toContain('(clicked)="chooseManualImport(\'scan\')">Escanear PDF/foto');
    expect(page).toContain('(clicked)="chooseManualImport(\'manual\')">Capturar manualmente');
    expect(page).toContain('No usamos ni transferimos los adjuntos rechazados del correo.');
    expect(page).toContain("viewChild<ElementRef<HTMLInputElement>>('xmlInput')");
    expect((page.match(/#xmlInput\b/g) ?? []).length).toBe(1);
    expect(page).toContain('this.manualImportOptionsContext() === this.writeContext()');
    expect(page).toContain('if (!this.canUseManualImportOptions()) return;');
    expect(page).toContain('context !== this.writeContext()) return;');
    const choose = page.match(/chooseManualImport\(kind:[\s\S]*?\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
    expect(choose.indexOf('this.closeManualImportOptions()')).toBeLessThan(choose.indexOf('this.scanImportOpen.set(true)'));
    expect(choose.indexOf('this.closeManualImportOptions()')).toBeLessThan(choose.indexOf('this.manualFormOpen.set(true)'));
    expect(choose).toContain('input.click()');
    expect(choose).not.toContain('row.');
    expect(choose).not.toContain('bytes');
    expect(page).toContain('|| this.manualImportOptionsOpen()');
    expect(page).toContain('(cancel)="closeManualImportOptions()" (closed)="closeManualImportOptions()"');
  });
});


describe('XML operating-system picker tenant fence (static source contract)', () => {
  it('requires a nonempty current marker and captures direct accessible input activation', () => {
    expect(page).toContain('(click)="onXmlInputClick($event)" (change)="onFileSelected($event)"');
    const click = page.match(/onXmlInputClick\(event: Event\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
    expect(click).toContain('if (!this.canImportInCurrentScope() || this.uploading())');
    expect(click).toContain('event.preventDefault()');
    expect(click).toContain('this.xmlSelectionContext = this.writeContext()');
    const selected = page.match(/onFileSelected\(event: Event\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
    const fence = 'if (!this.canImportInCurrentScope() || !this.xmlSelectionContext || this.xmlSelectionContext !== this.writeContext())';
    expect(selected).toContain(fence);
    expect(selected.indexOf(fence)).toBeLessThan(selected.indexOf('this.service.importXml(scope, file, storeId)'));
    expect(selected).toContain("input.value = ''; this.xmlSelectionContext = ''; return;");
    expect(selected).not.toContain('this.xmlSelectionContext &&');
    expect(page).toContain("this.xmlSelectionContext = '';\n          const input = this.xmlInput()?.nativeElement;");
  });
});
