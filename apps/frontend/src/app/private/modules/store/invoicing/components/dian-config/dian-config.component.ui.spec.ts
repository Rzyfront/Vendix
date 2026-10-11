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

  it('renders reception as an independent card and opens a separate manual setup wizard', () => {
    expect(component).toContain('<h2 class="text-base font-semibold text-text-primary">Recepción de documentos</h2>');
    expect(component).toMatch(/Configurar\s*<\/app-button>/);
    expect(component).toContain('<app-received-documents-configuration-wizard');
    expect(component).toContain('[(isOpen)]="receptionOpen"');
    expect(component).toContain('readonly receptionOpen = signal(false)');
    expect(component).toContain('takeUntilDestroyed(this.destroyRef)');
    expect(component).toContain('La conexión directa con DIAN no está implementada');
    expect(component).toContain('xl:grid-cols-4');
    expect(component).toContain('[fullHeight]="true"');
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
    expect(component).toContain('class="text-sm text-text-primary">{{ message }}</p>');
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
    expect(component).toMatch(/readonly canConfigureReception = computed\(\(\) =>[\s\S]*?!this\.isSuperAdmin\(\)[\s\S]*?this\.receptionScopeReady\(\)[\s\S]*?!this\.readOnly\(\)[\s\S]*?hasPermission\('invoicing:write'\)/);
    expect(component).toContain('if (!this.canConfigureReception() || !this.canReadReception()) return;');
    expect(component).not.toContain('AiPaywallModalComponent');
    expect(component).not.toContain('DocumentReceptionConnectionsComponent');
  });
});
