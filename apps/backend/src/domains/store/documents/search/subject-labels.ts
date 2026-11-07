import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

/** Subject type of a record of a custom collection. */
export const CUSTOM_RECORD = 'custom_record';

export interface SubjectLabel {
  label: string | null;
  /** Only for `custom_record`: the collection the record belongs to. */
  collection_key: string | null;
  collection_name: string | null;
}

export const subjectKey = (type: string, id: number) => `${type}:${id}`;

/**
 * Display name of dossier subjects: the record title (with its collection),
 * the supplier or the employee. Other kinds (and rows not found) come back
 * with a null label and the caller falls back to its own title.
 */
export async function resolveSubjectLabels(
  prisma: StorePrismaService,
  scope: { store_id: number; organization_id: number },
  subjects: Array<{ type: string; id: number }>,
): Promise<Map<string, SubjectLabel>> {
  const out = new Map<string, SubjectLabel>();
  const idsOf = (type: string) => [...new Set(subjects.filter((s) => s.type === type).map((s) => s.id))];
  const set = (type: string, id: number, label: string | null, collection?: { key: string; name: string }) =>
    out.set(subjectKey(type, id), {
      label,
      collection_key: collection?.key ?? null,
      collection_name: collection?.name ?? null,
    });

  const recordIds = idsOf(CUSTOM_RECORD);
  if (recordIds.length > 0) {
    const records: Array<{ id: number; title: string; collection_id: number }> =
      await prisma.workflow_records.findMany({
        where: { store_id: scope.store_id, id: { in: recordIds } },
        select: { id: true, title: true, collection_id: true },
      });
    const collections: Array<{ id: number; key: string; name: string }> = records.length
      ? await prisma.workflow_collections.findMany({
          where: {
            store_id: scope.store_id,
            id: { in: [...new Set(records.map((r) => r.collection_id))] },
          },
          select: { id: true, key: true, name: true },
        })
      : [];
    const byId = new Map(collections.map((c) => [c.id, c]));
    for (const r of records) {
      const col = byId.get(r.collection_id);
      set(CUSTOM_RECORD, r.id, r.title, col ? { key: col.key, name: col.name } : undefined);
    }
  }

  const supplierIds = idsOf('supplier');
  if (supplierIds.length > 0) {
    const rows: Array<{ id: number; name: string }> = await prisma.suppliers.findMany({
      where: { organization_id: scope.organization_id, id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) set('supplier', r.id, r.name);
  }

  const employeeIds = idsOf('employee');
  if (employeeIds.length > 0) {
    const rows: Array<{ id: number; first_name: string; last_name: string }> =
      await prisma.employees.findMany({
        where: { organization_id: scope.organization_id, id: { in: employeeIds } },
        select: { id: true, first_name: true, last_name: true },
      });
    for (const r of rows) set('employee', r.id, `${r.first_name} ${r.last_name}`.trim());
  }
  return out;
}
