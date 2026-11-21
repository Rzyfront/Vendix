import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ConversationPurgeS3Cleaner } from './conversation-purge-s3.cleaner';

const VEX_AGENT_KEY = 'vex';
/** Una tarea `queued`/`running` más vieja que esto se da por abandonada. */
const STALE_TASK_MS = 24 * 60 * 60 * 1000;
/** Tope de iteraciones del SCAN de tokens de confirmación (mejor esfuerzo). */
const REDIS_SCAN_MAX_ITERATIONS = 25;

export interface ConversationPurgePreview {
  messages: number;
  attachments: number;
  blocks: number;
  memories: number;
  has_running_task: boolean;
}

export interface ConversationPurgeResult {
  purged: true;
  counts: {
    messages: number;
    attachments: number;
    blocks: number;
    memories: number;
  };
}

interface Scope {
  store_id: number;
  organization_id: number;
  user_id: number;
}

/**
 * Borrado físico de una conversación de Vex (§3.13 «Borrar de verdad»).
 *
 * Solo el dueño (`user_id` del contexto, dentro de su tienda) y solo hilos con
 * `metadata.agent_key = 'vex'`; cualquier otra cosa responde `AI_CHAT_001` sin
 * tocar nada. La base se borra en UNA transacción y en orden de dependencias;
 * el cliente transaccional no lleva scoping, así que cada `where` repite la
 * tienda y el id de la conversación. S3 y Redis van después del commit y nunca
 * hacen fallar el borrado: lo que quede de S3 vive en la constancia
 * (`ai_conversation_purges`) y lo termina un job.
 *
 * NO se borra: lo que Vex aplicó en el negocio (`ai_agent_effects` se conserva
 * desvinculado: no todo efecto aplicado deja una fila en `audit_logs`, ver
 * `agent-objective.repository.ts` y `crm-tools.shared.ts:32`), documentos
 * guardados en un registro (`ai_attachments` con `linked_entity_*`),
 * recordatorios (`user_reminders`, N11) y el uso/costo (`ai_engine_logs`, solo
 * se anonimiza).
 */
@Injectable()
export class ConversationPurgeService {
  private readonly logger = new Logger(ConversationPurgeService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3Cleaner: ConversationPurgeS3Cleaner,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async preview(id: number): Promise<ConversationPurgePreview> {
    const scope = this.requireScope();
    await this.requireOwnedVexConversation(id, scope);
    const [messages, blocks, attachments, hasRunning] = await Promise.all([
      this.prisma.ai_messages.count({ where: { conversation_id: id } }),
      this.prisma.ai_ui_blocks.count({ where: { conversation_id: id } }),
      this.prisma.ai_attachments.count({
        where: { conversation_id: id, ...UNLINKED_ATTACHMENT },
      }),
      this.hasRunningTask(id),
    ]);
    return {
      messages,
      attachments,
      blocks,
      memories: 0,
      has_running_task: hasRunning,
    };
  }

  /**
   * Ata a la conversación los adjuntos que el turno trae y que aún no tienen
   * dueño. En un chat nuevo el archivo se sube ANTES de que la conversación
   * exista, así que su fila nace con `conversation_id` NULL; sin este paso el
   * borrado no la encontraría y el archivo quedaría huérfano en base y en S3.
   *
   * Solo filas del mismo usuario y tienda, y solo las que están en NULL: un
   * adjunto ya atado a otro hilo nunca se mueve. Mejor esfuerzo: un fallo acá
   * no puede tumbar el turno.
   */
  async claimAttachments(
    conversationId: number,
    handles: readonly string[] | undefined,
  ): Promise<number> {
    const ids = [
      ...new Set(
        (handles ?? [])
          .map((handle) => /^att_(\d+)$/.exec(String(handle))?.[1])
          .filter((id): id is string => !!id)
          .map(Number),
      ),
    ];
    if (ids.length === 0) return 0;
    try {
      const scope = this.requireScope();
      const { count } = await this.prisma.ai_attachments.updateMany({
        where: {
          id: { in: ids },
          store_id: scope.store_id,
          user_id: scope.user_id,
          conversation_id: null,
        },
        data: { conversation_id: conversationId },
      });
      return count;
    } catch (error) {
      this.logger.warn(
        `No se pudieron atar adjuntos a la conversación ${conversationId}: ${
          (error as Error)?.message ?? 'unknown'
        }`,
      );
      return 0;
    }
  }

  async purge(id: number): Promise<ConversationPurgeResult> {
    const scope = this.requireScope();
    await this.requireOwnedVexConversation(id, scope);
    if (await this.hasRunningTask(id)) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_005);
    }

