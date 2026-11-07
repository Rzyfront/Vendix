import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  CreateWorkflowSecretDto,
  UpdateWorkflowSecretDto,
} from './workflow-secrets.dto';

/** The value is never selected by the management API: only `resolveMany` reads it. */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  description: true,
  last_used_at: true,
  created_at: true,
  updated_at: true,
} as const;

/** `{{secrets.NAME}}` (the validator accepts inner spaces). */
export const SECRET_TOKEN = /\{\{\s*secrets\.([A-Z][A-Z0-9_]{0,59})\s*\}\}/g;

/** Names of the secrets a piece of JSON text refers to. */
export function secretNamesIn(text: string): Set<string> {
  const names = new Set<string>();
  for (const m of text.matchAll(SECRET_TOKEN)) names.add(m[1]);
  return names;
}

/**
 * Store secrets for the HTTP node (P3.2). Values are stored encrypted, the
 * API never returns them, and they are decrypted only when a call runs.
 */
@Injectable()
export class WorkflowSecretsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new ForbiddenException('Acceso denegado: falta el contexto de tienda');
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id,
    };
  }

  list() {
    const { store_id } = this.ctx();
    return this.prisma.workflow_secrets.findMany({
      where: { store_id },
      select: PUBLIC_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  /** Names only (validation context of the editor and of publishing). */
  async names(storeId: number): Promise<string[]> {
    const rows = await this.prisma.workflow_secrets.findMany({
      where: { store_id: storeId },
      select: { name: true },
    });
    return rows.map((r: { name: string }) => r.name);
  }

  async create(dto: CreateWorkflowSecretDto) {
    const { store_id, organization_id, user_id } = this.ctx();
    try {
      return await this.prisma.workflow_secrets.create({
        data: {
          store_id,
          organization_id,
          name: dto.name,
          value_enc: this.encryption.encrypt(dto.value),
          description: dto.description?.trim() || null,
          created_by_user_id: user_id,
        },
        select: PUBLIC_SELECT,
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_SECRET_DUPLICATE);
      }
      throw e;
    }
  }

  async replace(id: number, dto: UpdateWorkflowSecretDto) {
    const { store_id } = this.ctx();
    await this.require(id, store_id);
    const data: Record<string, unknown> = {};
    if (dto.value !== undefined) data.value_enc = this.encryption.encrypt(dto.value);
    if (dto.description !== undefined) data.description = dto.description.trim() || null;
    const res = await this.prisma.workflow_secrets.updateMany({
      where: { id, store_id },
      data,
    });
    if (res.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_SECRET_NOT_FOUND);
    return this.prisma.workflow_secrets.findFirst({
      where: { id, store_id },
      select: PUBLIC_SELECT,
    });
  }

  /**
   * A real delete (it is the store's own configuration). Refused while a
   * published, active flow still refers to it, listing those flows.
   */
  async remove(id: number) {
    const { store_id } = this.ctx();
    const secret = await this.require(id, store_id);
    const flows = await this.flowsUsing(store_id, secret.name);
    if (flows.length > 0) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_SECRET_IN_USE, undefined, {
        flows,
      });
    }
    await this.prisma.workflow_secrets.deleteMany({ where: { id, store_id } });
    return { id };
  }

  /** Decrypts the named secrets of one store and stamps `last_used_at`. */
  async resolveMany(
    storeId: number,
    names: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (names.length === 0) return out;
    const rows = await this.prisma.workflow_secrets.findMany({
      where: { store_id: storeId, name: { in: [...names] } },
      select: { id: true, name: true, value_enc: true },
    });
    for (const r of rows as { id: number; name: string; value_enc: string }[]) {
      out.set(r.name, this.encryption.decrypt(r.value_enc));
    }
    if (rows.length > 0) {
      await this.prisma.workflow_secrets.updateMany({
        where: { store_id: storeId, id: { in: rows.map((r: { id: number }) => r.id) } },
        data: { last_used_at: new Date() },
      });
    }
    return out;
  }

  private async require(id: number, storeId: number) {
    const row = await this.prisma.workflow_secrets.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, name: true },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_SECRET_NOT_FOUND);
    return row as { id: number; name: string };
  }

  private async flowsUsing(storeId: number, name: string) {
    const defs = await this.prisma.workflow_definitions.findMany({
      where: { store_id: storeId, status: 'active', published_version_id: { not: null } },
      select: { key: true, name: true, published_version_id: true },
    });
    if (defs.length === 0) return [];
    const versions = await this.prisma.workflow_versions.findMany({
      where: {
        store_id: storeId,
        id: {
          in: defs.map((d: { published_version_id: number | null }) => d.published_version_id as number),
        },
      },
      select: { id: true, definition: true },
    });
    const used = new Set<number>();
    for (const v of versions as { id: number; definition: unknown }[]) {
      if (secretNamesIn(JSON.stringify(v.definition ?? {})).has(name)) used.add(v.id);
    }
    return (
      defs as { key: string; name: string; published_version_id: number }[]
    )
      .filter((d) => used.has(d.published_version_id))
      .map((d) => ({ key: d.key, name: d.name }));
  }
}
