import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(join(__dirname, 'dian-config.component.ts'), 'utf8');

describe('DIAN configuration reception entry UI source guards', () => {
  it('excludes the POS-equivalent axis and keeps the real DIAN axis cards', () => {
    expect(component).toContain("axis.configuration_type !== 'equivalent_document'");
    expect(component).toContain('<app-dian-document-type-card');
    expect(component).toContain('readonly stats = computed<AxisStats>');
    expect(component).not.toContain('pos_equivalent_document</');
    expect(component).not.toContain("configuration_type: 'received_documents'");
  });

  it('mounts existing reception configuration inline instead of an operational setup modal', () => {
    expect(component).toContain('ReceivedDocumentsConfigurationComponent');
    expect(component).toContain('<app-received-documents-configuration');
    expect(component).toContain('scope="store"');
    expect(component).toContain('[scopeReady]="receptionScopeReady()"');
    expect(component).toContain('[readOnly]="readOnly()"');
    expect(component).not.toContain('ReceivedDocumentsConfigurationWizardComponent');
    expect(component).not.toContain('receptionOpen');
    expect(component).toContain('takeUntilDestroyed(this.destroyRef)');
    expect(component).toContain('iconBgColor="bg-primary/10"');
    expect(component).toContain('iconBgColor="bg-success/10"');
    expect(component).toContain('iconBgColor="bg-info/10"');
    expect(component).toContain('iconBgColor="bg-warning/10"');
  });

  it('guards wizard modal closure during mutations and masks loading stats', () => {
    expect(component).toContain('private readonly dianWizard = viewChild(DianConfigWizardComponent)');
    expect(component).toContain('readonly canCloseWizard = (): boolean => !this.dianWizard()?.mutating()');
    expect(component).toContain('[canClose]="canCloseWizard"');
    expect(component).toContain('slot="footer"');
    expect(component).toContain('[disabled]="!canCloseWizard()"');
    expect(component).toContain('if (!this.canCloseWizard()) return;');
    expect((component.match(/\[loading\]="loading\(\)"/g))?.length).toBe(4);
  });

  it('does not render failed readiness as zero stats and uses readable error copy', () => {
    for (const stat of ['total', 'enabled', 'production', 'notStarted']) {
      expect(component).toContain(`[value]="loadError() ? '—' : s.${stat}"`);
    }
    expect(component).toContain('class="text-sm text-[var(--color-error)]">{{ message }}</p>');
    expect(component).toContain('iconColor="text-success"');
    expect(component).toContain('iconColor="text-info"');
    expect(component).toContain('iconColor="text-warning"');
  });

  it('preserves scope/read-only honesty and hides reception for superadmin', () => {
    expect(component).toMatch(/@if\s*\(!isSuperAdmin\(\)\s*&&/i);
    expect(component).toContain("this.auth.hasPermission('invoicing:received:read')");
    expect(component).toContain('readonly canWrite = computed(() => !this.readOnly() && !this.scopeBlockReason())');
    expect(component).toContain('ORGANIZATION');
    expect(component).toMatch(/La recepción de esta tienda se administra allí/i);
    expect(component).not.toContain('AiPaywallModalComponent');
    expect(component).toContain("fiscalScope() !== 'ORGANIZATION' && canReadReception()");
  });

  it('redirects the sales-invoice axis to the activation wizard only in store context', () => {
    expect(component).toContain("const SALES_INVOICE_AXIS: DianConfigurationType = 'invoicing'");
    expect(component).toContain("this.router.navigate(['/admin/invoicing/activation'])");
    expect(component).toMatch(/this\.hasAxisDetailRoute && axis\.configuration_type === SALES_INVOICE_AXIS/);
    expect(component).toContain("this.route.snapshot.data['axisDetailRoute'] === true");
    // canWrite() se evalúa antes de redirigir.
    expect(component.indexOf('if (!this.canWrite())')).toBeLessThan(component.indexOf('this.goToActivation();'));
    expect(component).toContain('[redirectSalesInvoice]="hasAxisDetailRoute"');
  });

  it('offers the activation CTA only when sales invoice is not enabled in production', () => {
    expect(component).toContain('@if (showActivationCta())');
    expect(component).toContain('Activar facturación electrónica');
    expect(component).toContain("sales?.environment === 'production' && sales?.enablement_status === 'enabled'");
    expect(component).toContain('!this.hasAxisDetailRoute || !this.canWrite()');
  });
});
