import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  MessageEvent,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import {
  AiAccessGuard,
  RequireAIFeature,
} from '../../subscriptions/guards/ai-access.guard';
import { AIChatService } from '../../ai-chat/ai-chat.service';
import { VEX_DESIGN_TOOL_NAMES } from '../../../../ai-engine/tools/domains/vex-design.tools';
import { FINISH_TURN_TOOL } from '../../../../ai-engine/tools/domains/turn.tools';
import { DesignChatStreamIntentDto } from './vex-design.dto';
import { VexDesignService } from './vex-design.service';
import {
  DESIGN_CHAT_APP_KINDS,
  DesignChatAppKind,
  VEX_DESIGN_CONVERSATION_SURFACE,
  isDesignChatAppKind,
} from './vex-design.types';

/** Herramientas permitidas en los turnos del chat de diseño del editor. */
const DESIGN_TURN_TOOLS: string[] = [...VEX_DESIGN_TOOL_NAMES, FINISH_TURN_TOOL];

/**
 * Apps F4 — endpoints del chat lateral de diseño con Vex en el constructor de
 * apps. Reutiliza el flujo SSE existente de Vex (`AIChatService`) acotado a la
 * app abierta y a las herramientas `vex_design_*`.
 *
 * Alcance: `product_page`, `service_page` y `booking`. `store_home` (Tienda en
 * línea) se rechaza explícitamente.
 */
