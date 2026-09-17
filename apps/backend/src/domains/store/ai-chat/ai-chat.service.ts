import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AILoggingService } from '../../../ai-engine/ai-logging.service';
import { AIAgentService } from '../../../ai-engine/ai-agent.service';
import { RAGService } from '../../../ai-engine/embeddings/rag.service';
import { VexiContextService } from '../vexi/vexi-context.service';
import { VexiStreamIntentService } from '../vexi/vexi-stream-intent.service';
import { VexiUiChannelService } from '../vexi/vexi-ui-channel.service';
import { VexiSpeechService } from '../vexi/vexi-speech.service';
import { SPEECH_REGISTER_BLOCK } from '../vexi/vexi-speech.constants';
import type {
  VexiSpeechTurn,
  VexiVoiceFrame,
} from '../vexi/vexi-speech.pipeline';
import { RequestContextService } from '@common/context/request-context.service';
import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  AIMessage,
  AIStreamChunk,
} from '../../../ai-engine/interfaces/ai-provider.interface';
import {
  CreateConversationDto,
  SendMessageDto,
  ConversationQueryDto,
  StreamIntentDto,
} from './dto';
import {
  ConversationWithMessages,
  PaginatedConversations,
} from './interfaces/ai-chat.interface';

/**
 * The stored trace is for the human reading the transcript later, not for the
 * model — it never re-enters the context window. Enough to see what a tool
 * answered, not enough to bloat the conversation row.
 */
const PERSISTED_TOOL_RESULT_CHARS = 1000;

/**
 * Le dice al modelo que su propia propuesta sigue esperando en pantalla.
 *
 * POR QUÉ EXISTE
 * --------------
 * La aprobación viaja por `POST /store/vexi/confirmations/apply`, no por el
 * chat, así que el turno siguiente llega sin ninguna señal de que hay una
 * tarjeta abierta. Cuando la persona contesta "sí, créala" en texto —que es lo
 * natural: acaba de leer "confírmalo y lo aplico"—, el modelo ve una petición
 * de escritura sin aplicar y hace lo único razonable con la información que
 * tiene: volver a proponer. Se acuña otro token, sale otra tarjeta idéntica, y
 * desde el lado de la persona Vexi pide permiso en círculos sin ejecutar nunca.
 *
 * El bloque no debilita el consentimiento: la escritura sigue exigiendo el
 * token que prueba que ESA persona vio ESE diff. Solo evita que el modelo
 * responda a un "sí" fabricando una propuesta nueva en vez de señalar la que ya
 * está ahí.
 */
/**
 * Ventana en la que una propuesta cuenta como viva, igual al TTL del token que
 * la respalda (`VexiConfirmationService`, 300 s). Después no queda nada que
 * aprobar, así que tampoco hay nada que recordarle al modelo.
 */
const PENDING_CONFIRMATION_TTL_MS = 300_000;

const PENDING_CONFIRMATION_BLOCK = (operation: string) =>
  [
    'ESTADO DEL TURNO — tienes una propuesta de cambio SIN APLICAR.',
    `Propusiste: ${operation}.`,
    'La tarjeta con «Aprobar» y «Rechazar» ya está en pantalla, encima de este mensaje.',
    'Si la persona confirma en palabras («sí», «dale», «hazlo», «apruebo»), NO vuelvas a llamar `write_endpoint`: eso solo genera otra tarjeta idéntica y se ve como si le pidieras permiso en círculos. Contéstale en una frase que toque «Aprobar» en la tarjeta que ya tiene.',
    'Vuelve a proponer SOLO si pide cambiar algún dato, y entonces propone con los datos nuevos.',
  ].join(' ');

/**
 * What the chat SSE turn can emit.
 *
 * The voice frames are a union on top of `AIStreamChunk` rather than new members
 * of it: no provider ever produces audio, and widening the provider interface
 * would make every implementation carry a case it cannot reach. The SSE
 * controller only serializes what it is handed, so the transport needs no change.
 */
export type ChatStreamFrame = AIStreamChunk | VexiVoiceFrame;

/**
 * Fila de `ai_agents` tal como la consume el turno (F4).
 *
 * Sin agente (`null`) el turno sigue el camino exacto de hoy: `app_key` de la
 * conversación o `'chat_assistant'`, rama por `metadata.agent_enabled` de la
 * app. La fila `vexi` del seed replica ese default, no lo sustituye.
 */
