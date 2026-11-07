import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

export interface FileDossierContext {
  dossier_id: number;
  dossier_reference: string;
  dossier_title: string;
  subject_type: string | null;
  subject_id: number | null;
  workflow_instance_id: number | null;
  instance_reference: string | null;
  instance_title: string | null;
}

/**
 * Dossier, subject and request of each file (the newest dossier item wins when
 * a file sits in several). Two reads per hop, scoped by `storeId`.
 */
export async function loadFileDossiers(
  prisma: StorePrismaService,
  storeId: number,
  fileIds: number[],
): Promise<Map<number, FileDossierContext>> {
  const out = new Map<number, FileDossierContext>();
  if (fileIds.length === 0) return out;
  const items: Array<{ id: number; file_id: number; dossier_id: number }> =
    await prisma.dossier_items.findMany({
      where: { store_id: storeId, file_id: { in: fileIds } },
      select: { id: true, file_id: true, dossier_id: true },
      orderBy: { id: 'desc' },
    });
  const dossierOf = new Map<number, number>();
  for (const it of items) if (!dossierOf.has(it.file_id)) dossierOf.set(it.file_id, it.dossier_id);
  const dossierIds = [...new Set(dossierOf.values())];
  if (dossierIds.length === 0) return out;
  const dossiers: Array<{
    id: number;
    reference: string;
    title: string;
    subject_type: string | null;
    subject_id: number | null;
    workflow_instance_id: number | null;
  }> = await prisma.dossiers.findMany({ where: { store_id: storeId, id: { in: dossierIds } } });
  const instanceIds = dossiers
    .map((d) => d.workflow_instance_id)
    .filter((v): v is number => v !== null);
  const instances: Array<{ id: number; reference: string; title: string }> = instanceIds.length
    ? await prisma.workflow_instances.findMany({
        where: { store_id: storeId, id: { in: instanceIds } },
        select: { id: true, reference: true, title: true },
      })
    : [];
  const instanceById = new Map(instances.map((i) => [i.id, i]));
  const dossierById = new Map(dossiers.map((d) => [d.id, d]));
  for (const [fileId, dossierId] of dossierOf) {
    const d = dossierById.get(dossierId);
    if (!d) continue;
    const inst = d.workflow_instance_id ? instanceById.get(d.workflow_instance_id) : undefined;
    out.set(fileId, {
      dossier_id: d.id,
      dossier_reference: d.reference,
      dossier_title: d.title,
      subject_type: d.subject_type,
      subject_id: d.subject_id,
      workflow_instance_id: d.workflow_instance_id,
      instance_reference: inst?.reference ?? null,
      instance_title: inst?.title ?? null,
    });
  }
  return out;
}
