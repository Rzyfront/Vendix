import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(join(__dirname, 'received-documents-configuration.component.ts'), 'utf8');
const wizard = readFileSync(join(__dirname, 'received-documents-configuration-wizard.component.ts'), 'utf8');
const activation = readFileSync(join(__dirname, 'received-buyer-event-activation.component.ts'), 'utf8');
const activationTemplate = readFileSync(join(__dirname, 'received-buyer-event-activation.component.html'), 'utf8');

describe('received documents configuration UI source guards (static, not E2E)', () => {
  it('preserves the organization configuration surface for its existing consumer', () => {
    expect(component).toContain('DocumentReceptionConnectionsComponent');
    expect(component).toContain('ReceivedBuyerEventActivationComponent');
    expect(component).toContain("'organization:invoicing:received'");
  });

  it('uses a model-backed modal with three non-clickable steps and footer controls', () => {
    expect(wizard).toContain('readonly isOpen = model(false)');
    expect(wizard).toContain("readonly scopeEligible = computed(() => this.scope() === 'store' && this.scopeReady() && !this.isSuperAdmin())");
    expect(wizard).toContain('@if (!scopeEligible())');
    expect(wizard).toContain('if (!this.isOpen() || !this.scopeEligible() || !this.canRead()) return;');
    expect(wizard).toContain('const eligible = open && canRead && this.scopeEligible();');
    expect(wizard).toContain('readonly canRead = computed(() => this.scopeEligible()');
    expect(wizard).toContain('<app-modal');
    expect(wizard).toContain('[dialog]="true"');
    expect(wizard).toContain('[canClose]="canCloseModal"');
    expect(wizard).toContain("{ label: 'DIAN propia' }");
    expect(wizard).toContain("{ label: 'Eventos' }");
    expect(wizard).toContain("{ label: 'Operación' }");
    expect(wizard).toContain('[clickable]="false"');
    expect(wizard).toContain('if (changed || opened || becameEligible)');
    expect(wizard).toContain('slot="footer"');
    expect(wizard).toContain('this.step.set(0)');
    expect(wizard).toContain('this.readinessRequest?.unsubscribe()');
  });

  it('reuses only current DIAN own-invoicing state and manual wizard, without secrets or false readiness', () => {
    expect(wizard).toContain("axis.configuration_type === 'invoicing'");
    expect(wizard).toContain('<vendix-dian-config-wizard');
    expect(wizard).toContain('[configurationTypeLocked]="true"');
    expect(wizard).toContain('getFiscalReadiness()');
    expect(wizard).toContain('getDianConfigById(configId)');
    expect(wizard).toContain('software_id');
    expect(wizard).toContain('tooltipText="Identificador informado por DIAN');
    expect(wizard).toContain('hasCertificate()');
    expect(wizard).toContain('environmentLabel(axis.environment)');
    expect(wizard).toContain('canConfigureDian()');
    expect(wizard).toContain('(clicked)="openDianWizard()"');
    expect(wizard).toContain('if (!this.canConfigureDian() || this.busy()) return;');
    expect(wizard).toContain('formatDateOnlyUTC(value)');
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

  it('embeds buyer-event review without a nested modal and preserves permission/CAS/pagination contracts', () => {
    expect(wizard).toContain('[embedded]="true"');
    expect(activation).toContain('readonly embedded = input(false)');
    expect(activation).toContain('expected_version: this.status()!.version');
    expect(activation).toContain('this.api.getOptions(this.scope(), this.apiStoreId(), page)');
    expect(activation).toContain('this.auth.hasPermission');
    expect(activation).toContain('this.statusCode(error) === 409');
    expect(activation).toContain('getReadiness(scope, code, storeId)');
    expect(activationTemplate).toContain('@if (embedded() && inlineRequest())');
    expect(activationTemplate).toContain('<app-pagination');
    expect(activationTemplate).toContain('<app-selector');
    expect(activationTemplate).toContain('<app-toggle');
    expect(activationTemplate).toContain('<app-button');
    expect(activationTemplate).toContain('<app-tooltip');
    expect(activationTemplate).toContain('evento 034 es solo de consulta');
    expect(activationTemplate).toContain('[disabled]="submitLoading()"');
    expect(activationTemplate).toContain('[content]="codeTooltip(code)"');
    expect(activation).toContain('Pagination exception: evidence is returned as a server-paginated page');
    expect(activationTemplate).not.toContain('event 034');
  });
});
