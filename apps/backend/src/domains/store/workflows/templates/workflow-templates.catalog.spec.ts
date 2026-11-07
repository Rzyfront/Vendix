import { validateWorkflowDefinition } from '@common/workflows/contract';
import {
  WORKFLOW_TEMPLATES,
  WORKFLOW_TEMPLATE_CATEGORIES,
} from './workflow-templates.catalog';

/** Same role keys the publish path reads from `roles` for any store. */
const SYSTEM_ROLES = ['owner', 'admin', 'manager', 'supervisor', 'employee'];

const EXPECTED_KEYS = [
  'compras-aprobacion-monto',
  'gastos-reembolsos',
  'anticipos',
  'vacaciones-permisos',
  'contratacion',
  'retiro-empleado',
  'alta-proveedor',
  'renovacion-contratos',
  'pqr',
  'cierre-caja',
  'conciliacion-mensual',
  'solicitud-pago',
];

describe('workflow templates catalog', () => {
  it('has exactly the 12 Administration templates', () => {
    expect(WORKFLOW_TEMPLATES.map((t) => t.key)).toEqual(EXPECTED_KEYS);
  });

  it('has unique keys and the definition key matches the template key', () => {
    const keys = WORKFLOW_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of WORKFLOW_TEMPLATES) expect(t.definition.key).toBe(t.key);
  });

  it('describes every template for the gallery', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(2);
      expect(t.category.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.icon).toMatch(/^[a-z0-9-]+$/);
      expect(t.definition.name).toBe(t.name);
    }
  });

  it('lists the categories without duplicates', () => {
    expect(WORKFLOW_TEMPLATE_CATEGORIES).toEqual([
      'Compras',
      'Finanzas',
      'Talento humano',
      'Legal',
      'Servicio al cliente',
    ]);
  });

  it.each(EXPECTED_KEYS)('%s passes the publish validation with no errors', (key) => {
    const t = WORKFLOW_TEMPLATES.find((x) => x.key === key)!;
    const result = validateWorkflowDefinition(t.definition, {
      roleKeys: SYSTEM_ROLES,
      groupKeys: [],
      userIds: [],
      publishedTemplateKeys: [],
      flowKeys: [],
      secretNames: [],
      collections: {},
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('uses the parallel and wait stages where the process needs them', () => {
    const types = (key: string) =>
      WORKFLOW_TEMPLATES.find((t) => t.key === key)!.definition.stages.map((s) => s.type);
    expect(types('contratacion')).toContain('parallel');
    expect(types('retiro-empleado')).toContain('parallel');
    expect(types('renovacion-contratos')).toContain('wait');
  });
});