    const { counts, purgeId } = (await this.prisma.$transaction(
      (tx: Prisma.TransactionClient) => this.purgeInTransaction(tx, id, scope),
    )) as { counts: PurgeCounts; purgeId: number };

    // Post-commit, mejor esfuerzo: nada de esto puede deshacer el borrado.
    await this.clearRedis(id, scope.store_id);
    if (counts.s3_keys > 0) {
      try {
        await this.s3Cleaner.clean(purgeId);
      } catch (error) {
        // Las claves siguen en la constancia: el job las reintenta.
        this.logger.warn(
          `purge ${id}: limpieza de S3 diferida: ${(error as Error)?.message}`,
        );
      }
    }

    return {
      purged: true,
      counts: {
        messages: counts.messages,
        attachments: counts.attachments,
        blocks: counts.blocks,
        memories: counts.memories,
      },
    };
  }

  /**
   * Punto de extensión de F4: los recuerdos de la memoria que nacieron de esta
   * conversación y nadie editó a mano. Hoy no existen; devuelve cuántos borró.
   */
  protected async purgeDerivedMemories(
    _tx: Prisma.TransactionClient,
    _conversationId: number,
  ): Promise<number> {
    return 0;
  }

  private async purgeInTransaction(
    tx: Prisma.TransactionClient,
    id: number,
    scope: Scope,
  ): Promise<{ counts: PurgeCounts; purgeId: number }> {
    const owner = {
      store_id: scope.store_id,
      organization_id: scope.organization_id,
    };

    const objectives = await tx.ai_agent_objectives.findMany({
      where: { conversation_id: id, ...owner, user_id: scope.user_id },
      select: { id: true },
    });
    const objectiveIds = objectives.map((o) => o.id);

    // 1. Trazas de la conversación (conversation_id se guarda como texto).
    const traceSpans = await tx.ai_agent_trace_spans.deleteMany({
      where: {
        store_id: scope.store_id,
        OR: [
          { conversation_id: String(id) },
          { objective_id: { in: objectiveIds } },
        ],
      },
    });

    // 2. Efectos aplicados en el negocio: se conservan desvinculados. Se suelta
    //    también la evidencia (FK Restrict hacia tool_results, que se borra).
    const effects = await tx.ai_agent_effects.updateMany({
      where: { store_id: scope.store_id, objective_id: { in: objectiveIds } },
      data: { objective_id: null, evidence_result_id: null },
    });

    // 3. Lo que cuelga del objetivo con Restrict, de hoja a raíz.
    const toolResults = await tx.ai_agent_tool_results.deleteMany({
      where: { store_id: scope.store_id, objective_id: { in: objectiveIds } },
    });
    const tasks = await tx.ai_agent_tasks.deleteMany({
      where: {
        store_id: scope.store_id,
        OR: [{ conversation_id: id }, { objective_id: { in: objectiveIds } }],
      },
    });
    const deletedObjectives = await tx.ai_agent_objectives.deleteMany({
      where: {
        id: { in: objectiveIds },
        conversation_id: id,
        ...owner,
      },
    });

    // 4. Bloques UI (sin FK).
    const blocks = await tx.ai_ui_blocks.deleteMany({
      where: { store_id: scope.store_id, conversation_id: id },
    });

    // 5. Adjuntos: los guardados en un registro (factura de una orden, etc.)
    //    pertenecen a ese registro y solo se desvinculan; el resto se borra y
    //    su objeto S3 queda pendiente.
    const attachmentRows = await tx.ai_attachments.findMany({
      where: { store_id: scope.store_id, conversation_id: id },
      select: {
        id: true,
        s3_key: true,
        linked_entity_type: true,
        linked_entity_id: true,
      },
    });
    const linked = attachmentRows.filter(
      (a) => a.linked_entity_type !== null || a.linked_entity_id !== null,
    );
    const unlinked = attachmentRows.filter(
      (a) => a.linked_entity_type === null && a.linked_entity_id === null,
    );
    if (linked.length > 0) {
      await tx.ai_attachments.updateMany({
        where: {
          store_id: scope.store_id,
          conversation_id: id,
          id: { in: linked.map((a) => a.id) },
        },
        data: { conversation_id: null },
      });
    }
    if (unlinked.length > 0) {
      await tx.ai_attachments.deleteMany({
        where: {
          store_id: scope.store_id,
          conversation_id: id,
          id: { in: unlinked.map((a) => a.id) },
        },
      });
    }
    const s3Keys = [...new Set(unlinked.map((a) => a.s3_key))];

    // 6. Mensajes y, al final, la conversación (el resumen va en su fila).
    const messages = await tx.ai_messages.deleteMany({
      where: { conversation_id: id, conversation: { ...owner } },
    });
    const memories = await this.purgeDerivedMemories(tx, id);

    // 7. Uso y costo: se anonimiza, no se borra.
    const logs = await tx.ai_engine_logs.updateMany({
      where: {
        store_id: scope.store_id,
        OR: [
          { conversation_id: String(id) },
          { objective_id: { in: objectiveIds } },
        ],
      },
      data: { conversation_id: null, objective_id: null },
    });

    const conversation = await tx.ai_conversations.deleteMany({
      where: { id, ...owner, user_id: scope.user_id },
    });
    if (conversation.count !== 1) {
      // Carrera con otro borrado: revierte todo.
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }

    const counts: PurgeCounts = {
      messages: messages.count,
      blocks: blocks.count,
      attachments: unlinked.length,
      attachments_detached: linked.length,
      objectives: deletedObjectives.count,
      tasks: tasks.count,
      tool_results: toolResults.count,
      trace_spans: traceSpans.count,
      effects_detached: effects.count,
      engine_logs_anonymized: logs.count,
      memories,
      s3_keys: s3Keys.length,
    };

    // Constancia: quién, cuándo y cuántos. Sin título ni contenido.
    const purge = await tx.ai_conversation_purges.create({
      data: {
        ...owner,
        user_id: scope.user_id,
        conversation_id: id,
        agent_key: VEX_AGENT_KEY,
        counts: counts as unknown as Prisma.InputJsonValue,
        pending_s3_keys: s3Keys as unknown as Prisma.InputJsonValue,
        s3_completed_at: s3Keys.length === 0 ? new Date() : null,
      },
      select: { id: true },
    });

    return { counts, purgeId: purge.id };
  }

  private requireScope(): Scope {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context.organization_id || !context.user_id) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }
    return {
      store_id: context.store_id,
      organization_id: context.organization_id,
      user_id: context.user_id,
    };
  }

  /** Dueño + tienda (por el scope) + agente Vex; todo lo demás es 404. */
  private async requireOwnedVexConversation(id: number, scope: Scope) {
    const conversation = await this.prisma.ai_conversations.findFirst({
      where: { id, user_id: scope.user_id },
    });
    const metadata = conversation?.metadata as Record<string, unknown> | null;
    if (!conversation || metadata?.agent_key !== VEX_AGENT_KEY) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }
    return conversation;
  }

  /**
   * Una tarea en cola o ejecutándose (reciente), o un objetivo activo con
   * lease vigente. Un objetivo `active` sin lease es un plan en pausa de
   * conversación, no trabajo en curso.
   */
  private async hasRunningTask(id: number): Promise<boolean> {
    const now = new Date();
    const [tasks, objectives] = await Promise.all([
      this.prisma.ai_agent_tasks.count({
        where: {
          conversation_id: id,
          status: { in: ['queued', 'running'] },
          created_at: { gt: new Date(now.getTime() - STALE_TASK_MS) },
        },
      }),
      this.prisma.ai_agent_objectives.count({
        where: {
          conversation_id: id,
          semantic_status: 'active',
          lease_until: { gt: now },
        },
      }),
    ]);
    return tasks > 0 || objectives > 0;
  }

  /** Redis: turno activo y tokens de confirmación atados a la conversación. */
  private async clearRedis(id: number, storeId: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(`vexi:turn:${id}`);
      let cursor = '0';
      for (let i = 0; i < REDIS_SCAN_MAX_ITERATIONS; i++) {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          'vexi:confirm-meta:*',
          'COUNT',
          200,
        );
        cursor = next;
        for (const key of keys) {
          const raw = await this.redis.get(key);
          if (!raw) continue;
          try {
            const meta = JSON.parse(raw) as {
              conversationId?: number;
              storeId?: number;
            };
            if (meta.conversationId === id && meta.storeId === storeId) {
              await this.redis.del(
                key,
                key.replace('vexi:confirm-meta:', 'vexi:confirm:'),
              );
            }
          } catch {
            // metadata ilegible: expira sola por TTL
          }
        }
        if (cursor === '0') break;
      }
    } catch (error) {
      this.logger.warn(
        `purge ${id}: limpieza de Redis incompleta: ${(error as Error)?.message}`,
      );
    }
  }
}

/** Adjuntos sin vínculo a un registro del negocio (los únicos que se borran). */
const UNLINKED_ATTACHMENT = {
  linked_entity_type: null,
  linked_entity_id: null,
} as const;

interface PurgeCounts {
  messages: number;
  blocks: number;
  attachments: number;
  attachments_detached: number;
  objectives: number;
  tasks: number;
  tool_results: number;
  trace_spans: number;
  effects_detached: number;
  engine_logs_anonymized: number;
  memories: number;
  s3_keys: number;
}
