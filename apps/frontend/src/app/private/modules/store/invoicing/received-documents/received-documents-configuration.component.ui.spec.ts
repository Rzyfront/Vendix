import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(join(__dirname, 'received-documents-configuration.component.ts'), 'utf8');
const wizard = readFileSync(join(__dirname, 'received-documents-configuration-wizard.component.ts'), 'utf8');
const activation = readFileSync(join(__dirname, 'received-buyer-event-activation.component.ts'), 'utf8');
const activationTemplate = readFileSync(join(__dirname, 'received-buyer-event-activation.component.html'), 'utf8');
const connections = readFileSync(join(__dirname, 'document-reception-connections.component.ts'), 'utf8');
const orgConfig = readFileSync(join(__dirname, '../../../organization/invoicing/pages/dian-config/org-dian-config.component.ts'), 'utf8');

describe('received documents configuration UI source guards (static, not E2E)', () => {
  it('preserves the organization configuration surface for its existing consumer', () => {
    expect(component).toContain('DocumentReceptionConnectionsComponent');
    expect(component).toContain('ReceivedBuyerEventActivationComponent');
    expect(component).toContain("'organization:invoicing:received'");
  });

  it('preserves scope/read boundaries in the detached legacy wrapper', () => {
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

  it('preserves validation and real activation checks in the detached legacy wrapper', () => {
    expect(wizard).toContain('Consultando el estado fiscal…');
    expect(wizard).toContain('role="alert"');
    expect(wizard).toContain('(clicked)="loadReadiness()">Reintentar');
    expect(wizard).toContain('Primero activa la configuración DIAN y la facturación electrónica de tu tienda');
    expect(wizard).toContain('routerLink="/admin/invoicing/dian-config" (click)="close()"');
    expect(wizard).toContain('items-center justify-center rounded-lg px-3 py-2 font-medium text-primary underline focus:outline-none focus:ring-2 focus:ring-primary/50');
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

  it('retains original muted status badges and variant colors without global foreground overrides', () => {
    expect(activationTemplate).toContain('bg-surface-secondary px-2.5 py-1 text-xs font-medium text-text-secondary">{{ stateLabel() }}');
    expect(activationTemplate).toContain('bg-surface-secondary px-2 py-1 text-xs font-semibold text-text-secondary">No solicitado');
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

  it('separates provider channels from the inbox and keeps its fiscal context on navigation', () => {
    expect(component).toContain('Proveedor API');
    expect(component).toContain('Webhook firmado');
    expect(component).toContain('routerLink="/admin/invoicing/received-documents" [queryParams]="receptionQuery()"');
    expect(component).toContain('Abrir buzón');
    expect(component).toContain("store_id: this.scope() === 'organization' ? this.selectedStoreId() : null");
    expect(component).toContain('requires_operational_store');
    expect(component).toContain('Seleccionar tienda operativa');
    expect(component).toContain('La importación manual de XML y el historial siguen disponibles');
    expect(component).not.toContain('received-documents-configuration-wizard');
    expect(component).not.toContain('software_pin_encrypted');
    expect(component).not.toContain('certificate_password_encrypted');
    expect(orgConfig).toContain('[selectedStoreId]="requiresStoreSelector() ? selectedStoreId() : null"');
    expect(orgConfig).toContain('Number.isSafeInteger(parsedStoreId)');
  });

  it('reads safe health with cancellation and generation guards without a false inactive fallback', () => {
    expect(component).toContain('this.api.getReceptionStatus(this.scope()');
    expect(component).toContain('this.healthRequest?.unsubscribe()');
    expect(component).toContain('this.generation++');
    expect(component).toContain('if (generation !== this.generation) return;');
    expect(component).toContain('takeUntilDestroyed(this.destroyRef)');
    expect(component).toContain('this.auth.userStore()?.id');
    expect(component).toContain('this.auth.userOrganization()?.id');
    expect(component).toContain('healthLoading()');
    expect(component).toContain('healthError(); as message');
    expect(component).toContain('!this.isValidHealth(response.data)');
    expect(component).not.toContain('!response.success');
    expect(component).toContain('La respuesta de salud de recepción no tiene un formato válido.');
    expect(component).not.toContain('?.data ?? response');
  });

  it('gates only administrative connections by real DIAN health and exact permissions', () => {
    expect(component).toContain('!this.readOnly() && !this.isSuperAdmin() && this.scopeReady() && this.canRead()');
    expect(component).toContain('this.health()?.dian_active === true');
    expect(component).toContain('!this.healthLoading() && !this.healthError()');
    expect(component).toContain('this.auth.hasPermission(`${this.permissionPrefix()}:connections:configure`)');
    expect(component).toContain('if (!this.canConfigureConnections()) return;');
    expect(component).toContain('@if (canConfigureConnections() && connectionsOpen())');
    expect(component).toContain('Solicita a una persona con permiso de configuración DIAN');
    expect(component).toContain('No se consultan credenciales desde esta vista.');
    expect(connections).toContain(':received:connections:sync`');
    expect(connections).toContain('!this.canSync()');
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
    expect((activation.match(/this.filters.update\(\(current\) => \(\{ \.\.\.current, page: 1 \}\)\);/g))?.length).toBe(2);
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
    expect((alertTags)?.length).toBe(3);
    for (const tag of alertTags) {
      expect(tag).toMatch(/\btext-error\b/);
    }
    expect(activationTemplate).toContain('bg-success-light px-2 py-1 text-xs font-semibold text-success">Listo');
    expect(activationTemplate).toContain('bg-warning-light px-2 py-1 text-xs font-semibold text-warning">Bloqueado');
    expect(activationTemplate).toContain('text-xs text-warning">Se muestran hasta 100 configuraciones.');
    expect(activationTemplate).toContain('font-medium text-primary underline" routerLink="/admin/invoicing/dian-config"');
    expect(activationTemplate).toContain('font-medium text-primary underline" routerLink="/admin/fiscal"');
    expect(activationTemplate).toContain('No se transmiten eventos a la DIAN desde esta pantalla.');
    expect(activation).toContain('Pagination exception: evidence is returned as a server-paginated page');
    expect(activationTemplate).not.toContain('event 034');
  });

  it('uses existing shared button sizes without imposed touch-height overrides', () => {
    for (const source of [wizard, activationTemplate]) {
      expect(source).toContain('<app-button');
      expect(source).not.toContain('customClasses="min-h-11"');
    }
  });
});
