import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(join(__dirname, 'received-documents-configuration.component.ts'), 'utf8');
const wizard = readFileSync(join(__dirname, 'received-documents-configuration-wizard.component.ts'), 'utf8');
const activation = readFileSync(join(__dirname, 'received-buyer-event-activation.component.ts'), 'utf8');
const activationTemplate = readFileSync(join(__dirname, 'received-buyer-event-activation.component.html'), 'utf8');
const dianWizard = readFileSync(join(__dirname, '../components/dian-config/dian-config-wizard.component.ts'), 'utf8');

describe('received documents configuration UI source guards (static, not E2E)', () => {
  it('preserves the organization configuration surface for its existing consumer', () => {
    expect(component).toContain('DocumentReceptionConnectionsComponent');
    expect(component).toContain('ReceivedBuyerEventActivationComponent');
    expect(component).toContain("'organization:invoicing:received'");
  });

  it('uses a model-backed modal and preserves scope/read permission boundaries', () => {
    expect(wizard).toContain('readonly isOpen = model(false)');
    expect(wizard).toContain("readonly scopeEligible = computed(() => this.scope() === 'store' && this.scopeReady() && !this.isSuperAdmin())");
    expect(wizard).toContain('@if (!scopeEligible())');
    expect(wizard).toContain("} @else if (!canRead()) {");
    expect(wizard).toContain('No tienes permiso para consultar la configuración de recepción de documentos de esta tienda.');
    expect(wizard).toContain('if (!this.isOpen() || !this.scopeEligible() || !this.canRead()) return;');
    expect(wizard).toContain('const eligible = open && canRead && this.scopeEligible();');
    expect(wizard).toContain('readonly canRead = computed(() => this.scopeEligible()');
    expect(wizard).toContain('<app-modal');
    expect(wizard).toContain('[dialog]="true"');
    expect(wizard).toContain('[canClose]="canCloseModal"');
    expect(wizard).toContain("return 'Selecciona una entidad fiscal de tienda para usar esta configuración.';");
    expect(wizard).toContain('No se encontró un eje DIAN de facturación para esta entidad fiscal.');
    expect(wizard).toContain('if (changed || opened || becameEligible)');
    expect(wizard).toContain('slot="footer"');
    expect(wizard).toContain('this.step.set(0)');
    expect(wizard).toContain('this.readinessRequest?.unsubscribe()');
  });

  it('shows separate loading, retryable error, blocked gate, and active reception states', () => {
    expect(wizard).toContain('Consultando el estado fiscal…');
    expect(wizard).toContain('role="alert"');
    expect(wizard).toContain('(clicked)="loadReadiness()">Reintentar');
    expect(wizard).toContain('Primero activa la configuración DIAN y la facturación electrónica de tu tienda');
    expect(wizard).toContain('routerLink="/admin/invoicing/dian-config" (click)="close()"');
    expect(wizard).toContain('min-h-11 items-center justify-center rounded-lg px-3 font-medium underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text-primary)]');
    expect(wizard).toContain("axis.environment === 'production'");
    expect(wizard).toContain("axis.enablement_status === 'enabled'");
    expect(wizard).toContain('config?.id === axis.config_id');
    expect(wizard).toContain("config.environment === 'production'");
    expect(wizard).toContain("config.enablement_status === 'enabled'");
    expect(wizard).toContain('readonly receptionActive = computed(() =>');
    expect(wizard).toContain('@if (receptionActive())');
    expect(wizard).toContain('if (this.busy() || !this.receptionActive()) return;');
    expect(wizard).toContain('this.step.set(0);');
    const activationGate = wizard.match(/readonly receptionActive = computed\(\(\) => \{([\s\S]*?)\n  \}\);/)?.[1] ?? '';
    expect(activationGate).toContain('this.isOpen()');
    expect(activationGate).toContain('this.scopeEligible()');
    expect(activationGate).toContain('this.canRead()');
    expect(activationGate).toContain('!this.readinessLoading()');
    expect(activationGate).toContain('!this.readinessError()');
    expect(activationGate).not.toContain('axis.readiness?.ready');
  });

  it('fails closed on malformed fiscal readiness/configuration payloads', () => {
    expect(wizard).toContain('private readFiscalReadiness(response: unknown)');
    expect(wizard).toContain('if (!this.isRecord(payload) || !Array.isArray(payload[\'axes\'])) return null;');
    expect(wizard).toContain('DIAN_CONFIGURATION_TYPES.some((allowedType) => allowedType === type)');
    expect(wizard).toContain('configId === null || (typeof configId === \'number\' && Number.isFinite(configId))');
    expect(wizard).toContain('private readDianConfig(response: unknown)');
    expect(wizard).toContain('typeof config[\'id\'] === \'number\'');
    expect(wizard).toContain('typeof config[\'software_id\'] === \'string\'');
    expect(wizard).toContain('validEnvironments.includes(config[\'environment\'] as string)');
    expect(wizard).toContain('validStatuses.includes(config[\'enablement_status\'] as DianConfig[\'enablement_status\'])');
    expect(wizard).toContain('private unwrapData(response: unknown): unknown');
    expect(wizard).toContain("Object.prototype.hasOwnProperty.call(response, 'data')");
    expect(wizard).toContain('this.failReadiness(\'La respuesta del estado fiscal no tiene un formato válido. Reintenta la consulta.\')');
    expect(wizard).toContain('this.failReadiness(\'La respuesta de la configuración DIAN guardada no es válida. Reintenta la consulta.\')');
    expect(wizard).not.toContain('?.data ?? response');
  });

  it('keeps secondary-surface status badges legible with primary foregrounds', () => {
    expect(activationTemplate).toContain('bg-surface-secondary px-2.5 py-1 text-xs font-medium text-text-primary">{{ stateLabel() }}');
    expect(activationTemplate).toContain('bg-surface-secondary px-2 py-1 text-xs font-semibold text-text-primary">No solicitado');
    expect(dianWizard).toContain('bg-[var(--color-surface-secondary)] text-text-primary">');
    expect(dianWizard).toContain("not_started: 'bg-[var(--color-surface-secondary)] text-text-primary'");
    expect(dianWizard).toContain("return classes[status] || 'bg-[var(--color-surface-secondary)] text-text-primary'");
  });

  it('removes embedded DIAN editing and only blocks modal closure for buyer-event submission', () => {
    expect(wizard).toContain('readonly busy = computed(() => !!this.eventActivation()?.submitLoading())');
    expect(wizard).not.toContain('DianConfigWizardComponent');
    expect(wizard).not.toContain('<vendix-dian-config-wizard');
    expect(wizard).not.toContain('showDianWizard');
    expect(wizard).not.toContain('onDianConfigSaved');
    expect(wizard).not.toContain('openDianWizard');
    expect(wizard).not.toContain('onDianWizardCancelled');
    expect(wizard).not.toContain('wizard.polling()');
    expect(wizard).not.toContain('wizard.loadingReadiness()');
    expect(wizard).not.toContain('wizard.loadingAuditLogs()');
  });

  it('uses three non-clickable steps only after the DIAN configuration is active', () => {
    expect(wizard).toContain("{ label: 'DIAN propia' }");
    expect(wizard).toContain("{ label: 'Eventos' }");
    expect(wizard).toContain("{ label: 'Operación' }");
    expect(wizard).toContain('[clickable]="false"');
    expect(wizard).toContain("axis.configuration_type === 'invoicing'");
    expect(wizard).toContain('getFiscalReadiness()');
    expect(wizard).toContain('getDianConfigById(configId)');
    expect(wizard).toContain('software_id');
    expect(wizard).toContain('tooltipText="Identificador informado por DIAN');
    expect(wizard).toContain('hasCertificate()');
    expect(wizard).toContain('@if (certificateExpiry(); as expiry)');
    expect(wizard).toContain('formatDate(expiry)');
    expect(wizard).toContain('environmentLabel(axis.environment)');
    expect(wizard).toContain('DIAN_ENABLEMENT_STATUS_LABELS[axis.enablement_status]');
    expect(wizard).toContain('if (Number.isNaN(date.getTime())) return \'Fecha no disponible\';');
    expect(wizard).toContain('formatDateOnlyUTC(date)');
    expect(wizard).toContain('Guardar datos no significa que DIAN haya habilitado');
    expect(wizard).toContain('La recepción automática desde DIAN no está implementada');
    expect(wizard).not.toContain('DocumentReceptionConnectionsComponent');
    expect(wizard).not.toMatch(/imap|webhook|provider.?secret|artificial intelligence|AiPaywall/i);
    expect(wizard).not.toContain('software_pin_encrypted');
    expect(wizard).not.toContain('certificate_password_encrypted');
    expect(wizard).not.toContain('certificate_s3_key }}</');
    expect(wizard).not.toContain("view: 'review'");
    expect(wizard).not.toMatch(/<span[^>]*tabindex="0"[^>]*><app-icon name="info"/);
  });

  it('keeps buyer-event review inline without a nested modal and preserves permission/CAS/pagination contracts', () => {
    expect(wizard).toContain('[embedded]="true"');
    expect(activationTemplate).toContain("[id]=\"'buyer-event-config'\"");
    expect(activationTemplate).toContain("[id]=\"'buyer-event-evidence'\"");
    expect(activationTemplate).not.toContain('id="buyer-event-config"');
    expect(activationTemplate).not.toContain('id="buyer-event-evidence"');
    expect(activation).toContain('readonly embedded = input(false)');
    expect(activation).toContain('expected_version: this.status()!.version');
    expect(activation).toContain('readonly filters = signal({ page: 1, limit: 25 })');
    expect(activation).toContain('readonly page = computed(() => this.filters().page)');
    expect(activation).toContain('readonly totalItems = computed(() => this.options()?.total ?? 0)');
    expect(activation).toContain('readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.filters().limit))');
    expect(activation).toContain('this.api.getOptions(this.scope(), this.apiStoreId(), page, limit)');
    expect(activation).toContain('Number.isInteger(responseLimit) && responseLimit > 0');
    expect(activation).toContain('pageCount(): number { return this.totalPages(); }');
    expect(activation.match(/this.filters.update\(\(current\) => \(\{ \.\.\.current, page: 1 \}\)\);/g)).toHaveLength(2);
    const statusMessage = activation.match(/statusMessage\(\): string \{([\s\S]*?)\n  \}\n  blockers\(/)?.[1] ?? '';
    expect(statusMessage).toContain("if (this.loading()) return 'Consultando habilitación…';");
    expect(statusMessage.indexOf('if (this.loading())')).toBeLessThan(statusMessage.indexOf('if (!this.status())'));
    expect(activation).toContain('this.auth.hasPermission');
    expect(activation).toContain('this.statusCode(error) === 409');
    expect(activation).toContain('getReadiness(scope, code, storeId)');
    expect(activation).toContain('DIAN_ENABLEMENT_STATUS_LABELS[config.enablement_status]');
    expect(activation).toContain('this.form.controls.dian_configuration_id.valueChanges.pipe(startWith(this.form.controls.dian_configuration_id.value))');
    expect(activation).toContain('{ initialValue: this.form.controls.dian_configuration_id.value }');
    expect(activation).toContain('this.selectedEvidence.set(null);');
    expect(activation).toContain('this.form.controls.evidence_id.setValue(null);');
    expect(activation).toContain('if (Number.isNaN(date.getTime())) return \'Fecha no disponible\';');
    expect(activation).toContain("hourCycle: 'h23'");
    expect(activationTemplate).toContain('@if (embedded() && inlineRequest())');
    expect(activationTemplate).toContain('<app-pagination');
    expect(activationTemplate).toContain('<app-selector');
    expect(activationTemplate).toContain('<app-toggle');
    expect(activationTemplate).toContain('<app-button');
    expect(activationTemplate).toContain('<app-tooltip');
    expect(activationTemplate).toContain('evento 034 es solo de consulta');
    expect(activationTemplate).toContain('[disabled]="submitLoading()"');
    expect(activationTemplate).toContain('[content]="codeTooltip(code)"');
    expect(activationTemplate).toContain('selectedConfigurationWarning()');
    expect(activationTemplate).toContain('bg-warning-light p-3 text-sm text-text-primary" role="note"');
    const alertTags = [...activationTemplate.matchAll(/<div\b(?=[^>]*\brole="alert")[^>]*>/g)].map(([tag]) => tag);
    expect(alertTags).toHaveLength(3);
    for (const tag of alertTags) {
      expect(tag).toContain('text-text-primary');
      expect(tag).not.toMatch(/\btext-error\b/);
    }
    expect(activationTemplate).toContain('bg-success-light px-2 py-1 text-xs font-semibold text-text-primary">Listo');
    expect(activationTemplate).toContain('bg-warning-light px-2 py-1 text-xs font-semibold text-text-primary">Bloqueado');
    expect(activationTemplate).toContain('text-xs text-text-primary">Se muestran hasta 100 configuraciones.');
    expect(activationTemplate).toContain('font-medium text-text-primary underline" routerLink="/admin/invoicing/dian-config"');
    expect(activationTemplate).toContain('font-medium text-text-primary underline" routerLink="/admin/fiscal"');
    expect(activationTemplate).not.toContain('text-sm text-error" role="alert"');
    expect(activationTemplate).not.toContain('font-medium text-primary underline');
    expect(activationTemplate).toContain('No se transmiten eventos a la DIAN desde esta pantalla.');
    expect(activation).toContain('Pagination exception: evidence is returned as a server-paginated page');
    expect(activationTemplate).not.toContain('event 034');
  });

  it('keeps buttons in the reception and buyer-event activation at accessible touch height', () => {
    for (const source of [wizard, activationTemplate]) {
      const buttonTags = source.match(/<app-button\b/g) ?? [];
      const sizedButtonTags = source.match(/<app-button\b[^>]*\bcustomClasses="[^"]*\bmin-h-11\b[^"]*"/g) ?? [];
      expect(buttonTags.length).toBeGreaterThan(0);
      expect(sizedButtonTags).toHaveLength(buttonTags.length);
    }
  });
});
