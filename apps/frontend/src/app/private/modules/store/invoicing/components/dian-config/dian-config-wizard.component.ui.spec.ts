import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, 'dian-config-wizard.component.ts'),
  'utf8',
);

describe('DIAN wizard contextual help source guards', () => {
  it('provides one informational panel for every wizard step', () => {
    expect(source.match(/class="step-help-panel/g)).toHaveLength(5);
    expect(source.match(/aria-label="Ayuda del paso de /g)).toHaveLength(5);
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
  });

  it('uses 16px shared form controls and a compact stepper when the axis is locked', () => {
    expect(source.match(/<app-(?:input|selector) size="lg"/g)).toHaveLength(10);
    expect(source).toContain('[size]="configurationTypeLocked() ? \'sm\' : \'md\'"');
  });
});
