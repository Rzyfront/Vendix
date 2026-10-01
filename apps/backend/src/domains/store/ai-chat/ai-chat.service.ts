import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AILoggingService } from '../../../ai-engine/ai-logging.service';
import { AIAgentService } from '../../../ai-engine/ai-agent.service';
import type {
  AgentBlockSink,
  AgentPlanApprovalHook,
} from '../../../ai-engine/ai-agent.service';
import { RAGService } from '../../../ai-engine/embeddings/rag.service';
import { VexiContextService } from '../vexi/vexi-context.service';
import { VexiStreamIntentService } from '../vexi/vexi-stream-intent.service';
import { VexiUiChannelService } from '../vexi/vexi-ui-channel.service';
import {
  VexiPlanStateService,
  renderPlanForModel,
} from '../vexi/vexi-plan-state.service';
import type { AgentPlan } from '../../../ai-engine/interfaces/agent-plan.interface';
import { VexiSpeechService } from '../vexi/vexi-speech.service';
import { SPEECH_REGISTER_BLOCK } from '../vexi/vexi-speech.constants';
import type {
  VexiSpeechTurn,
  VexiVoiceFrame,
} from '../vexi/vexi-speech.pipeline';
import { RequestContextService } from '@common/context/request-context.service';
import { UserRole } from '../../auth/enums/user-role.enum';
import { SubscriptionAccessService } from '../subscriptions/services/subscription-access.service';
import { SubscriptionGateConfig } from '../subscriptions/config/subscription-gate.config';
import { VexBlockService } from '../vex/services/vex-block.service';
import { PlanApprovalService } from '../vex/services/plan-approval.service';
import { VexiConfirmationService } from '../vexi/vexi-confirmation.service';
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
 * Objetivos internos de un turno de continuación. Los compone el servidor: la
 * persona no escribió nada, y el cliente no decide qué se le dice al modelo.
 */
const CONTINUATION_GOALS = {
  approved:
    '(interno) La persona aprobó el cambio propuesto y ya quedó aplicado. Continúa con lo que sigue sin avisarle que retomas.',
  rejected:
    '(interno) La persona rechazó el cambio propuesto; no se aplicó. Decide si lo demás sigue teniendo sentido: si sí, continúa; si no, pregúntale con naturalidad.',
  resume: '(interno) Continúa donde ibas.',
} as const;

/** Cómo tratar un mensaje normal de la persona mientras hay un plan activo. */
const PLAN_MESSAGE_RULES_BLOCK =
  '(interno) Hay un plan activo. Clasifica el mensaje de la persona: si responde a tu pregunta, retoma el plan; si cambia la tarea, usa revise_plan y sigue; si es una consulta sin relación, respóndela y sigue con el plan en el mismo turno; si es una tarea sin relación con cambios, usa pause_plan, atiéndela y al final pregunta si retomas.';

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
 * Sin agente (`null`) el turno sigue el camino anterior: `app_key` de la
 * conversación o `'chat_assistant'`, rama por `metadata.agent_enabled` de la
 * app. La fila activa `vexi` configura los turnos del chat por defecto.
 */
interface ResolvedChatAgent {
  key: string;
  app_key: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  denied_tools: string[];
  max_iterations: number | null;
}

/**
 * `key` de Vex en `ai_agents`. El único agente del chat con gate propio:
 * los turnos que resuelven a esta key (hilo fijado u override por mensaje)
 * exigen rol owner/admin + `settings.vex.enabled` + feature `vex_agent` del
 * plan (ver `assertVexTurnAccess`). Cualquier otra key —incluido `vexi`—
 * sigue el camino exacto de hoy.
 */
const VEX_AGENT_KEY = 'vex';

/**
 * Puntero que el mensaje del agente guarda por cada bloque del turno: lo
 * justo para rehidratar (`GET blocks/:id` trae los datos firmados en
 * lectura). Nunca el payload — un bloque vive en `ai_ui_blocks`, no copiado
 * en el transcript.
 */
interface VexBlockRef {
  block_id: string;
  kind: string;
  version: number;
}

/** Estados que `metadata.plan.status` puede tomar en un hilo de Vex. */
const VEX_PLAN_STATUSES = ['proposed', 'approved', 'rejected', 'applied'] as const;
type VexPlanStatus = (typeof VEX_PLAN_STATUSES)[number];

/**
 * Lo que un turno Vex produjo y el cierre del turno persiste. Se llena por
 * tres caminos que se fusionan al final: el sink envuelve cada `save` de
 * compactación, el stream captura los frames `ui_block`/`plan_approval`, y
 * el cierre barre los bloques huérfanos (`message_id` NULL) más los
 * envelopes de render en `tools_used` — así el camino sync, que no ve
 * frames, persiste lo mismo que el SSE.
 */
