import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowEngineService } from '../engine/workflow-engine.service';
import { storeAllowsFlows } from '../engine/workflow-industry';
import {
  INBOUND_MAX_BODY_BYTES,
  INBOUND_REJECTED_KEY_PREFIX,
  isValidIdempotencyKey,
  verifyInboundSignature,
} from './workflow-inbound.rules';

export interface InboundCall {
  /** Exact bytes received (as UTF-8): the signature covers them, not a re-serialization. */
  rawBody: string;
  timestamp: unknown;
  signature: unknown;
  idempotencyKey: unknown;
}

export interface InboundResult {
  reference: string;
  instance_id: number;
  /** True when the key had been used before: the original answer is repeated. */
  replayed: boolean;
}

/**
 * Public side of the inbound webhook (R5): no user session, the hook id and
 * the HMAC identify the flow and the store. The store of the call is the
 * hook's, never anything in the body.
 */
@Injectable()
export class WorkflowInboundReceiverService {
  private readonly logger = new Logger(WorkflowInboundReceiverService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly engine: WorkflowEngineService,
  ) {}

  async receive(publicId: string, call: InboundCall): Promise<InboundResult> {
    const notFound = () => new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_NOT_FOUND);
    if (typeof publicId !== 'string' || publicId.length < 8 || publicId.length > 40) {
      throw notFound();
    }
    const db = this.prisma.withoutScope();
    const hook = await db.workflow_inbound_hooks.findFirst({
      where: { public_id: publicId, is_active: true },
    });
    if (!hook) throw notFound();

    if (Buffer.byteLength(call.rawBody, 'utf8') > INBOUND_MAX_BODY_BYTES) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_PAYLOAD_TOO_LARGE);
    }
    let secret: string;
    try {
      secret = this.encryption.decrypt(hook.secret_enc);
    } catch {
      this.logger.error(`Inbound hook ${hook.id} has an unreadable secret.`);
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_SIGNATURE_INVALID);
    }
    if (!verifyInboundSignature(secret, call, call.rawBody)) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_SIGNATURE_INVALID);
    }
    // The industry can change after the hook was created (background paths re-check it).
    if (!(await storeAllowsFlows(db as never, hook.store_id))) throw notFound();

    const key = call.idempotencyKey;
    if (!isValidIdempotencyKey(key)) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_KEY_REQUIRED);
    }
    const payload = this.parseBody(call.rawBody);

    const previous = await db.workflow_inbound_requests.findFirst({
      where: { hook_id: hook.id, idempotency_key: key },
    });
    if (previous?.status === 'accepted' && previous.instance_id) {
      const instance = await db.workflow_instances.findFirst({
        where: { id: previous.instance_id, store_id: hook.store_id },
        select: { id: true, reference: true },
      });
      if (instance) {
        return { reference: instance.reference, instance_id: instance.id, replayed: true };
      }
    }

    const recent = await db.workflow_inbound_requests.count({
      where: { hook_id: hook.id, created_at: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recent >= hook.rate_limit_per_minute) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_RATE_LIMITED);
    }

    try {
      const result = await RequestContextService.runIsolated(
        {
          store_id: hook.store_id,
          organization_id: hook.organization_id,
          is_super_admin: false,
          is_owner: false,
        },
        () =>
          this.engine.startExternal({
            definitionId: hook.definition_id,
            kind: 'webhook',
            values: payload.values,
            idempotencyKey: `${hook.id}:${key}`,
            started: { hook_id: hook.id },
            title: payload.title,
          }),
      );
      await this.record(db, hook, key, {
        status: 'accepted',
        instance_id: result.instance.id,
      });
      await db.workflow_inbound_hooks.updateMany({
        where: { id: hook.id, store_id: hook.store_id },
        data: { last_used_at: new Date() },
      });
      return {
        reference: result.instance.reference,
        instance_id: result.instance.id,
        replayed: result.replayed,
      };
    } catch (e) {
      await this.record(db, hook, `${INBOUND_REJECTED_KEY_PREFIX}${randomUUID()}`, {
        status: 'rejected',
        error: this.describe(e),
      });
      throw e;
    }
  }

  private parseBody(raw: string): { values: Record<string, unknown>; title?: string } {
    const invalid = () => new VendixHttpException(ErrorCodes.WORKFLOW_INBOUND_PAYLOAD_INVALID);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw invalid();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
    const { values, title } = parsed as { values?: unknown; title?: unknown };
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw invalid();
    if (title !== undefined && typeof title !== 'string') throw invalid();
    return {
      values: values as Record<string, unknown>,
      ...(typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 200) } : {}),
    };
  }

  private describe(e: unknown): string {
    const text =
      e instanceof VendixHttpException ? `${e.errorCode}: ${e.message}` : 'INTERNAL_ERROR';
    return text.slice(0, 500);
  }

  /** The unique `(hook_id, key)` makes a concurrent duplicate harmless: ignore it. */
  private async record(
    db: ReturnType<StorePrismaService['withoutScope']>,
    hook: { id: number; store_id: number },
    key: string,
    row: { status: 'accepted' | 'rejected'; instance_id?: number; error?: string },
  ) {
    try {
      await db.workflow_inbound_requests.create({
        data: { store_id: hook.store_id, hook_id: hook.id, idempotency_key: key, ...row },
      });
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') {
        this.logger.error(`Could not record inbound request of hook ${hook.id}.`);
      }
    }
  }
}