@Controller('store/apps/design-chat')
@UseGuards(PermissionsGuard)
export class VexDesignController {
  constructor(
    private readonly design: VexDesignService,
    private readonly chatService: AIChatService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Handshake previo al SSE: valida la app y el borrador, crea o reutiliza una
   * conversación de Vex, sincroniza la pila de borrador y emite el `stream_id`.
   */
  @Permissions('store:apps:manage')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('streaming_chat')
  @Post(':kind/stream-intent')
  async createStreamIntent(
    @Param('kind') rawKind: string,
    @Body() dto: DesignChatStreamIntentDto,
  ) {
    const kind = this.requireDesignKind(rawKind);
    const { storeId, userId } = this.requireActor();

    // `conversation_id` es opcional en el DTO: o llega una conversación de Vex
    // perteneciente a esta tienda o se crea una nueva marcada como superficie
    // de diseño para no mezclarla con el historial general de `/admin/vex`.
    let conversationId: number;
    if (dto.conversation_id) {
      const existing = await this.chatService.getConversation(
        dto.conversation_id,
      );
      const metadata = existing?.metadata as
        | Record<string, unknown>
        | null
        | undefined;
      // Un hilo del chat general de Vex (o el de otra app) no puede reutilizarse
      // aquí: se validan agente, superficie y app, no solo el agente.
      if (
        metadata?.agent_key !== 'vex' ||
        metadata?.surface !== VEX_DESIGN_CONVERSATION_SURFACE ||
        metadata?.app_kind !== kind
      ) {
        throw new BadRequestException(
          'La conversación no pertenece a una sesión de diseño de Vex para esta app.',
        );
      }
      conversationId = dto.conversation_id;
    } else {
      const conversation = await this.chatService.createConversation(
        {
          agent_key: 'vex',
          title: `Diseño de ${kind}`,
        },
        {
          surface: VEX_DESIGN_CONVERSATION_SURFACE,
          app_kind: kind,
        },
      );
      conversationId = conversation.id;
    }

    const turnId = randomUUID();
    let session;
    try {
      session = await this.design.initOrSyncSession({
        storeId,
        userId,
        conversationId,
        appKind: kind,
        draft: dto.draft,
        turnId,
      });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const promptContext = await this.design.buildPromptContext(
      storeId,
      conversationId,
    );
    if (!promptContext) {
      throw new BadRequestException(
        'No fue posible preparar el contexto del borrador para Vex.',
      );
    }

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException(
        'Escribe qué quieres cambiar antes de enviar el mensaje a Vex.',
      );
    }

    const streamId = await this.chatService.createDesignStreamIntent(
      conversationId,
      content,
      {
        app_kind: kind,
        prompt_context: promptContext,
        allowed_tools: DESIGN_TURN_TOOLS,
      },
    );

    return this.responseService.success(
      {
        conversation_id: conversationId,
        stream_id: streamId,
        replay_enabled: true,
        draft: session.current_document,
        history_depth: session.history.length,
        can_discard: session.history.length > 0,
      },
      'Stream de diseño listo',
    );
  }

  /**
   * Stream SSE del editor de apps: reutiliza `AIChatService.sendMessageStream`
   * y añade frames `design_draft` cada vez que Vex aplica o descarta un cambio
   * validado en el borrador.
   */
  @Permissions('store:apps:manage')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('streaming_chat')
  @Sse(':kind/stream')
  streamDesignChat(
    @Param('kind') rawKind: string,
    @Query('conversation_id') rawConversationId: string,
    @Query('stream_id') streamId: string,
    @Query('after_sequence') afterSequence?: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    const kind = this.requireDesignKind(rawKind);
    const conversationId = Number.parseInt(rawConversationId, 10);
    const requestContext = RequestContextService.getContext();
    const storeId = requestContext?.store_id;

    return new Observable<MessageEvent>((subscriber) => {
      const abort = new AbortController();
      const heartbeat = setInterval(() => {
        subscriber.next({
          data: `: heartbeat ${Date.now()}`,
        } as MessageEvent);
      }, 15_000);

      const run = async () => {
        try {
          if (!Number.isInteger(conversationId) || conversationId < 1) {
            subscriber.next({
              data: JSON.stringify({
                type: 'error',
                error: 'Falta un conversation_id válido.',
              }),
              type: 'ai-chunk',
            } as MessageEvent);
            subscriber.complete();
            return;
          }

          for await (const chunk of this.chatService.sendMessageStream(
            conversationId,
            streamId,
            abort.signal,
            {
              ...((afterSequence ?? lastEventId) !== undefined
                ? { after_sequence: Number(afterSequence ?? lastEventId) }
                : {}),
            },
            { expectedDesignAppKind: kind },
          )) {
            subscriber.next({
              data: JSON.stringify(chunk),
              type: 'ai-chunk',
              ...(chunk.replay ? { id: String(chunk.replay.sequence) } : {}),
            } as MessageEvent);

            // Si Vex aplicó o descartó un parche exitoso, emitimos el borrador
            // validado y el resumen legible para refrescar el panel y la vista previa.
            if (
              storeId &&
              chunk.type === 'tool_result' &&
              !chunk.tool?.failed &&
              (chunk.tool?.name === 'vex_design_patch' ||
                chunk.tool?.name === 'vex_design_discard')
            ) {
              const latest = await this.design.getLatestState(
                storeId,
                conversationId,
                kind,
              );
              if (latest) {
                const isDiscard = chunk.tool.name === 'vex_design_discard';
                const touchedBlockId = isDiscard
                  ? (latest.last_discarded?.touched_block_id ?? null)
                  : latest.latest_change?.last_patch_touched_block_id !==
                      undefined
                    ? latest.latest_change.last_patch_touched_block_id
                    : (latest.latest_change?.touched_block_id ?? null);
                const summary = isDiscard
                  ? latest.last_discarded?.summary
                    ? `Descartado: ${latest.last_discarded.summary}`
                    : 'Último cambio descartado'
                  : (latest.latest_change?.last_patch_summary ??
                    latest.latest_change?.summary ??
                    'Borrador actualizado');

                subscriber.next({
                  data: JSON.stringify({
                    type: 'design_draft',
                    app_kind: latest.app_kind,
                    op: isDiscard
                      ? 'discard'
                      : (latest.latest_change?.op ?? 'patch'),
                    document: latest.document,
                    summary,
                    touched_block_id: touchedBlockId,
                    history_depth: latest.history_depth,
                    can_discard: latest.can_discard,
                  }),
                  type: 'ai-chunk',
                } as MessageEvent);
              }
            }

            if (chunk.type === 'done' || chunk.type === 'error') {
              subscriber.complete();
            }
          }
          subscriber.complete();
        } catch (error: any) {
          subscriber.next({
            data: JSON.stringify({
              type: 'error',
              error: error?.message ?? 'Error en el stream de diseño.',
            }),
            type: 'ai-chunk',
          } as MessageEvent);
          subscriber.complete();
        }
      };

      if (requestContext) {
        RequestContextService.run(requestContext, run);
      } else {
        void run();
      }

      return () => {
        clearInterval(heartbeat);
        abort.abort();
      };
    });
  }

  /** Consulta el borrador actual y profundidad de historial de la conversación. */
  @Permissions('store:apps:manage')
  @Get(':kind/conversations/:conversationId/draft')
  async getDraft(
    @Param('kind') rawKind: string,
    @Param('conversationId', ParseIntPipe) conversationId: number,
  ) {
    const kind = this.requireDesignKind(rawKind);
    const { storeId } = this.requireActor();
    await this.chatService.getConversation(conversationId);

    const state = await this.design.getLatestState(
      storeId,
      conversationId,
      kind,
    );
    if (!state) {
      throw new BadRequestException(
        'No existe un borrador activo para esta conversación.',
      );
    }
    return this.responseService.success(state);
  }

  /** Descarta el último cambio de la pila del borrador (undo de un paso). */
  @Permissions('store:apps:manage')
  @Post(':kind/conversations/:conversationId/discard')
  async discardLast(
    @Param('kind') rawKind: string,
    @Param('conversationId', ParseIntPipe) conversationId: number,
  ) {
    const kind = this.requireDesignKind(rawKind);
    const { storeId } = this.requireActor();
    await this.chatService.getConversation(conversationId);

    const result = await this.design.discardLast(storeId, conversationId, kind);
    if (!result.ok) {
      throw new BadRequestException(result.error);
    }
    return this.responseService.success(result, 'Cambio descartado');
  }

  /** Revierte el borrador al documento previo al inicio de la conversación. */
  @Permissions('store:apps:manage')
  @Post(':kind/conversations/:conversationId/reset')
  async resetConversation(
    @Param('kind') rawKind: string,
    @Param('conversationId', ParseIntPipe) conversationId: number,
  ) {
    const kind = this.requireDesignKind(rawKind);
    const { storeId } = this.requireActor();
    await this.chatService.getConversation(conversationId);

    const result = await this.design.resetToInitial(
      storeId,
      conversationId,
      kind,
    );
    if (!result.ok) {
      throw new BadRequestException(result.error);
    }
    return this.responseService.success(
      result,
      'Borrador restaurado al estado previo a la conversación',
    );
  }

  private requireDesignKind(rawKind: string): DesignChatAppKind {
    if (!isDesignChatAppKind(rawKind)) {
      throw new BadRequestException(
        `La app "${rawKind}" no admite el chat de diseño con Vex. Apps permitidas: ${DESIGN_CHAT_APP_KINDS.join(', ')}.`,
      );
    }
    return rawKind;
  }

  private requireActor(): { storeId: number; userId: number } {
    const context = RequestContextService.getContext();
    if (!context?.store_id || !context?.user_id) {
      throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);
    }
    return { storeId: context.store_id, userId: context.user_id };
  }
}
