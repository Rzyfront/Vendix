import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, 'dian-config-wizard.component.ts'),
  'utf8',
);

describe('DIAN wizard contextual help source guards', () => {
  it('provides one informational panel for every wizard step', () => {
    expect((source.match(/class="step-help-panel/g))?.length).toBe(5);
    expect((source.match(/aria-label="Ayuda del paso de /g))?.length).toBe(5);
    expect(source).toMatch(/no representa por sí solo una aprobación de la DIAN/i);
    expect(source).toContain('no sustituye el estado oficial de la DIAN');
  });

  it('explains credential fields with their shared input or selector tooltip', () => {
    const credentialFields = [
      'Nombre de la configuracion',
      'Tipo de documento',
      'NIT / Documento',
      'Digito de Verificacion (DV)',
      'Software ID',
      'PIN del Software',
      'Test Set ID',
      'Contrasena del certificado',
    ];

    for (const label of credentialFields) {
      const labelIndex = source.indexOf(`label="${label}"`);
      expect(labelIndex).toBeGreaterThanOrEqual(0);
      expect(source.slice(labelIndex, labelIndex + 500)).toContain('tooltipText=');
    }

    expect(source).toContain('label="Tipo de documento"');
    expect(source).toContain('tooltipText="Selecciona el tipo de documento');
  });

  it('adds accessible tooltip affordances to file, environment, and test-resolution fields', () => {
    expect(source).toContain('TooltipComponent');
    expect(source).toContain('content="Selecciona el archivo .p12 o .pfx');
    expect(source).toContain('aria-label="Ayuda sobre el archivo del certificado"');
    expect(source).toContain('content="Pruebas se usa durante la habilitación');
    expect(source).toContain('aria-label="Ayuda sobre el ambiente DIAN"');
    expect(source).toContain('tooltipText="Elige la resolución de habilitación');
    expect(source).toContain('min-h-11 min-w-11');
    expect(source).toContain('label for="dian-certificate-file"');
    expect(source).toContain('id="dian-certificate-file"');
    expect(source).toContain('aria-label="Seleccionar archivo del certificado"');
    expect(source).toContain('type="button"');
    expect(source).toContain('[options]="resolutionOptions()"');
    expect(source).toContain('value: resolution.id');
  });

  it('locks the host-selected document type only when requested and preserves accessible selection states', () => {
    expect(source).toContain('readonly configurationTypeLocked = input(false)');
    expect(source).toContain('@if (configurationTypeLocked())');
    expect(source).toContain('Facturación electrónica de esta empresa');
    expect(source).toContain('[attr.aria-pressed]="selectedEnvironment() === \'test\'"');
    expect(source).toContain('[attr.aria-pressed]="selectedEnvironment() === \'production\'"');
    expect(source).toContain('class="p-4 rounded-lg border-2 text-left transition-colors focus-visible:outline');
    expect(source).toContain('focus-visible:outline-[var(--color-text-primary)]');
    expect(source).not.toContain('focus-visible:outline-[var(--color-ring)]');
  });

  it('keeps credential and certificate actions responsive on narrow wizard layouts', () => {
    const responsiveFooters = source.match(
      /<div class="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border">/g,
    );
    expect((responsiveFooters)?.length).toBe(2);

    const credentialsFooter = source.slice(
      source.indexOf('<!-- ═══ Step 1: Credentials'),
      source.indexOf('<!-- ═══ Step 2: Certificate'),
    );
    const certificateFooter = source.slice(
      source.indexOf('<!-- ═══ Step 2: Certificate'),
      source.indexOf('<!-- ═══ Step 3: Environment'),
    );

    for (const footer of [credentialsFooter, certificateFooter]) {
      expect(footer).toContain('flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto');
      expect(footer.match(/<app-button class="w-full sm:w-auto"/g)?.length).toBeGreaterThanOrEqual(2);
    }
    expect(certificateFooter).toContain('class="w-full border-2 border-dashed border-border');
    expect(certificateFooter).toContain('<span class="break-all">{{ selectedFile()!.name }}</span>');
  });

  it('renders audit history with responsive cards and server pagination', () => {
    expect(source).toContain('ResponsiveDataViewComponent');
    expect(source).toContain('PaginationComponent');
    expect(source).toContain('[data]="auditLogs()"');
    expect(source).toContain('[columns]="auditLogColumns"');
    expect(source).toContain('[cardConfig]="auditLogCardConfig"');
    expect(source).toMatch(/<\/app-responsive-data-view>\s*<app-pagination/);
    expect(source).toContain('readonly auditLogFilters = signal({ page: 1, limit: 20 })');
    expect(source).toContain('readonly auditLogTotalItems = signal(0)');
    expect(source).toContain('response?.meta?.total');
    expect(source).toContain('if (this.auditLogFilters().page > this.auditLogTotalPages())');
    expect(source).toContain('this.loadAuditLogs();');
    expect(source).toContain("key: 'id', label: 'Documento'");
    expect(source).toContain("key: 'error_message', label: 'Detalle del error', priority: 2, defaultValue: '—'");
    expect(source).toContain("key: 'error_message'");
    expect(source).toContain("key: 'duration_ms'");
    expect(source).toContain("key: 'created_at'");
    expect(source).toContain('formatStoreDateTime(String(value), this.auditLogTimezone)');
    expect(source).toContain('readonly auditLogTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone');
    expect(source).not.toContain('function formatAuditDateTime');
  });

  it('cancels stale audit requests, auto-loads only for a saved config on step five, and exposes retries', () => {
    expect(source).toContain('private auditLogsSubscription?: Subscription');
    expect(source).toContain('this.auditLogsSubscription?.unsubscribe()');
    expect(source).toContain('takeUntilDestroyed(this.destroyRef)');
    expect(source).toContain('const step = this.activeStep()');
    expect(source).toContain('const configId = this.selectedConfig()?.id ?? null');
    expect(source).toContain('if (step === 4 && configId !== null) this.loadAuditLogs()');
    expect(source).toContain('role="alert"');
    expect(source).toContain('(emptyRefreshClick)="loadAuditLogs()"');
    expect(source).toContain('No se pudo cargar el historial de operaciones DIAN.');
    expect(source).toContain('this.auditLogFilters.set({ page: 1, limit: 20 })');
  });

  it('blocks modal exit and wizard navigation only during mutations', () => {
    expect(source).toContain('readonly mutating = computed(() =>');
    for (const mutation of [
      'savingCredentials', 'uploadingCertificate', 'savingEnvironment', 'testingConnection',
      'runningTestSet', 'checkingStatus', 'diagnosing', 'abandoning', 'promoting',
    ]) {
      expect(source).toContain(`this.${mutation}()`);
    }
    expect(source).toContain('[clickable]="false"');
    expect(source).not.toContain('(stepClicked)=');
    expect(source).toContain('[disabled]="mutating()" (clicked)="cancelled.emit()"');
    expect(source).toMatch(/finish\(\): void \{\s*if \(this\.mutating\(\)\) return;/);
  });

  it('shows explicit loading, error and empty states for readiness and resolutions', () => {
    expect(source).toContain('readonly readinessError = signal<string | null>(null)');
    expect(source).toContain('readonly resolutionsLoading = signal(false)');
    expect(source).toContain('readonly resolutionsError = signal<string | null>(null)');
    expect(source).toContain('Consultando los requisitos de producción');
    expect(source).toContain('Consultando resoluciones de facturación');
    expect(source).toContain('No hay resoluciones disponibles para ejecutar el set de pruebas.');
    expect(source).toContain('(clicked)="loadResolutions()"');
    expect(source).toContain('No se pudieron consultar las resoluciones de facturación.');
  });

  it('keeps semantic body copy readable and preserves decorative icon colors', () => {
    const bodyTags = [...source.matchAll(/<(?:p|span|div)\b[^>]*>/g)].map(([tag]) => tag);
    for (const tag of bodyTags) {
      expect(tag).not.toMatch(/\btext-(?:warning|success|error|info)\b/);
      expect(tag).not.toMatch(/text-\[var\(--color-(?:warning|success|error|info)\)\]/);
    }
    expect(source).toContain("[class]=\"testResult()!.success ? 'text-success' : 'text-error'\"");
    expect(source).toContain("[class]=\"testSetState() === 'passed' ? 'text-success' : 'text-error'\"");
    expect(source).toContain("enabled: 'bg-success-light text-text-primary'");
    expect(source).toContain("suspended: 'bg-error-light text-text-primary'");
    expect(source).toContain('class="text-sm text-text-primary">{{ auditLogsError() }}</p>');
  });

  it('wraps the audit responsive list and adjacent pager in the shared compact card', () => {
    expect(source).toContain('<app-card [responsive]="true" [padding]="false">');
    expect(source).toContain('<div class="px-2 pb-2 pt-3 md:p-4">');
    expect(source).toMatch(/<\/app-responsive-data-view>\s*<app-pagination/);
    expect(source).toContain('map((response: unknown): DianAuditLogPageResponse => response as DianAuditLogPageResponse)');
  });

  it('uses 16px shared form controls and a compact stepper when the axis is locked', () => {
    expect((source.match(/<app-(?:input|selector) size="lg"/g))?.length).toBe(10);
    expect(source).toContain('[size]="configurationTypeLocked() ? \'sm\' : \'md\'"');
  });
});
