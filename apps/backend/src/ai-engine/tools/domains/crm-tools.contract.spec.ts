import { AIToolRegistry } from '../ai-tool-registry';
import { TOOL_DISCOVERY_QUERIES_ES } from '../tool-discovery-queries.es';
import { createCrmCustomerTools } from './crm-customers.tools';
import { createCrmPipelineTools } from './crm-pipeline.tools';
import { createCrmSegmentTools } from './crm-segments.tools';
import { createCrmTagTools } from './crm-tags.tools';
import { createCrmTaskCampaignTools } from './crm-tasks-campaigns.tools';
import { createCustomerTools } from './customers.tools';
import { createCustomerWriteTools } from './writes.tools';
import { CRM_PERMISSIONS, CRM_TOOL_DOMAIN } from './crm-tools.shared';

/**
 * QUI-1042 family contract: what Vex and Vexi can do over customers and CRM,
 * pinned against the controllers' `@Permissions`. A tool calls the service
 * directly, so `requiredPermissions` is the only gate between a chat and the
 * data: a drift here is a silent privilege change.
 */

const P = CRM_PERMISSIONS;

/** name → permissions the matching controller route requires. */
const EXPECTED: Record<string, { perms: string[]; write: boolean }> = {
  // S1 / S4 / S6 (notes)
  get_customer_crm_profile: { perms: [P.CUSTOMERS_READ], write: false },
  archive_customer: { perms: [P.CUSTOMERS_DELETE], write: true },
  assign_customer_owner: { perms: [P.CUSTOMERS_UPDATE], write: true },
  list_customer_notes: { perms: [P.CUSTOMERS_READ], write: false },
  add_customer_note: { perms: [P.CUSTOMERS_UPDATE], write: true },
  // S2
  list_crm_tags: { perms: [P.CUSTOMERS_READ], write: false },
  save_crm_tag: { perms: [P.SEGMENTS_MANAGE], write: true },
  delete_crm_tag: { perms: [P.SEGMENTS_MANAGE], write: true },
  tag_customers: { perms: [P.CUSTOMERS_UPDATE], write: true },
  // S3 / S8
  list_crm_segments: { perms: [P.CUSTOMERS_READ], write: false },
  get_crm_segment_members: { perms: [P.CUSTOMERS_READ], write: false },
  find_customers_by_criteria: { perms: [P.CUSTOMERS_READ], write: false },
  save_crm_segment: { perms: [P.SEGMENTS_MANAGE], write: true },
  delete_crm_segment: { perms: [P.SEGMENTS_MANAGE], write: true },
  update_segment_members: { perms: [P.CUSTOMERS_UPDATE], write: true },
  // S5
  get_crm_pipeline: { perms: [P.PIPELINE_READ], write: false },
  list_crm_opportunities: { perms: [P.PIPELINE_READ], write: false },
  create_crm_opportunity: { perms: [P.PIPELINE_MANAGE], write: true },
  move_crm_opportunity: { perms: [P.PIPELINE_MANAGE], write: true },
  set_crm_opportunity_result: { perms: [P.PIPELINE_MANAGE], write: true },
  // S6 (tasks) / S7
  list_crm_tasks: { perms: [P.TASKS_MANAGE], write: false },
  create_crm_task: { perms: [P.TASKS_MANAGE], write: true },
  complete_crm_task: { perms: [P.TASKS_MANAGE], write: true },
  list_crm_campaigns: { perms: [P.CAMPAIGNS_SEND], write: false },
  create_crm_campaign_draft: { perms: [P.CAMPAIGNS_SEND], write: true },
  send_crm_campaign: { perms: [P.CAMPAIGNS_SEND], write: true },
};

/** Bulk writes (S8): they take a list of customers and preview each one. */
const BULK_TOOLS: Record<string, string[]> = {
  tag_customers: ['customer_ids'],
  assign_customer_owner: ['customer_ids'],
  update_segment_members: ['add_customer_ids', 'remove_customer_ids'],
};