interface ResolvedChatAgent {
  key: string;
  app_key: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  max_iterations: number | null;
}

@Injectable()
export class AIChatService {
  private readonly logger = new Logger(AIChatService.name);
  private readonly MAX_CONTEXT_MESSAGES = 20;

  constructor(
    private readonly prisma: StorePrismaService,
    // Global y no scoped: `ai_agents` es catálogo del sistema, sin
    // `store_id`; el scoping por tienda lo sigue aplicando `prisma`
    // (StorePrismaService) en conversaciones y mensajes. `PrismaModule` ya
    // está importado en `AIChatModule`, así que no hay cambio de módulo.
    private readonly globalPrisma: GlobalPrismaService,
    private readonly aiEngine: AIEngineService,
    private readonly aiLogging: AILoggingService,
    private readonly aiAgent: AIAgentService,
    private readonly ragService: RAGService,
    private readonly eventEmitter: EventEmitter2,
    private readonly vexiContext: VexiContextService,
    private readonly streamIntents: VexiStreamIntentService,
    private readonly uiChannel: VexiUiChannelService,
    private readonly speech: VexiSpeechService,
  ) {}

  async createConversation(dto: CreateConversationDto) {
    const context = RequestContextService.getContext();

    // `StorePrismaService` injects `store_id` on create, but not
    // `organization_id` / `user_id` — and both are required columns with no
    // default, so they have to be supplied here or Prisma rejects the insert.
    // `user_id` is also the ownership filter in `getConversation`, so a
    // placeholder value would create a row nobody can ever read back.
    if (!context?.organization_id || !context?.user_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    // F4: el agente se fija acá y viaja en `metadata` (columna nueva evitada
    // a propósito). Falla rápido ante un typo: una conversación atada a un
    // agente inexistente contestaría como Vexi sin avisar.
    // Excepción Nest plana (no `ErrorCodes`): el catálogo de errores está
    // fuera del scope F4 y no tiene código de agente.
    if (dto.agent_key) {
      const agent = await this.globalPrisma.ai_agents.findUnique({
        where: { key: dto.agent_key },
      });
      if (!agent || !agent.is_active) {
        throw new BadRequestException(
          `AI agent '${dto.agent_key}' does not exist or is inactive`,
        );
      }
    }

    const conversation = await this.prisma.ai_conversations.create({
      data: {
        organization_id: context.organization_id,
        user_id: context.user_id,
        title: dto.title || null,
        app_key: dto.app_key || null,
        status: 'active',
        ...(dto.agent_key && {
          metadata: { agent_key: dto.agent_key },
        }),
      },
    });

    this.eventEmitter.emit('ai.conversation.created', {
      conversation_id: conversation.id,
      store_id: context?.store_id,
      user_id: context?.user_id,
    });

    return conversation;
  }

  async getConversation(id: number): Promise<ConversationWithMessages> {
    const context = RequestContextService.getContext();

    const conversation = await this.prisma.ai_conversations.findFirst({
      where: {
        id,
        user_id: context?.user_id,
      },
      include: {
        messages: {
          orderBy: { created_at: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }

    return conversation as ConversationWithMessages;
  }

  async listConversations(
    query: ConversationQueryDto,
  ): Promise<PaginatedConversations> {
    const context = RequestContextService.getContext();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      user_id: context?.user_id,
    };

    if (query.status) {
      where.status = query.status;
    } else {
      where.status = { not: 'deleted' };
    }

    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.ai_conversations.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        skip,
        take: limit,
        include: {
          messages: {
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.ai_conversations.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async sendMessage(conversationId: number, dto: SendMessageDto) {
    const conversation = await this.getConversation(conversationId);

    if (conversation.status === 'archived') {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_002);
    }

    // Save user message
    await this.prisma.ai_messages.create({
      data: {
        conversation_id: conversationId,
        role: 'user',
        content: dto.content,
      },
    });

    // Build context window
    const contextMessages = this.buildContextWindow(conversation, dto.content);

    // F4: el override por mensaje gana sobre el agente de la conversación.
    const chatAgent = await this.resolveChatAgent(
      dto.agent_key ?? this.conversationAgentKey(conversation),
    );

    // Call AI Engine
    const appKey =
      chatAgent?.app_key || conversation.app_key || 'chat_assistant';

    // Check if agent mode is enabled for this app
    const app = await this.aiEngine.getApplication(appKey).catch(() => null);
    const agentEnabled =
      chatAgent !== null ||
      (app?.metadata && (app.metadata as any).agent_enabled === true);

    let responseContent = '';
    let tokensUsed = 0;

    if (agentEnabled) {
      // Use Agent Loop with tools.
      //
      // `system_prompt` is deliberately NOT forwarded: with `app_key` set the
      // engine reads it from the database and interpolates it with the store
      // snapshot. Passing the raw string here would send an uninterpolated
      // duplicate and every `{{placeholder}}` would reach the model verbatim.
      // (Con agente y sin app enlazada —ni en la fila ni en la conversación—,
      // `resolveAgentLoopArgs` omite `app_key` y el prompt propio sí viaja.)
      const agentResult = await this.aiAgent.runAgent({
        goal: dto.content,
        ...this.resolveAgentLoopArgs(chatAgent, conversation),
        messages: this.buildContextWindow(conversation),
        variables: await this.vexiContext.buildSnapshot(),
      });
      responseContent = agentResult.content;
      tokensUsed = agentResult.total_tokens;
    } else {
      // Check if RAG is enabled
      const ragEnabled =
        app?.metadata && (app.metadata as any).rag_enabled === true;

      if (ragEnabled) {
        const ragResponse = await this.ragService.queryWithContext({
          query: dto.content,
          system_prompt: app?.system_prompt || undefined,
          app_key: appKey,
        });
        responseContent = ragResponse.content || '';
        tokensUsed = ragResponse.usage
          ? ragResponse.usage.promptTokens + ragResponse.usage.completionTokens
          : 0;
      } else {
        // Direct AI call
        const response = await this.aiEngine.run(
          appKey,
          undefined,
          contextMessages,
        );
        responseContent = response.content || '';
        tokensUsed = response.usage
          ? response.usage.promptTokens + response.usage.completionTokens
          : 0;
      }
    }

    // Save assistant response
    const assistantMessage = await this.prisma.ai_messages.create({
      data: {
        conversation_id: conversationId,
        role: 'assistant',
        content: responseContent,
        tokens_used: tokensUsed,
        cost_usd: 0,
      },
    });

    // Update conversation timestamp
    await this.prisma.ai_conversations.update({
      where: { id: conversationId },
      data: { updated_at: new Date() },
    });

    // Auto-generate title if first message
    if (conversation.messages.length === 0 && !conversation.title) {
      const autoTitle = dto.content.substring(0, 80);
      await this.prisma.ai_conversations.update({
        where: { id: conversationId },
        data: { title: autoTitle },
      });
    }

    this.eventEmitter.emit('ai.message.sent', {
      conversation_id: conversationId,
      store_id: conversation.store_id,
      user_id: conversation.user_id,
    });

    return {
      user_message: { role: 'user', content: dto.content },
      assistant_message: {
        id: assistantMessage.id,
        role: 'assistant',
        content: responseContent,
        tokens_used: assistantMessage.tokens_used,
      },
    };
  }

  /**
   * Stashes the turn (message + UI context) and returns the id the browser
   * puts in the EventSource URL. Validates the conversation up front so a bad
   * id fails here, on a normal HTTP call with a normal error body, instead of
   * inside an SSE stream the client has to parse.
   */
  async createStreamIntent(
    conversationId: number,
    dto: StreamIntentDto,
  ): Promise<string> {
    const conversation = await this.getConversation(conversationId);

    if (conversation.status === 'archived') {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_002);
    }

    return this.streamIntents.create({
      conversation_id: conversationId,
      content: dto.content,
      ui_context: dto.ui_context,
      attachment_ids: dto.attachment_ids,
      speak: dto.speak,
      skip_user_message: dto.skip_user_message,
      user_id: RequestContextService.getContext()?.user_id,
    });
  }

  /**
   * Requires an active request context. The SSE controller re-enters it with
   * `RequestContextService.run()` before subscribing, because Nest's `@Sse()`
   * Observable body runs after the handler returned and the interceptor's
   * AsyncLocalStorage scope has already been torn down.
   *
   * `signal` is aborted when the client disconnects. It stops the synthesis queue
   * from spending on a turn nobody is listening to; it deliberately does **not**
   * interrupt the generator, because leaving the loop early would skip the writes
   * that persist the assistant reply and its tool trace.
   */
  async *sendMessageStream(
    conversationId: number,
    streamId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamFrame> {
    // Every timing mark is relative to this. Taken before the first await so it
    // includes the intent lookup the browser is already waiting through.
    const streamStartedAt = Date.now();
    const userId = RequestContextService.getContext()?.user_id;
    const intent = await this.streamIntents.consume(streamId, userId);

    if (!intent || intent.conversation_id !== conversationId) {
      yield {
        type: 'error',
        error:
          'La sesión de chat expiró o ya se consumió. Vuelve a enviar el mensaje.',
      };
      return;
    }

    const conversation = await this.getConversation(conversationId);

    if (conversation.status === 'archived') {
      yield { type: 'error', error: 'Conversation is archived' };
      return;
    }

    // Opened — and the filler emitted — before the turn is persisted, because
    // this is the frame the person is waiting on. The writes below cost a few
    // milliseconds each, but they are milliseconds spent in the only window
    // where the user is hearing nothing at all.
    let voice: VexiSpeechTurn | null = null;
    if (intent.speak) {
      voice = await this.speech.openTurn(streamStartedAt);
      const turn = voice;
      if (signal?.aborted) {
        turn.abort();
      } else {
        signal?.addEventListener('abort', () => turn.abort(), { once: true });
      }

      // `previous` es lo que hacía falta para que la rotación existiera de
      // verdad: sin él `pickFiller` recibía undefined, resolvía el índice
      // anterior en -1 y devolvía SIEMPRE la primera frase del banco. Las otras
      // trece estaban escritas, sintetizadas y pinneadas en caché, y ninguna se
      // oía nunca.
      const previousFiller = this.speech.lastFiller(conversationId);
      const filler = await voice.filler(previousFiller);
      if (filler) {
        // Se recuerda al emitirla, no al cerrar el turno. Un turno cuyo
        // transporte se cae no llega al cierre, y ese es precisamente el caso en
        // que el reintento no debe repetir la misma muletilla que la persona ya
        // escuchó hace dos segundos.
        this.speech.rememberFiller(conversationId, voice.usedFiller());
        yield filler;
      }
    }

    // Save user message.
    //
    // Skipped when the client is replaying a turn whose transport dropped: the
    // row was written by the attempt that died, and this write happens BEFORE the
    // model is called, so a dropped turn almost always left it behind. Writing it
    // again would show the person's question twice in a conversation they only
    // asked once — the one visible artefact a transparent retry must not leave.
    //
    // Trusting the client on this is safe because the flag can only ever cause a
    // *missing* user row, never a forged one: the content it would have written is
    // the client's own `content` either way.
    if (!intent.skip_user_message) {
      await this.prisma.ai_messages.create({
        data: {
          conversation_id: conversationId,
          role: 'user',
          content: intent.content,
        },
      });
    }

    // Claims this stream id as the only channel allowed to answer this turn's UI
    // commands. Without it a leaked `stream_id` would let any authenticated user
    // feed fabricated screen results into somebody else's agent loop, and the
    // model treats those results as ground truth.
    await this.uiChannel.registerTurn(streamId, userId);

    // F4: en SSE no hay DTO por mensaje (el intent solo trae `content`), así
    // que el agente sale de `metadata.agent_key` de la conversación.
    const chatAgent = await this.resolveChatAgent(
      this.conversationAgentKey(conversation),
    );

    const appKey =
      chatAgent?.app_key || conversation.app_key || 'chat_assistant';

    const app = await this.aiEngine.getApplication(appKey).catch(() => null);
    const agentEnabled =
      chatAgent !== null ||
      (app?.metadata && (app.metadata as any).agent_enabled === true);

    let fullContent = '';
    let totalTokens = 0;
    let toolsUsed: Array<{ name: string; args: any; result: string }> = [];
    /**
     * La ruta que quedó propuesta y sin aplicar, para marcarla en el mensaje
     * que se persiste. El turno siguiente la lee con `findPendingProposal` y
     * así sabe que la tarjeta sigue abierta: la aprobación viaja por otro
     * endpoint y no deja rastro en la conversación hasta que se aplica.
     */
    let pendingProposal: string | null = null;
    // Held back until after the audio and timing frames. Both the SSE controller
    // and the browser close the connection the moment `done` arrives, so anything
    // emitted after it is never seen. See the agent branch below for the original
    // reason this hold-back exists (the confirmation token) — speaking adds a
    // second set of frames with the same constraint.
    let doneChunk: AIStreamChunk | null = null;

    if (agentEnabled) {
      // The stream used to call `runStream()` with no tools regardless of
      // `agent_enabled`, so simply opening the SSE connection turned the agent
      // off — the same question answered with data over POST and with a shrug
      // over SSE. It now runs the identical loop, narrating each tool call.
      const agentStream = this.aiAgent.runAgentStream({
        goal: intent.content,
        ...this.resolveAgentLoopArgs(chatAgent, conversation),
        // El mismo flag que enciende la síntesis enciende el registro hablado.
        // Derivarlo del intent y no de un ajuste de tienda es lo que mantiene los
        // dos en fase: si se dicta, se responde para ser oído — y si el mismo
        // hilo sigue por escrito en el turno siguiente, vuelve a prosa sola.
        messages: this.buildContextWindow(conversation, undefined, intent.speak),
        variables: await this.vexiContext.buildSnapshot({
          uiContext: intent.ui_context,
          attachmentIds: intent.attachment_ids,
        }),
        // What lets the loop wait for the browser instead of assuming its UI
        // commands worked. Only the chat surface passes it, because it is the only
        // one with an open SSE channel to a page that can answer.
        stream_id: streamId,
      });

      let step = await agentStream.next();
      // `done` is held back instead of forwarded in place. The agent's last
      // act is the loop's `done`, but the pending-confirmation frame is only
      // known once the generator returns — and both the SSE controller and the
      // browser close the connection the moment `done` arrives. Emitted in
      // order, `done` would take the confirmation token out with it and the
      // approval card would never render.
      while (!step.done) {
        const chunk = step.value;
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
          // Segments are cut and queued here; nothing is awaited. The `await`
          // on the next agent step below is what lets those jobs make progress.
          voice?.push(chunk.content);
        }
        if (chunk.type === 'done') {
          if (chunk.usage) {
            totalTokens = chunk.usage.totalTokens;
          }
          doneChunk = chunk;
          step = await agentStream.next();
          continue;
        }
        yield chunk;
        // Whatever finished synthesizing while the model was producing this
        // chunk. Non-blocking on purpose: a caption must never wait on audio.
        if (voice) for (const frame of voice.drain()) yield frame;
        step = await agentStream.next();
      }

      const result = step.value;
      // The generator's return value carries what the yields could not: the
      // full tool trace and, when the agent proposed a write, the token that
      // has to survive to the approval round trip.
      toolsUsed = result.tools_used;
      if (!fullContent) {
        // A turn can end without a single text chunk — the model spends its
        // last iteration on a tool that fails and then says nothing. The user
        // is left staring at an empty bubble with no idea whether Vexi is
        // still thinking. Whatever the agent returned goes out as text, and if
        // even that is empty the silence is named rather than shipped.
        fullContent =
          result.content?.trim() ||
          'No logré completar eso. Vuelve a pedírmelo con otras palabras, o dime el nombre exacto del registro sobre el que quieres que trabaje.';
        yield { type: 'text', content: fullContent };
        // Spoken too, fallback included. A turn that only ran tools already got
        // its human filler at the top; leaving the failure text unspoken as well
        // would hand the listener a "dame un segundo" and then silence.
        voice?.push(fullContent);
      }
      if (result.pending_confirmation) {
        const args = (result.pending_confirmation.arguments ?? {}) as Record<
          string,
          any
        >;
        pendingProposal =
          [args.method, args.path].filter(Boolean).join(' ') ||
          result.pending_confirmation.tool;
        yield {
          type: 'tool_result',
          tool: {
            id: result.pending_confirmation.confirmation_token,
            name: result.pending_confirmation.tool,
            summary: JSON.stringify({
              requires_confirmation: true,
              confirmation_token:
                result.pending_confirmation.confirmation_token,
              arguments: result.pending_confirmation.arguments,
              preview: result.pending_confirmation.preview,
            }),
          },
        };
      }
    } else {
      // La rama sin agente también dicta, así que también necesita el registro:
      // una tienda con `agent_enabled` en false igual habla, y sin esto sería la
      // única superficie que contesta con listas y asteriscos en voz alta.
      const contextMessages = this.buildContextWindow(
        conversation,
        intent.content,
        intent.speak,
      );

      for await (const chunk of this.aiEngine.runStream(
        appKey,
        undefined,
        contextMessages,
      )) {
        if (chunk.type === 'text' && chunk.content) {
          fullContent += chunk.content;
          voice?.push(chunk.content);
        }
        if (chunk.type === 'done') {
          if (chunk.usage) {
            totalTokens = chunk.usage.totalTokens;
          }
          // Held back for the same reason as the agent branch: the audio and
          // timing frames have to precede the frame that closes the connection.
          doneChunk = chunk;
          continue;
        }
        yield chunk;
        if (voice) for (const frame of voice.drain()) yield frame;
      }
    }

    if (voice) {
      // The answer is complete, so the tail can be cut even without a closing
      // period, and there is nothing left to overlap with — this is the one place
      // where waiting on the remaining audio is correct.
      voice.flush();
      await voice.settle();
      for (const frame of voice.drain()) yield frame;
      // Emitted last so the client can attach them to a turn it has fully
      // received. They are diagnostics, not content: nothing renders from them.
      for (const frame of voice.timings()) yield frame;
    }

    if (doneChunk) {
      yield doneChunk;
    }

    // Save assistant response after stream completes
    if (fullContent) {
      await this.prisma.ai_messages.create({
        data: {
          conversation_id: conversationId,
          role: 'assistant',
          content: fullContent,
          tokens_used: totalTokens,
          // The agent already computed this and it was being thrown away, so
          // a reopened conversation lost every trace of what Vexi actually
          // did — the transcript said "ajusté el stock" with nothing behind it.
          tool_calls: toolsUsed.length
            ? (toolsUsed.map((tool) => ({
                name: tool.name,
                arguments: tool.args,
                result: tool.result.slice(0, PERSISTED_TOOL_RESULT_CHARS),
              })) as Prisma.InputJsonValue)
            : undefined,
          // La propuesta no entra en `tool_calls`: la rama de confirmación del
          // bucle sale por `continue` sin registrarla como herramienta usada.
          // Sin esta marca, el turno siguiente no tiene forma de saber que hay
          // una tarjeta esperando, y contestar "sí" en texto acuñaba otra
          // propuesta idéntica en vez de señalar la que ya está en pantalla.
          ...(pendingProposal && {
            metadata: {
              pending_confirmation: pendingProposal,
            } as Prisma.InputJsonValue,
          }),
        },
      });

      await this.prisma.ai_conversations.update({
        where: { id: conversationId },
        data: { updated_at: new Date() },
      });
    }

    // Auto-generate title if first message
    if (conversation.messages.length === 0 && !conversation.title) {
      await this.prisma.ai_conversations.update({
        where: { id: conversationId },
        data: { title: intent.content.substring(0, 80) },
      });
    }

    this.eventEmitter.emit('ai.message.sent', {
      conversation_id: conversationId,
      store_id: conversation.store_id,
      user_id: conversation.user_id,
    });

    // Closes the UI channel for this turn so a late `POST ui-result` cannot land
    // on the next one. Not in a `finally`: an early `return` above leaves the
    // claim to expire on its own TTL, which is the safe direction — a stale claim
    // rejects results, it never accepts a wrong one.
    await this.uiChannel.releaseTurn(streamId);
  }

  async archiveConversation(id: number) {
    const context = RequestContextService.getContext();
    const conversation = await this.prisma.ai_conversations.findFirst({
      where: { id, user_id: context?.user_id },
    });

    if (!conversation) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }

    return this.prisma.ai_conversations.update({
      where: { id },
      data: { status: 'archived', updated_at: new Date() },
    });
  }

  async updateTitle(id: number, title: string) {
    const context = RequestContextService.getContext();
    const conversation = await this.prisma.ai_conversations.findFirst({
      where: { id, user_id: context?.user_id },
    });

    if (!conversation) {
      throw new VendixHttpException(ErrorCodes.AI_CHAT_001);
    }

    return this.prisma.ai_conversations.update({
      where: { id },
      data: { title, updated_at: new Date() },
    });
  }

  /**
   * `agent_key` fijado en la creación, guardado en `metadata` (F4). Se lee
   * defensivo: `metadata` es `Json?` libre y puede traer cualquier forma de
   * escrituras viejas o ediciones manuales.
   */
  private conversationAgentKey(
    conversation: ConversationWithMessages,
  ): string | null {
    const raw = (conversation.metadata as Record<string, unknown> | null)
      ?.agent_key;
    return typeof raw === 'string' && raw.trim() ? raw : null;
  }

  /**
   * Resuelve la fila de `ai_agents` para el turno, o `null` cuando no hay
   * agente (camino exacto de hoy).
   *
   * Una key desconocida o inactiva NO rompe el turno: warn + fallback. Acá la
   * resiliencia gana sobre el fallo rápido porque el turno ya existe y el
   * usuario está esperando respuesta (en `createConversation` sí se falla
   * rápido, porque ahí todavía no hay nada que romper). Un agente borrado o
   * desactivado a mitad de una conversación larga vuelve a ser Vexi en vez de
   * dejar el hilo muerto.
   */
  private async resolveChatAgent(
    agentKey: string | null,
  ): Promise<ResolvedChatAgent | null> {
    if (!agentKey) return null;
    // Defensivo ante desincronía deploy/migración (ver
    // `prisma/assert-schema-columns.js`: un deploy puede arrancar con la base
    // sin la tabla `ai_agents`): sin catálogo no hay agente, pero el turno
    // sigue contestando como hoy en vez de 500.
    let row;
    try {
      row = await this.globalPrisma.ai_agents.findUnique({
        where: { key: agentKey },
      });
    } catch (err) {
      this.logger.warn(
        `AI agent lookup failed for '${agentKey}' — falling back to default turn behavior: ${(err as Error).message}`,
      );
      return null;
    }
    if (!row || !row.is_active) {
      this.logger.warn(
        `AI agent '${agentKey}' not found or inactive — falling back to default turn behavior`,
      );
      return null;
    }
    if (row.app_key && row.system_prompt) {
      this.logger.warn(
        `AI agent '${agentKey}' defines both app_key and system_prompt — the app owns the prompt and system_prompt is ignored`,
      );
    }
    return {
      key: row.key,
      app_key: row.app_key,
      system_prompt: row.system_prompt,
      allowed_tools: row.allowed_tools ?? [],
      max_iterations: row.max_iterations,
    };
  }

  /**
   * Argumentos del loop (`runAgent` / `runAgentStream`) para el turno.
   *
   * Sin agente devuelve EXACTAMENTE lo que el turno pasaba antes
   * (`{ app_key }`), para que el fallback no derive ni un parámetro.
   * Con agente:
   * - `app_key`: el de la fila, o el de la conversación, o `'chat_assistant'`.
   * - `system_prompt` propio solo cuando NADIE enlazó app (ni fila ni
   *   conversación): con `app_key` el engine lee el prompt de la fila de la
   *   app e ignoraría este (contrato de `AIAgentService`), así que pasarlo
   *   sería prometer algo que no se cumple.
   * - `allowed_tools` no vacío como filtro adicional sobre el plan (F3); el
   *   loop lo intersecta con permisos del caller y `tools_allowed`.
   * - `max_iterations` de la fila cuando está definido.
   */
  private resolveAgentLoopArgs(
    agent: ResolvedChatAgent | null,
    conversation: ConversationWithMessages,
  ): {
    app_key?: string;
    system_prompt?: string;
    tools?: string[];
    max_iterations?: number;
  } {
    const appKey =
      agent?.app_key || conversation.app_key || 'chat_assistant';
    if (!agent) {
      return { app_key: appKey };
    }
    const tools =
      agent.allowed_tools.length > 0 ? agent.allowed_tools : undefined;
    const max_iterations = agent.max_iterations ?? undefined;
    if (!agent.app_key && !conversation.app_key && agent.system_prompt) {
      return { system_prompt: agent.system_prompt, tools, max_iterations };
    }
    return { app_key: appKey, tools, max_iterations };
  }

  /**
   * Last N turns of the conversation, oldest first.
   *
   * `newMessage` is optional because the two consumers need different shapes:
   * a plain completion wants history *plus* the new turn as one array, while
   * the agent loop appends the goal itself and would duplicate it. Omitting
   * the argument yields history alone.
   */
  private buildContextWindow(
    conversation: ConversationWithMessages,
    newMessage?: string,
    /**
     * Este turno se va a dictar, así que la respuesta se escribe para ser oída.
     */
    speak?: boolean,
  ): AIMessage[] {
    const messages: AIMessage[] = [];

    // Como mensaje de sistema del turno y NO como un {{placeholder}} en el
    // `system_prompt` almacenado, que era la otra opción.
    //
    // Ese prompt lo edita un operador desde Super Admin, así que un placeholder
    // ahí es un mecanismo que cualquiera puede borrar sin saber que existía —
    // y la migración que lo insertara pisaría ediciones que ya están en
    // producción. Acá el bloque no depende de ninguna fila: viaja con el turno
    // o no viaja.
    //
    // Primero en la ventana para que quede pegado al prompt de sistema
    // interpolado y se lea como su continuación. Va delante del historial a
    // propósito: el registro gobierna cómo se responde, no de qué se habla.
    if (speak) {
      messages.push({ role: 'system', content: SPEECH_REGISTER_BLOCK });
    }

    // Add recent messages from history (last N)
    const recentMessages = conversation.messages.slice(
      -this.MAX_CONTEXT_MESSAGES,
    );

    for (const msg of recentMessages) {
      if (
        msg.role === 'system' ||
        msg.role === 'user' ||
        msg.role === 'assistant'
      ) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Pegado al turno nuevo, no al principio de la ventana: lo que gobierna es
    // cómo se responde a ESTE mensaje, y la señal se pierde veinte mensajes
    // atrás si viaja con el historial.
    const pending = this.findPendingProposal(conversation.messages);
    if (pending) {
      messages.push({
        role: 'system',
        content: PENDING_CONFIRMATION_BLOCK(pending),
      });
    }

    if (newMessage !== undefined) {
      messages.push({ role: 'user', content: newMessage });
    }

    return messages;
  }

  /**
   * La última propuesta de escritura que quedó sin aplicar, descrita en una
   * frase, o `null` si no hay ninguna esperando.
   *
   * Se recorre hacia atrás y se corta en la primera evidencia, en este orden:
   *
   *  - Una fila `tool` — la que escribe `VexiActivityService.recordApplied`
   *    cuando el cambio aterriza ⇒ la propuesta anterior YA se aplicó y no hay
   *    nada pendiente. Ésta es la razón de recorrer al revés en lugar de buscar
   *    la última propuesta y preguntar después: la respuesta está en cuál de
   *    las dos filas es más reciente.
   *  - Un `assistant` marcado con `metadata.pending_confirmation` ⇒ hay una
   *    tarjeta abierta.
   *
   * La marca vive en `metadata` y no en `tool_calls` porque el bucle NUNCA
   * registra la propuesta como herramienta usada: la rama de confirmación
   * empuja el resultado a la conversación del modelo y sale por `continue` sin
   * tocar `toolsUsed`. Buscarla ahí no encontraba nada nunca.
   */
  private findPendingProposal(
    messages: ConversationWithMessages['messages'],
  ): string | null {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];

      if (message.role === 'tool') return null;
      if (message.role !== 'assistant') continue;

      // Solo el ÚLTIMO assistant decide. Seguir hacia atrás resucitaría una
      // propuesta vieja que la conversación ya dejó atrás.
      const pending = (message.metadata as any)?.pending_confirmation;
      if (!pending) return null;

      // El token que respalda la tarjeta vive 5 minutos en Redis
      // (`VexiConfirmationService.TOKEN_TTL_SECONDS`). Pasado ese punto no hay
      // nada que aprobar aunque la tarjeta siga dibujada, y sin este corte una
      // propuesta rechazada —el "Rechazar" no escribe fila ninguna— dejaría al
      // modelo mandando a tocar un botón muerto para siempre.
      const age = Date.now() - new Date(message.created_at).getTime();
      if (!Number.isFinite(age) || age > PENDING_CONFIRMATION_TTL_MS) {
        return null;
      }

      return typeof pending === 'string' && pending.trim()
        ? pending
        : 'un cambio';
    }

    return null;
  }
}