interface VexTurnCollection {
  blocks: Map<string, VexBlockRef>;
  plan: { plan_id: string; steps: unknown[] } | null;
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
    private readonly planState: VexiPlanStateService,
    // Gate de plan de los turnos de Vex. Opcionales y al final para no romper
    // las construcciones posicionales existentes: en producción resuelven
    // desde `SubscriptionsModule` (`@Global()`); un turno de Vex sin ellos
    // falla cerrado en `assertVexTurnAccess` en vez de colgar.
    @Optional() private readonly subscriptionAccess?: SubscriptionAccessService,
    @Optional() private readonly gateConfig?: SubscriptionGateConfig,
    // Block selections as turn context (Vex only). Optional-trailing like
    // the gate above: same positional-construction rule, and a Vex turn
    // without it simply sees no selection instead of failing.
    @Optional() private readonly vexBlocks?: VexBlockService,
    // Whole-plan approval hook + block sink (Vex only). Optional-trailing for
    // the same rule: in production they resolve (`VexModule` exports the
    // approval service; the confirmations live in the global `AIEngineModule`
    // next to the plan state already injected above). A Vex turn without them
    // still runs — the loop accumulates and classifies locally — but its plan
    // cannot persist hashes, so approve will ask to re-propose.
    @Optional() private readonly planApproval?: PlanApprovalService,
    @Optional() private readonly confirmations?: VexiConfirmationService,
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

    // Un hilo de Vex nace gated: crearlo ya exige el triple
    // (rol + toggle + plan), no solo hablar en él.
    await this.assertVexTurnAccess(dto.agent_key ?? null);

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

