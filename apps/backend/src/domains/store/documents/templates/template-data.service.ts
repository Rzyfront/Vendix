import { Injectable } from '@nestjs/common';
import { WorkflowDefinitionV1, findStage } from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  TokenScope,
  TokenSchemaEntry,
  isRowPath,
  lookup,
  tokensOf,
} from './template-tokens';

export const DEFAULT_TIMEZONE = 'America/Bogota';

/** The values a template can read, grouped by token root. */
export interface DataTree {
  store: Record<string, unknown>;
  instance: Record<string, unknown>;
  fields: Record<string, unknown>;
  subject: Record<string, unknown>;
  user: Record<string, unknown>;
  now: string;
}

export interface DataMeta {
  timezone: string;
  currency: string;
  /** `fields.<key>` → label of the flow field (for readable errors). */
  fieldLabels: Record<string, string>;
}

export interface InstanceInfo {
  id: number;
  organization_id: number;
  store_id: number;
  reference: string;
  title: string;
  status: string;
  current_stage_key: string;
  created_at: Date;
  subject_type: string | null;
  subject_id: number | null;
  data: Record<string, unknown> | null;
  version_id: number;
}

/** Reads the data a template draws on: the store, the issuer, the request. */
@Injectable()
export class TemplateDataService {
  constructor(private readonly prisma: StorePrismaService) {}

  private storeId(): number {
    return RequestContextService.getStoreId() as number;
  }

  async store(): Promise<{ tree: Record<string, unknown>; timezone: string; currency: string }> {
    const storeId = this.storeId();
    const db = this.prisma.withoutScope();
    const [store, address, settings] = await Promise.all([
      this.prisma.stores.findFirst({
        where: { id: storeId },
        select: { name: true, legal_name: true, tax_id: true, tax_id_dv: true, logo_url: true, timezone: true },
      }),
      db.addresses.findFirst({
        where: { store_id: storeId },
        orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
        select: { address_line1: true, address_line2: true, city: true, phone_number: true },
      }),
      this.prisma.store_settings.findFirst({ where: { store_id: storeId }, select: { settings: true } }),
    ]);
    const nit = store?.tax_id ? `${store.tax_id}${store.tax_id_dv ? `-${store.tax_id_dv}` : ''}` : null;
    const address_text = address
      ? [address.address_line1, address.address_line2, address.city].filter(Boolean).join(', ')
      : null;
    const general = (settings?.settings as { general?: { currency?: string } } | null)?.general;
    return {
      tree: {
        name: store?.name ?? null,
        legal_name: store?.legal_name ?? null,
        nit,
        address: address_text,
        phone: address?.phone_number ?? null,
        logo: store?.logo_url ?? null,
      },
      timezone: store?.timezone || DEFAULT_TIMEZONE,
      currency: general?.currency || 'COP',
    };
  }

  async user(userId: number | null): Promise<Record<string, unknown>> {
    if (!userId) return {};
    const u = await this.prisma.withoutScope().users.findFirst({
      where: { id: userId },
      select: { first_name: true, last_name: true, email: true },
    });
    if (!u) return {};
    return { name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null, email: u.email ?? null };
  }

  async instance(instanceId: number): Promise<{ row: InstanceInfo; definition: WorkflowDefinitionV1 } | null> {
    const row = (await this.prisma.workflow_instances.findFirst({
      where: { id: instanceId, store_id: this.storeId() },
    })) as InstanceInfo | null;
    if (!row) return null;
    const version = await this.prisma.workflow_versions.findFirst({
      where: { id: row.version_id, store_id: this.storeId() },
      select: { definition: true },
    });
    return { row, definition: (version?.definition ?? { fields: [], stages: [] }) as unknown as WorkflowDefinitionV1 };
  }

  instanceTree(info: { row: InstanceInfo; definition: WorkflowDefinitionV1 }): Pick<DataTree, 'instance' | 'fields' | 'subject'> {
    const { row, definition } = info;
    return {
      instance: {
        id: row.id,
        reference: row.reference,
        title: row.title,
        created_at: row.created_at.toISOString(),
        current_stage: findStage(definition, row.current_stage_key)?.name ?? row.current_stage_key,
      },
      fields: { ...(row.data ?? {}) },
      subject: { type: row.subject_type, id: row.subject_id },
    };
  }

  labelsOf(definition: WorkflowDefinitionV1 | null): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of definition?.fields ?? []) out[`fields.${f.key}`] = f.label;
    return out;
  }

  /** Values for every token path of the schema that the tree can answer. */
  scopeFor(schema: TokenSchemaEntry[], tree: DataTree, meta: Pick<DataMeta, 'timezone' | 'currency'>): TokenScope {
    const values: Record<string, unknown> = {};
    const full: TokenScope = {
      values: { store: tree.store, instance: tree.instance, fields: tree.fields, subject: tree.subject, user: tree.user, now: tree.now },
      timezone: meta.timezone,
      currency: meta.currency,
    };
    for (const e of schema) {
      const v = lookup(full, e.path);
      if (v !== undefined && v !== null) values[e.path] = v;
    }
    values.now = tree.now;
    return { values, timezone: meta.timezone, currency: meta.currency };
  }
}

/** Example values for the editor preview, shaped by the filters each token uses. */
export function sampleValues(texts: string[], tableSources: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const rowKeys = new Map<string, string>();
  for (const text of texts) {
    for (const ref of tokensOf(text)) {
      const names = ref.filters.map((f) => f.name);
      const sample = names.some((n) => n === 'money' || n === 'number' || n === 'words')
        ? 1500000
        : names.includes('date')
          ? '2026-01-15'
          : 'Ejemplo';
      if (isRowPath(ref.path)) rowKeys.set(ref.path.split('.')[1], String(sample));
      else values[ref.path] = sample;
    }
  }
  const row = Object.fromEntries([...rowKeys].map(([k, v]) => [k, /^\d+$/.test(v) ? Number(v) : v]));
  for (const source of tableSources) values[source] = [row, row, row];
  return values;
}