function buildCrmTools() {
  const deps = {} as any;
  return [
    ...createCrmCustomerTools(deps),
    ...createCrmTagTools(deps),
    ...createCrmSegmentTools(deps),
    ...createCrmPipelineTools(deps),
    ...createCrmTaskCampaignTools(deps),
  ];
}

describe('crm-tools · contrato de la familia (QUI-1042)', () => {
  const tools = buildCrmTools();
  const byName = new Map(tools.map((t) => [t.name, t]));

  it('registra exactamente el catálogo esperado, sin nombres repetidos', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
  });

  it('convive con las herramientas de clientes existentes en un mismo registro', () => {
    const deps = {} as any;
    const registry = new AIToolRegistry(deps);
    registry.registerMany(createCustomerTools(deps));
    registry.registerMany(createCustomerWriteTools(deps));
    expect(() => registry.registerMany(tools)).not.toThrow();
    for (const name of ['find_customer', 'upsert_customer', 'tag_customers']) {
      expect(registry.get(name)).toBeDefined();
    }
  });

  it.each(Object.entries(EXPECTED))(
    '%s exige los permisos de su ruta y declara su categoría',
    (name, { perms, write }) => {
      const tool = byName.get(name)!;
      expect(tool.domain).toBe(CRM_TOOL_DOMAIN);
      expect(tool.version).toBe('1');
      expect([...(tool.requiredPermissions ?? [])].sort()).toEqual(
        [...perms].sort(),
      );
      expect(typeof tool.handler).toBe('function');
      expect(tool.clientSide).not.toBe(true);
      if (write) {
        expect(tool.requiresConfirmation).toBe(true);
        expect(tool.readOnly).not.toBe(true);
        expect(typeof tool.preview).toBe('function');
      } else {
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).not.toBe(true);
      }
    },
  );

  it.each(Object.keys(EXPECTED))(
    '%s tiene consultas de descubrimiento y sinónimos para que el router lo elija',
    (name) => {
      const queries = TOOL_DISCOVERY_QUERIES_ES[name] ?? [];
      expect(queries.length).toBeGreaterThanOrEqual(6);
      expect(new Set(queries).size).toBe(queries.length);
      expect(
        byName.get(name)!.discovery?.synonyms?.length,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(Object.entries(BULK_TOOLS))(
    '%s acepta lista de clientes para acciones en lote',
    (name, params) => {
      const props = byName.get(name)!.parameters.properties ?? {};
      for (const param of params) expect(props[param]).toBeDefined();
    },
  );

  it('un cajero con solo lectura de clientes no ve ninguna escritura CRM', () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(tools);
    const visible = registry
      .getAvailableDefinitions([P.CUSTOMERS_READ])
      .map((d) => d.function.name)
      .sort();
    const writes = Object.entries(EXPECTED)
      .filter(([, e]) => e.write)
      .map(([n]) => n);
    for (const name of writes) expect(visible).not.toContain(name);
    expect(visible).toEqual(
      [
        'find_customers_by_criteria',
        'get_crm_segment_members',
        'get_customer_crm_profile',
        'list_crm_segments',
        'list_crm_tags',
        'list_customer_notes',
      ].sort(),
    );
  });

  it('sin permisos no ve nada de la familia CRM', () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(tools);
    expect(registry.getAvailableDefinitions([])).toEqual([]);
  });

  it('voz (sin paso de confirmación) solo expone lecturas', () => {
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(tools);
    const all = Object.values(CRM_PERMISSIONS);
    const voice = registry
      .getReadOnlyDefinitions(all)
      .map((d) => d.function.name);
    const reads = Object.entries(EXPECTED)
      .filter(([, e]) => !e.write)
      .map(([n]) => n)
      .sort();
    expect([...voice].sort()).toEqual(reads);
  });
});