    // Separación de hilos por agente (`metadata.agent_key`, paso 4):
    // - `vex` → solo Vex.
    // - `vexi` → Vexi más los legacy, cuyo `metadata` es NULL (hilos creados
    //   antes de F4, cuando nada escribía la columna).
    // - otra key → solo esa.
    // - ausente → todo menos Vex, para que el dock de Vexi nunca liste un
    //   hilo que no puede abrir. El `NOT` sobre JSON no matchea filas con
    //   `metadata` NULL (`NOT NULL` es NULL), así que el NULL va en su propia
    //   rama del OR: sin ella los hilos legacy desaparecerían del listado.
    if (query.agent_key === VEX_AGENT_KEY) {
      where.metadata = { path: ['agent_key'], equals: VEX_AGENT_KEY };
    } else if (query.agent_key === 'vexi') {
      where.OR = [
        { metadata: { path: ['agent_key'], equals: 'vexi' } },
        { metadata: { equals: Prisma.AnyNull } },
      ];
    } else if (query.agent_key) {
      where.metadata = { path: ['agent_key'], equals: query.agent_key };
    } else {
      where.OR = [
        { metadata: { equals: Prisma.AnyNull } },
        { NOT: { metadata: { path: ['agent_key'], equals: VEX_AGENT_KEY } } },
      ];
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

    // El override por mensaje y el agente fijado en el hilo ganan sobre Vexi.
    // Se resuelve acá —antes de persistir la fila del usuario— para que un
    // turno de Vex denegado no deje una pregunta huérfana en el hilo.
    const agentKey = this.turnAgentKey(conversation, dto.agent_key);
    await this.assertVexTurnAccess(agentKey);

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

    const chatAgent = await this.resolveChatAgent(agentKey);

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
    // Solo los turnos Vex coleccionan: en cualquier otro agente es `null` y
    // el cierre persiste byte-idéntico a hoy.
    const vexTurn: VexTurnCollection | null =
      agentKey === VEX_AGENT_KEY
        ? { blocks: new Map(), plan: null }
        : null;
    let vexPlan: VexTurnCollection['plan'] = null;
    let vexToolsUsed: Array<{ name: string; args: any; result: string }> = [];

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
        goal: await this.withBlockSelection(
          dto.content,
          agentKey,
          conversationId,
        ),
        ...this.resolveAgentLoopArgs(chatAgent, conversation, vexTurn),
        messages: this.buildContextWindow(conversation),
        variables:
          agentKey === VEX_AGENT_KEY
            ? await this.buildVexVariables(conversationId)
            : await this.vexiContext.buildSnapshot(),
      });
      responseContent = agentResult.content;
      tokensUsed = agentResult.total_tokens;
      vexPlan = agentResult.pending_plan ?? null;
      vexToolsUsed = agentResult.tools_used ?? [];
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

    // Save assistant response. En turnos Vex el metadata lleva los punteros
    // a bloques y el plan propuesto, para que recargar la conversación
    // rehidrate lo mismo que el turno mostró en vivo.
    const vexBlockRefs = await this.resolveVexTurnBlocks(
      conversationId,
      vexTurn,
      vexToolsUsed,
    );
    const vexMetadata = this.vexTurnMetadata(
      vexBlockRefs,
      vexPlan ?? vexTurn?.plan ?? null,
    );
    const assistantMessage = await this.prisma.ai_messages.create({
      data: {
        conversation_id: conversationId,
        role: 'assistant',
        content: responseContent,
        tokens_used: tokensUsed,
        cost_usd: 0,
        ...(vexMetadata ? { metadata: vexMetadata } : {}),
      },
    });
    await this.attachVexTurnBlocks(vexBlockRefs, assistantMessage.id);

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

    // En SSE no hay override por mensaje: el gate decide con el agente fijado
    // en el hilo. Acá el error viaja como HTTP con su código; el stream lo
    // re-valida y lo emite como frame `error` (ver `sendMessageStream`).
    await this.assertVexTurnAccess(this.turnAgentKey(conversation));

    return this.streamIntents.create({
      conversation_id: conversationId,
      // Un turno de continuación no lleva texto de la persona.
      content: dto.continuation ? '' : (dto.content ?? ''),
      continuation: dto.continuation,
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

    // Continuación sin plan activo: no-op silencioso. Puede llegar huérfana (el
    // plan se pausó, venció o se abandonó entre la tarjeta y el clic) y no es un
    // error que la persona deba ver ni un turno que valga la pena pagar: se
    // cierra sin texto y sin persistir nada.
    //
    // Excepción Vex: sus escrituras directas (sin `propose_plan`) aplican con
    // tokens de un solo uso y nunca crean un plan en `planState`, así que el
    // turno aprobado/cancelado llegaría siempre huérfano y la tarjeta quedaría
    // muda: sin narración y sin continuar con lo que sigue (p. ej. enviar la
    // cotización recién creada). Esos turnos sí corren el loop.
    let continuationPlan: AgentPlan | null = null;
    if (intent.continuation) {
      continuationPlan = await this.planState.getActive(conversationId);
      if (
        !continuationPlan &&
        this.turnAgentKey(conversation) !== VEX_AGENT_KEY
      ) {
        yield { type: 'done' };
        return;
      }
      // `approved` NO se marca aquí: lo marca `applyConfirmation` al aplicar.
      if (intent.continuation === 'rejected') {
        await this.planState.markCurrentChangeStep(conversationId, 'rejected');
      }
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
    if (!intent.skip_user_message && !intent.continuation) {
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

    // Un turno por conversación: este desplaza al anterior, que se detiene en su
    // siguiente iteración (`shouldAbort`).
    await this.streamIntents.claimTurn(conversationId, streamId);

    // En SSE no hay override por mensaje: agente fijado en el hilo, o Vexi
    // para el chat por defecto (también en conversaciones preexistentes).
    // La key PEDIDA —no la fila resuelta— es lo que se gatea: si el agente
    // `vex` se desactiva a mitad de un hilo largo, el turno cae al fallback
    // de la app pero el hilo sigue siendo de owner/admin.
    const agentKey = this.turnAgentKey(conversation);
    try {
      await this.assertVexTurnAccess(agentKey);
    } catch (err) {
      // Dentro del generador el gate denegado es un frame `error`, no un
      // throw: el SSE ya empezó y el cliente solo entiende frames. El error
      // con código ya viajó en el POST del intent; acá solo se llega si algo
      // cambió en la ventana entre el intent y el stream.
      yield { type: 'error', error: (err as Error).message };
      return;
    }
    const chatAgent = await this.resolveChatAgent(agentKey);

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
    // Colector del turno Vex (`null` en cualquier otro agente: su cierre no
    // cambia). El sink y los frames lo llenan mientras el turno corre.
    const vexTurn: VexTurnCollection | null =
      agentKey === VEX_AGENT_KEY ? { blocks: new Map(), plan: null } : null;
    let vexPlan: VexTurnCollection['plan'] = null;
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
      const goal = await this.withBlockSelection(
        intent.continuation
          ? CONTINUATION_GOALS[intent.continuation]
          : intent.content,
        agentKey,
        conversationId,
      );
      const activePlan =
        continuationPlan ?? (await this.planState.getActive(conversationId));
      const storedPlan = activePlan
        ? null
        : await this.planState.get(conversationId);
      const agentStream = this.aiAgent.runAgentStream({
        goal,
        ...this.resolveAgentLoopArgs(chatAgent, conversation, vexTurn),
        // El mismo flag que enciende la síntesis enciende el registro hablado.
        // Derivarlo del intent y no de un ajuste de tienda es lo que mantiene los
        // dos en fase: si se dicta, se responde para ser oído — y si el mismo
        // hilo sigue por escrito en el turno siguiente, vuelve a prosa sola.
        messages: this.buildContextWindow(
          conversation,
          undefined,
          intent.speak,
          {
            active: activePlan,
            paused: storedPlan?.status === 'paused' ? storedPlan : null,
            isContinuation: !!intent.continuation,
          },
        ),
        // Vex no navega pantallas (`denied_tools` le quita las `ui_*`), así
        // que su snapshot no lleva `ui_context`: además de inútil, es
        // material no confiable compuesto en el navegador — en su lugar trae
        // `vex_blocks`, los bloques vivos de la conversación. Los adjuntos
        // sí viajan: Vex también lee documentos del turno.
        variables:
          agentKey === VEX_AGENT_KEY
            ? await this.buildVexVariables(
                conversationId,
                intent.attachment_ids,
              )
            : await this.vexiContext.buildSnapshot({
                uiContext: intent.ui_context,
                attachmentIds: intent.attachment_ids,
              }),
        // What lets the loop wait for the browser instead of assuming its UI
        // commands worked. Only the chat surface passes it, because it is the only
        // one with an open SSE channel to a page that can answer.
        stream_id: streamId,
        plan: this.planState.createHook(conversation.id),
        shouldAbort: async () =>
          !(await this.streamIntents.isCurrentTurn(conversationId, streamId)),
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
        // Lo que la persona VIO es lo que se persiste: el frame ya viaja al
        // panel y el colector guarda su referencia para el cierre del turno.
        if (vexTurn) this.collectVexFrame(vexTurn, chunk);
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
      // Recibo autoritativo del plan (el frame ya lo llevó al panel): manda
      // sobre lo capturado por frames si ambos existen.
      vexPlan = result.pending_plan ?? null;
      // `plan_continue`: el turno terminó a propósito sin texto (el cliente
      // encadena otro); `aborted`: otro turno lo reemplazó. En ambos casos el
      // silencio es correcto y el fallback sería ruido.
      if (!fullContent && !result.plan_continue && !result.aborted) {
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
        const planActive = !!(await this.planState.getActive(conversation.id));
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
              plan_active: planActive,
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
      const vexBlockRefs = await this.resolveVexTurnBlocks(
        conversationId,
        vexTurn,
        toolsUsed,
      );
      const vexMetadata = this.vexTurnMetadata(
        vexBlockRefs,
        vexPlan ?? vexTurn?.plan ?? null,
      );
      // La propuesta no entra en `tool_calls`: la rama de confirmación del
      // bucle sale por `continue` sin registrarla como herramienta usada.
      // Sin esta marca, el turno siguiente no tiene forma de saber que hay
      // una tarjeta esperando, y contestar "sí" en texto acuñaba otra
      // propuesta idéntica en vez de señalar la que ya está en pantalla.
      // Convive con los bloques/plan de Vex en el mismo objeto.
      const metadata = {
        ...(pendingProposal ? { pending_confirmation: pendingProposal } : {}),
        ...vexMetadata,
      };
      const assistantMessage = await this.prisma.ai_messages.create({
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
          ...(Object.keys(metadata).length > 0
            ? { metadata: metadata as Prisma.InputJsonValue }
            : {}),
        },
      });
      await this.attachVexTurnBlocks(vexBlockRefs, assistantMessage.id);

      await this.prisma.ai_conversations.update({
        where: { id: conversationId },
        data: { updated_at: new Date() },
      });
    }

    // Auto-generate title if first message
    if (
      conversation.messages.length === 0 &&
      !conversation.title &&
      intent.content
    ) {
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
   * Mueve el estado de la tarjeta de plan Vex (`metadata.plan.status`) en el
   * mensaje que propuso ese `plan_id`. Lo llaman aprobar / rechazar / aplicar
   * de la superficie Vex para que recargar la conversación muestre la tarjeta
   * con su estado real en vez de una propuesta eterna.
   *
   * Propiedad del hilo vía `getConversation`: solo el dueño reescribe su
   * tarjeta. `false` cuando ningún mensaje del hilo propuso ese plan — no es
   * error: el plan pudo nacer en un turno que nunca persistió mensaje.
   */
  async updateVexPlanStatus(
    conversationId: number,
    planId: string,
    status: string,
  ): Promise<boolean> {
    if (!(VEX_PLAN_STATUSES as readonly string[]).includes(status)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `status debe ser uno de: ${VEX_PLAN_STATUSES.join(', ')}.`,
      );
    }
    const conversation = await this.getConversation(conversationId);
    const message = [...conversation.messages]
      .reverse()
      .find(
        (m) =>
          m.role === 'assistant' &&
          (m.metadata as Record<string, any> | null)?.plan?.plan_id === planId,
      );
    if (!message) return false;
    const previous = (message.metadata as Record<string, any>) ?? {};
    const metadata = {
      ...previous,
      plan: { ...previous.plan, status },
    };
    // `updateMany` y no `update`: `ai_messages` es relational-scoped y la
    // extensión funde `conversation: {...}` en el `where`, lo que rompe el
    // `WhereUniqueInput` que `update` exige. Solo escalares acá: una llave
    // `conversation` propia colisionaría con la inyectada.
    const { count } = await this.prisma.ai_messages.updateMany({
      where: { id: message.id, conversation_id: conversationId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });
    return count > 0;
  }

  /**
   * El approve (`VexController`) avisa por evento —llamada directa sería un
   * import circular (`AIChatModule` → `VexModule`)— y acá se mueve la tarjeta
   * a `approved` para que recargar muestre su estado. Contabilidad de
   * vitrina: si falla, se registra y la aprobación (ya acuñada) sigue válida.
   * Cableado E2E-1 del paso 6 de la remediación.
   */
  @OnEvent('ai.vex.plan_approved')
  async onVexPlanApproved(payload: {
    conversation_id: number;
    plan_id: string;
  }): Promise<void> {
    try {
      await this.updateVexPlanStatus(
        payload.conversation_id,
        payload.plan_id,
        'approved',
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo marcar el plan ${payload.plan_id} como approved (conversación ${payload.conversation_id}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Gate de los turnos de Vex: rol + toggle + plan, en ese orden.
   *
   * Es la versión inline del triple que `vex.controller.ts` expresa con
   * decoradores (`@Roles(OWNER, ADMIN)` + `VexEnabledGuard` +
   * `@RequireAIFeature('vex_agent')`): acá no sirven los decoradores porque el
   * gate depende de la key del turno —hilo u override por mensaje—, que solo
   * se conoce dentro del servicio. Cada pata espeja a su gemela:
   *
   * 1. Rol — `RolesGuard` estricto: `owner`/`admin` del JWT, sin bypass de
   *    `super_admin`, igual que en `vex.controller.ts`. 403 `AUTH_PERM_001`.
   * 2. Toggle — `VexEnabledGuard`: solo `true` explícito abre; fila ausente,
   *    bloque ausente y `false` fallan cerrados. 403 `AI_AGENT_004`.
   * 3. Plan — `AiAccessGuard('vex_agent')` inline: respeta `STORE_GATE_ENFORCE`
   *    (log-only observa y pasa) y mapea el `reason` al `ErrorCodes`
   *    correspondiente. Sin `store_id` en contexto, `SUBSCRIPTION_001` en
   *    enforce.
   *
   * No-op para cualquier key distinta de `vex`: los turnos de Vexi y de los
   * demás agentes no tocan este camino.
   */
  private async assertVexTurnAccess(agentKey: string | null): Promise<void> {
    if (agentKey !== VEX_AGENT_KEY) return;
    const context = RequestContextService.getContext();

    const roles = context?.roles ?? [];
    if (!roles.includes(UserRole.OWNER) && !roles.includes(UserRole.ADMIN)) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    const storeId = context?.store_id;
    // Sin tienda en scope no hay interruptor que evaluar; la pata de plan
    // decide abajo (igual que `VexEnabledGuard` deja pasar y `AiAccessGuard`
    // exige contexto).
    if (storeId) {
      const row = await this.globalPrisma.store_settings.findUnique({
        where: { store_id: storeId },
        select: { settings: true },
      });
      const settings = row?.settings as {
        vex?: { enabled?: boolean };
      } | null;
      if (settings?.vex?.enabled !== true) {
        throw new VendixHttpException(
          ErrorCodes.AI_AGENT_004,
          'Vex está desactivado para esta tienda. Un propietario o administrador puede volver a activarlo en Configuración → Agentes IA, pestaña Vex.',
        );
      }
    }

    if (!storeId) {
      if (this.gateConfig?.isEnforce()) {
        throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
      }
      this.logger.warn(
        JSON.stringify({
          event: 'AI_GATE_OBSERVATION',
          feature: VEX_AGENT_KEY,
          outcome: 'would_block',
          reason: 'missing_store_context',
        }),
      );
      return;
    }

    // `@Optional()` por las construcciones posicionales de los specs; en
    // producción resuelven desde el `SubscriptionsModule` global. Un turno
    // de Vex sin gate de plan falla cerrado, nunca abierto.
    if (!this.subscriptionAccess || !this.gateConfig) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_005);
    }

    let result: Awaited<
      ReturnType<SubscriptionAccessService['canUseAIFeature']>
    >;
    try {
      result = await this.subscriptionAccess.canUseAIFeature(
        storeId,
        'vex_agent',
      );
    } catch (err) {
      this.logger.error(
        `AI_GATE_ERROR feature=vex_agent err=${(err as Error).message}`,
      );
      if (this.gateConfig.isEnforce()) {
        throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
      }
      return;
    }

    this.logger.log(
      JSON.stringify({
        event: 'AI_GATE_CHECK',
        storeId,
        feature: 'vex_agent',
        allowed: result.allowed,
        mode: result.mode,
        reason: result.reason,
        state: result.subscription_state,
        enforce: this.gateConfig.isEnforce(),
      }),
    );

    if (result.mode === 'block' && this.gateConfig.isEnforce()) {
      const key =
        (result.reason as keyof typeof ErrorCodes) ?? 'SUBSCRIPTION_005';
      const entry = ErrorCodes[key] ?? ErrorCodes.SUBSCRIPTION_005;
      const details = {
        subscription_state: result.subscription_state,
        plan_id: result.plan_id ?? null,
        has_record: result.has_record,
      };
      throw new VendixHttpException(entry, undefined, details);
    }
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

  /** Aplica el agente configurable solo al chat por defecto, sin migrar hilos. */
  private turnAgentKey(
    conversation: ConversationWithMessages,
    override?: string,
  ): string | null {
    return (
      override ??
      this.conversationAgentKey(conversation) ??
      (!conversation.app_key || conversation.app_key === 'chat_assistant'
        ? 'vexi'
        : null)
    );
  }

  /**
   * Resuelve la fila de `ai_agents` para el turno, o `null` cuando no hay
   * agente (camino exacto de hoy).
   *
   * Una key desconocida o inactiva NO rompe el turno: warn + fallback. Acá la
   * resiliencia gana sobre el fallo rápido porque el turno ya existe y el
   * usuario está esperando respuesta (en `createConversation` sí se falla
   * rápido, porque ahí todavía no hay nada que romper). Un agente borrado o
   * desactivado a mitad de una conversación larga vuelve al comportamiento
   * anterior de la app en vez de dejar el hilo muerto.
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
      denied_tools: row.denied_tools ?? [],
      max_iterations: row.max_iterations,
    };
  }

  /**
   * Folds the person's latest block interactions into the turn goal, so
   * "esas filas" resolves to the actual selection.
   *
   * Vex turns only: Vexi never renders blocks, so its goal stays byte-identical.
   * Never throws — a selection lookup failure must not fail the turn, and
   * without `VexBlockService` (positional test constructions) there is simply
   * no selection to fold.
   */
  private async withBlockSelection(
    goal: string,
    agentKey: string | null,
    conversationId: number,
  ): Promise<string> {
    if (agentKey !== VEX_AGENT_KEY || !this.vexBlocks) return goal;
    let selections: Awaited<
      ReturnType<VexBlockService['recentSelections']>
    > = [];
    try {
      selections = await this.vexBlocks.recentSelections(conversationId);
    } catch (error) {
      this.logger.warn(
        `Block selections unavailable for conversation ${conversationId}: ${
          (error as Error)?.message ?? 'unknown'
        }`,
      );
      return goal;
    }
    if (selections.length === 0) return goal;
    const notes = selections.map((s) => {
      const what =
        s.type === 'row_select'
          ? `filas seleccionadas (${s.selection.length}${
              s.truncated ? '+, truncadas a 50' : ''
            })`
          : `interacción ${s.type}`;
      const label = s.title ? ` (“${s.title}”)` : '';
      return `- Bloque ${s.kind}${label} ${s.block_id}: ${what}:\n${JSON.stringify(s.selection)}`;
    });
    return (
      `${goal}\n\n[Contexto de pantalla: la persona interactuó con estos bloques. ` +
      `Si se refiere a "esas", "las seleccionadas" o "lo marcado", usa estos datos, ` +
      `no los adivines ni pidas que los repita.]\n${notes.join('\n')}`
    );
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
   * - `agent_key` + `agent_allowed_tools` / `agent_denied_tools`: alcance de
   *   la fila (sin esto Vex vería las `ui_*` que tiene denegadas y correría
   *   con presupuesto por defecto en vez del suyo).
   * - `conversation_id`: el loop lo usa como default de las `vex_*` que
   *   guardan bloques, para que el modelo no tenga que adivinarlo.
   * - `plan_approval` + `block_sink`: SOLO cuando el agente es `vex`. Vexi y
   *   los demás agentes reciben exactamente lo de antes, sin esas llaves.
   */
  private resolveAgentLoopArgs(
    agent: ResolvedChatAgent | null,
    conversation: ConversationWithMessages,
    vexTurn?: VexTurnCollection | null,
  ): {
    app_key?: string;
    system_prompt?: string;
    tools?: string[];
    max_iterations?: number;
    agent_key?: string;
    agent_allowed_tools?: string[];
    agent_denied_tools?: string[];
    conversation_id?: number;
    plan_approval?: AgentPlanApprovalHook;
    block_sink?: AgentBlockSink;
  } {
    const appKey = agent?.app_key || conversation.app_key || 'chat_assistant';
    if (!agent) {
      return { app_key: appKey };
    }
    const tools =
      agent.allowed_tools.length > 0 ? agent.allowed_tools : undefined;
    const max_iterations = agent.max_iterations ?? undefined;
    const scope = {
      agent_key: agent.key,
      agent_allowed_tools:
        agent.allowed_tools.length > 0 ? agent.allowed_tools : undefined,
      agent_denied_tools:
        agent.denied_tools.length > 0 ? agent.denied_tools : undefined,
      conversation_id: conversation.id,
    };
    // Solo Vex propone planes completos y compacta a bloques: el cableado viaja
    // únicamente en sus turnos, y ausente (no `undefined`) en los demás para
    // que su forma siga byte-idéntica a la de antes.
    const vexWiring =
      agent.key === VEX_AGENT_KEY
        ? this.vexLoopWiring(conversation, vexTurn)
        : {};
    if (!agent.app_key && !conversation.app_key && agent.system_prompt) {
      return {
        system_prompt: agent.system_prompt,
        tools,
        max_iterations,
        ...scope,
        ...vexWiring,
      };
    }
    return { app_key: appKey, tools, max_iterations, ...scope, ...vexWiring };
  }

  /**
   * Cableado Vex del loop: hook de aprobación de plan + sink de bloques.
   *
   * Cada pata se omite (no se pasa a medias) cuando su servicio no resolvió:
   * un hook sin clasificador o sin persistencia de hashes propondría un plan
   * que approve rechazaría entero, y un sink sin servicio es indistinguible de
   * no compactar. El turno sigue corriendo en ambos casos.
   */
  private vexLoopWiring(
    conversation: ConversationWithMessages,
    vexTurn?: VexTurnCollection | null,
  ): {
    plan_approval?: AgentPlanApprovalHook;
    block_sink?: AgentBlockSink;
  } {
    const wiring: {
      plan_approval?: AgentPlanApprovalHook;
      block_sink?: AgentBlockSink;
    } = {};
    const hook = this.planApprovalHookFor(conversation);
    if (hook) {
      wiring.plan_approval = hook;
    } else {
      this.logger.warn(
        `Vex turn on conversation ${conversation.id} runs without the plan-approval hook (PlanApprovalService/VexiConfirmationService unresolved) — its plan cannot persist step hashes.`,
      );
    }
    const sink = this.blockSinkFor(conversation, vexTurn);
    if (sink) {
      wiring.block_sink = sink;
    } else {
      this.logger.warn(
        `Vex turn on conversation ${conversation.id} runs without the block sink (VexBlockService unresolved) — oversized results compact without a block_id.`,
      );
    }
    return wiring;
  }

  /**
   * Hook de aprobación que el loop usa en DOS fases: en la propuesta acumula
   * (clasifica + persiste hashes vía `PlanApprovalService` +
   * `VexiPlanStateService`); en la ejecución redime contra el token.
   *
   * Sin token en un turno que propone: el token lo acuña approve y vuelve con
   * la continuación de aprobación, así que hasta entonces todo redeem responde
   * `missing` y cada paso cae a su propia tarjeta — la dirección segura.
   */
  private planApprovalHookFor(
    conversation: ConversationWithMessages,
  ): AgentPlanApprovalHook | undefined {
    if (!this.planApproval || !this.confirmations) return undefined;
    const planApproval = this.planApproval;
    const confirmations = this.confirmations;
    const conversationId = conversation.id;
    return {
      redeem: async () => 'missing' as const,
      issueSingleUse: (tool, args) =>
        confirmations.issue(
          tool,
          args,
          RequestContextService.getContext()?.user_id,
        ),
      classifyProposedSteps: (steps) => planApproval.classifySteps(steps),
      saveProposedSteps: async (steps) => {
        await this.planState.setStepHashes(conversationId, steps);
      },
    };
  }

  /**
   * Dónde el loop deja los payloads que no caben en la ventana (>6000
   * caracteres): bloques `markdown` bajo esta conversación, vía
   * `VexBlockService` tal cual (sin tocarlo).
   *
   * Sin `message_id`: la fila del asistente se crea cuando el stream cierra,
   * después del turno — el bloque nace huérfano de mensaje y el cierre del
   * turno lo enlaza (`attachVexTurnBlocks`) y guarda su puntero en
   * `metadata.blocks`. Cada `save` también alimenta el colector, para que el
   * cierre no dependa de re-leer lo que el turno acaba de escribir.
   */
  private blockSinkFor(
    conversation: ConversationWithMessages,
    vexTurn?: VexTurnCollection | null,
  ): AgentBlockSink | undefined {
    if (!this.vexBlocks) return undefined;
    const blocks = this.vexBlocks;
    const conversationId = conversation.id;
    return {
      save: async ({ conversation_id, kind, spec, data }) => {
        const row = await blocks.create({
          conversation_id: conversation_id ?? conversationId,
          kind,
          spec,
          data: data as Record<string, any>,
        });
        vexTurn?.blocks.set(row.id, {
          block_id: row.id,
          kind: row.kind,
          version: row.version,
        });
        return row.id;
      },
    };
  }

  /**
   * Variables del turno Vex: el snapshot de negocio SIN `ui_context` (Vex no
   * toca el navegador y ese material lo compone el cliente) MÁS los bloques
   * vivos de la conversación, para que el modelo siga trabajando sobre lo
   * que ya mostró sin re-ejecutar consultas.
   *
   * Nunca rompe el turno: sin `VexBlockService` (construcciones posicionales
   * de specs) o con el listado caído, el snapshot viaja sin bloques.
   */
  private async buildVexVariables(
    conversationId: number,
    attachmentIds?: string[],
  ): Promise<Record<string, string>> {
    let vexBlocks: Array<{
      block_id: string;
      kind: string;
      version: number;
      title?: string;
      rows?: number;
    }> | undefined;
    if (this.vexBlocks) {
      try {
        const rows = await this.vexBlocks.listByConversation(conversationId);
        vexBlocks = rows.map((row) => ({
          block_id: row.id,
          kind: row.kind,
          version: row.version,
          ...(typeof row.spec?.title === 'string'
            ? { title: row.spec.title as string }
            : {}),
          ...(Array.isArray((row.data as Record<string, any>)?.rows)
            ? { rows: ((row.data as Record<string, any>).rows as unknown[]).length }
            : {}),
        }));
      } catch (error) {
        this.logger.warn(
          `Vex blocks unavailable for conversation ${conversationId}: ${
            (error as Error)?.message ?? 'unknown'
          }`,
        );
      }
    }
    return this.vexiContext.buildVexSnapshot({ attachmentIds, vexBlocks });
  }

  /**
   * Guarda la referencia de lo que el turno mostró en vivo. Solo frames con
   * identidad: `ui_block` con `block_id`, y `plan_approval` de plan completo
   * (con `steps` + `plan_id`) — las tarjetas de un solo paso llevan
   * `plan_id` sin `steps` y no redefinen el plan del turno.
   */
  private collectVexFrame(
    vexTurn: VexTurnCollection,
    chunk: AIStreamChunk,
  ): void {
    const uiBlock = chunk.ui_block;
    if (chunk.type === 'ui_block' && uiBlock?.block_id) {
      vexTurn.blocks.set(uiBlock.block_id, {
        block_id: uiBlock.block_id,
        kind: uiBlock.kind,
        version: typeof uiBlock.version === 'number' ? uiBlock.version : 1,
      });
    }
    const approval = chunk.plan_approval;
    if (
      chunk.type === 'plan_approval' &&
      approval?.plan_id &&
      approval.steps
    ) {
      vexTurn.plan = { plan_id: approval.plan_id, steps: approval.steps };
    }
  }

  /**
   * Referencias a bloques escondidas en la traza de tools (camino sync, que
   * no ve frames): los envelopes de `vex_render_*` / `vex_block_transform`
   * traen `data.block_id` + la vista del panel en `data.block`. Gana la
   * vista cuando existe — es el mismo `block_id` que el frame `ui_block`
   * llevó al panel en el camino SSE.
   */
  private renderBlockRefsOf(
    toolsUsed: Array<{ name: string; args: any; result: string }>,
  ): VexBlockRef[] {
    const refs: VexBlockRef[] = [];
    for (const tool of toolsUsed) {
      const fallbackKind =
        tool.name === 'vex_render_table'
          ? 'table'
          : tool.name === 'vex_render_chart'
            ? 'chart'
            : tool.name === 'vex_render_kpi'
              ? 'kpi'
              : tool.name === 'vex_render_image'
                ? 'image'
                : tool.name === 'vex_render_file'
                  ? 'file'
                  : tool.name === 'vex_block_transform'
                    ? 'table'
                    : null;
      if (!fallbackKind) continue;
      try {
        const data = (JSON.parse(tool.result) as any)?.data;
        const view =
          data?.block && typeof data.block === 'object' ? data.block : null;
        const block_id =
          (typeof view?.block_id === 'string' && view.block_id) ||
          data?.block_id;
        if (typeof block_id !== 'string' || !block_id) continue;
        const kind =
          (typeof view?.kind === 'string' && view.kind) ||
          (typeof data?.kind === 'string' && data.kind) ||
          fallbackKind;
        const rawVersion = view?.version ?? data?.version;
        refs.push({
          block_id,
          kind,
          version: typeof rawVersion === 'number' ? rawVersion : 1,
        });
      } catch {
        // Resultado compactado o no-JSON: el barrido de huérfanos lo cubre.
      }
    }
    return refs;
  }

  /**
   * Fusión final de bloques del turno: lo coleccionado en vivo (sink +
   * frames) manda, los envelopes de la traza agregan lo que el stream no
   * vio, y el barrido de huérfanos (`message_id` NULL) sana dos casos que
   * ningún otro camino cubre: resultados de render tan grandes que la traza
   * guardó su forma compactada, y bloques de un turno anterior cuyo
   * transporte cayó antes del cierre.
   */
  private async resolveVexTurnBlocks(
    conversationId: number,
    vexTurn: VexTurnCollection | null,
    toolsUsed: Array<{ name: string; args: any; result: string }>,
  ): Promise<VexBlockRef[]> {
    if (!vexTurn) return [];
    const merged = new Map(vexTurn.blocks);
    for (const ref of this.renderBlockRefsOf(toolsUsed)) {
      if (!merged.has(ref.block_id)) merged.set(ref.block_id, ref);
    }
    if (this.vexBlocks) {
      try {
        const rows = await this.vexBlocks.listByConversation(conversationId);
        for (const row of rows) {
          if (row.message_id !== null && row.message_id !== undefined) {
            continue;
          }
          if (!merged.has(row.id)) {
            merged.set(row.id, {
              block_id: row.id,
              kind: row.kind,
              version: row.version,
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          `Vex turn block sweep failed for conversation ${conversationId}: ${
            (error as Error)?.message ?? 'unknown'
          }`,
        );
      }
    }
    return [...merged.values()];
  }

  /**
   * `metadata` Vex del mensaje de cierre: punteros a bloques + plan en estado
   * `proposed`. `null` cuando el turno no produjo nada persistible (o no es
   * Vex), para que la fila quede byte-idéntica a hoy.
   */
  private vexTurnMetadata(
    blocks: VexBlockRef[],
    plan: VexTurnCollection['plan'] | null,
  ): Record<string, unknown> | null {
    if (blocks.length === 0 && !plan) return null;
    return {
      ...(blocks.length > 0 ? { blocks } : {}),
      ...(plan
        ? {
            plan: {
              plan_id: plan.plan_id,
              steps: plan.steps,
              status: 'proposed',
            },
          }
        : {}),
    };
  }

  /**
   * Enlaza los bloques del turno con el mensaje que cierra. Aislado: si
   * falla, los bloques quedan huérfanos pero el mensaje (con sus punteros)
   * ya persistió, y el próximo turno los recoge en su barrido.
   */
  private async attachVexTurnBlocks(
    blocks: VexBlockRef[],
    messageId: number,
  ): Promise<void> {
    if (blocks.length === 0 || !this.vexBlocks) return;
    try {
      await this.vexBlocks.attachToMessage(
        blocks.map((b) => b.block_id),
        messageId,
      );
    } catch (error) {
      this.logger.warn(
        `Vex turn blocks could not be linked to message ${messageId}: ${
          (error as Error)?.message ?? 'unknown'
        }`,
      );
    }
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
    plan?: {
      active: AgentPlan | null;
      paused: AgentPlan | null;
      isContinuation: boolean;
    },
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
    // Una continuación nace de resolver la tarjeta: tras «Rechazar» el marcador
    // sigue vivo en el historial (el rechazo no deja fila en el servidor) y el
    // bloque le diría al modelo que la tarjeta aún espera «Aprobar».
    const pending = plan?.isContinuation
      ? null
      : this.findPendingProposal(conversation.messages);
    if (pending) {
      messages.push({
        role: 'system',
        content: PENDING_CONFIRMATION_BLOCK(pending),
      });
    }

    // Inmediatamente antes del objetivo: el plan gobierna qué sigue en ESTE turno.
    if (plan?.active) {
      messages.push({
        role: 'system',
        content: renderPlanForModel(plan.active),
      });
      if (!plan.isContinuation) {
        messages.push({ role: 'system', content: PLAN_MESSAGE_RULES_BLOCK });
      }
    } else if (plan?.paused) {
      messages.push({
        role: 'system',
        content: `(interno) Tienes un trabajo en pausa: ${plan.paused.goal}. Si ya atendiste lo nuevo, pregúntale con naturalidad si retomas.`,
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
