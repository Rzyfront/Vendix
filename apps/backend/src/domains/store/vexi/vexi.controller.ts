import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { VexiContextService } from './vexi-context.service';
import { ResponseService } from '../../../common/responses/response.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { CapabilityRegistryService } from '../../../ai-engine/tools/bridge/capability-registry.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import {
  AiAccessGuard,
  RequireAIFeature,
} from '../subscriptions/guards/ai-access.guard';
import { ApplyConfirmationDto } from './dto/apply-confirmation.dto';
import { UiResultDto, UploadAttachmentDto } from './dto/ui-result.dto';
import { VexiEnabledGuard } from './guards/vexi-enabled.guard';
import { VexiAttachmentsService } from './vexi-attachments.service';
import { VexiUiChannelService } from './vexi-ui-channel.service';
import { VexiTaskService } from './vexi-task.service';
import { VexiActivityService } from './vexi-activity.service';
import { VexiSpeechService } from './vexi-speech.service';
import { EmbeddingBackfillService } from '../../../ai-engine/embeddings/embedding-backfill.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

/**
 * Vexi's non-realtime surface.
 *
 * Restricted to owner and admin for the same reason as the voice controller:
 * the snapshot carries revenue, plan state and module configuration.
 *
 * The AI subscription gate lives on individual handlers instead of the class,
 * because only two endpoints here spend anything: `attachments` pays for S3 plus
 * the vision run it exists to feed, and `embeddings/backfill` pays for one
 * embedding per record. Everything else either reads this store's own state or
 * closes a circuit an already-gated turn opened — gating those would take away a
 * flow the user has paid for without saving a cent of provider spend. Each
 * decision is argued at its handler so a later reader does not "fix" the
 * omissions.
 */
@Controller('store/vexi')
@UseGuards(RolesGuard, VexiEnabledGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class VexiController {
  constructor(
    private readonly context: VexiContextService,
    private readonly responseService: ResponseService,
    private readonly toolRegistry: AIToolRegistry,
    private readonly attachments: VexiAttachmentsService,
    private readonly uiChannel: VexiUiChannelService,
    private readonly capabilities: CapabilityRegistryService,
    private readonly tasks: VexiTaskService,
    private readonly activity: VexiActivityService,
    private readonly embeddingBackfill: EmbeddingBackfillService,
    private readonly speech: VexiSpeechService,
  ) {}

  /**
   * The exact variable map that gets interpolated into Vexi's system prompt.
   *
   * Exposed as an endpoint so the prompt's inputs are inspectable without
   * reading provider logs: when Vexi says something wrong about the business,
   * this tells you whether the prompt or the model is at fault.
   */
  @Get('context')
  async getContext() {
    const snapshot = await this.context.buildSnapshot();
    return this.responseService.success(snapshot, 'Vexi context snapshot');
  }

  /**
   * Applies a write the user approved in the confirmation card.
   *
   * Nothing about authorization is delegated to the token: `executeTool()`
   * still checks the caller's permissions on the way through, and the write
   * tool still re-verifies its own preconditions. The token only proves *this
   * user saw this exact diff*, and it is consumed atomically, so a
   * double-clicked "Aprobar" applies once.
   *
   * Deliberately NOT behind `AiAccessGuard`. A confirmation token can only have
   * been minted inside an agent turn, and that turn already passed the AI gate in
   * `store/ai-chat` — the plan question was answered before this request could
   * exist, and no provider call happens on this path. Re-asking it here would add
   * a failure mode and no protection: a store that crossed its daily message cap
   * or slid into `grace_hard` between the proposal and the "Aprobar" click would
   * be locked out of a change it already reviewed and authorised, with the token
   * expiring in its hand. What genuinely must not happen — writing into a
   * terminal-state subscription — is already enforced on this POST by the global
   * `StoreOperationsGuard`, which gates every write under `/api/store/**`.
   */
  @Post('confirmations/apply')
  async applyConfirmation(@Body() dto: ApplyConfirmationDto) {
    const output = await this.toolRegistry.executeTool(
      dto.tool,
      dto.arguments as Record<string, any>,
      { confirmationToken: dto.confirmation_token },
    );

    // Recorded HERE and not in the agent loop, because this is the only place an
    // applied write exists. The loop persists the PROPOSAL; the approval arrives on
    // a separate request, so a trail built only from the turn's `tool_calls` shows
    // every proposal and not one of the changes that actually landed.
    await this.activity.recordApplied({
      conversationId: dto.conversation_id,
      tool: dto.tool,
      args: dto.arguments,
      output,
    });

    // The sentence the tool wrote about its own change, which is what the person
    // gets told. Extracted here rather than in the browser so the text that is
    // spoken and the text that is shown are the same string by construction —
    // two renderings of one truth, never two truths.
    const summary = this.applySummary(output);

    // Voice mode only. A spoken approval that answers only in writing leaves the
    // person waiting for a reply they were never going to hear, which is exactly
    // how an applied change ends up looking like a hung one.
    //
    // A failed synthesis degrades to text: `synthesize()` returns null instead of
    // throwing, and losing the audio of an acknowledgement must never lose the
    // acknowledgement — much less suggest the write did not happen. It already
    // happened, above.
    let audio: { audioBase64: string; contentType: string } | null = null;
    if (dto.speak && summary) {
      const params = await this.speech.resolveParams();
      audio = await this.speech.synthesize(summary, params);
    }

    return this.responseService.success(
      {
        tool: dto.tool,
        output,
        summary,
        ...(audio && {
          audio_base64: audio.audioBase64,
          content_type: audio.contentType,
        }),
      },
      'Cambio aplicado',
    );
  }

  /**
   * The human sentence inside a tool's applied output.
   *
   * Write tools answer with `JSON.stringify({ summary, data, note })`, so the
   * sentence is already written — by the code that made the change, which is the
   * only place that knows what actually happened. Anything reconstructed out here
   * from the arguments would describe the *request*, and those differ: a price
   * change re-computes against the value in force at confirm time, not the one the
   * preview showed.
   *
   * Returns null rather than a fallback phrase when there is nothing quotable. The
   * caller decides what to say when the tool said nothing, and a generic "listo"
   * invented here would be indistinguishable from one the tool meant.
   */
  private applySummary(output: string): string | null {
    try {
      const parsed = JSON.parse(output) as { summary?: unknown };
      return typeof parsed?.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : null;
    } catch {
      // Not every tool answers with JSON, and a plain-string answer is already
      // the sentence — as long as it is short enough to be one.
      const text = output?.trim();
      return text && text.length <= 400 ? text : null;
    }
  }

  /**
   * Stages a document so a later turn can hand it to a vision application.
   *
   * Separate from the chat handshake because a photo of an invoice is megabytes
   * and the handshake is a small JSON body the browser sends synchronously before
   * opening the EventSource. Uploading first means the SSE call still carries only
   * an opaque id, and the person sees the upload progress on its own.
   *
   * The response is a handle, never a URL: what the model receives must not be
   * something it can leak into a message.
   *
   * Gated on `text_generation` because that is the budget the document actually
   * draws from: the upload exists to be handed to a vision application, and a
   * vision application is an `AIEngineService.run()` call metered against
   * `text_generation.monthly_tokens_cap`. Checking the key the downstream
   * consumption bills to means the bucket is never paid for when the extraction
   * behind it is impossible.
   *
   * `StoreOperationsGuard` does not cover this: it answers "is this subscription
   * in a state that may write?", and an `active` store on a plan with every AI
   * flag off passes it cleanly — it would still push megabytes into S3 for a run
   * its plan can never make. The guard is declared before the interceptor for a
   * reason beyond style: Nest runs guards ahead of interceptors, so a blocked
   * request is rejected before Multer buffers the file at all.
   */
  @Post('attachments')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('text_generation')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAttachmentDto,
  ) {
    const stored = await this.attachments.store(file, dto.conversation_id);
    return this.responseService.created(stored, 'Documento recibido');
  }

  /**
   * What actually happened on screen, reported back into the waiting turn.
   *
   * This is the return leg of the UI loop. The agent emitted a `tool_call`, the
   * browser executed it against the registered host, and this hands the real result
   * to the suspended loop — which is what lets Vexi say "no pude, ese producto pide
   * variante" instead of claiming success it never observed.
   *
   * A mismatched owner is rejected rather than ignored: a leaked `stream_id` would
   * otherwise let any authenticated user inject fabricated screen results into
   * somebody else's agent turn, and the model treats those as ground truth.
   *
   * Also deliberately NOT behind `AiAccessGuard`. Rejecting this call cannot save
   * provider spend — the tokens were already spent when the agent emitted the
   * `tool_call` — it can only strand a loop that is suspended on this exact
   * `(stream_id, tool_call_id)` until it times out. The store would pay for the
   * turn and receive "no pude confirmarlo" instead of an answer. The owner check
   * below, not a plan check, is what protects this endpoint.
   */
  @Post('ui-result')
  async submitUiResult(@Body() dto: UiResultDto) {
    const userId = RequestContextService.getContext()?.user_id;

    const accepted = await this.uiChannel.submitResult(
      dto.stream_id,
      dto.tool_call_id,
      dto.result,
      userId,
    );

    if (!accepted) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_006,
        'Ese turno ya no está esperando resultados de pantalla.',
      );
    }

    return this.responseService.success({ accepted: true }, 'Resultado recibido');
  }

  /**
   * What this user can actually do, in business language.
   *
   * Derived from their real permissions crossed with the route catalog, so it is the
   * same answer the agent gets from `list_capabilities`. Exposed over HTTP so the
   * scope can be audited without going through a conversation — "¿por qué Vexi dice
   * que no puede liquidar nómina?" is answerable with one call.
   */
  @Get('capabilities')
  async getCapabilities(@Query('domain') domain?: string) {
    if (domain) {
      return this.responseService.success(
        { domain, scopes: this.capabilities.describeDomain(domain) },
        'Capacidades del dominio',
      );
    }

    return this.responseService.success(
      {
        domains: this.capabilities.listDomains(),
        gaps: this.capabilities.gaps(),
      },
      'Capacidades de Vexi para este usuario',
    );
  }

  /** State of a background task, for the panel's task strip. */
  @Get('tasks/:id')
  async getTask(@Param('id', ParseIntPipe) id: number) {
    const task = await this.tasks.get(id);
    return this.responseService.success(task, 'Estado del trabajo');
  }

  @Get('tasks')
  async listTasks() {
    const tasks = await this.tasks.listRecent();
    return this.responseService.success(tasks, 'Trabajos recientes');
  }

  /**
   * Indexes the store's existing records for semantic search.
   *
   * Needed because the entity listeners only fire on new writes: a commerce with
   * three years of history has an empty index, so Vexi answers "no encontré" about its
   * own best customer. Idempotent — the embedding upsert keys on
   * `(store_id, entity_type, entity_id)`, so a second pass refreshes instead of
   * duplicating, which also makes it the way to re-index after changing how an
   * entity's searchable text is composed.
   *
   * Gated on `rag_embeddings`, the feature whose `indexed_docs_cap` budgets exactly
   * this: one pass enqueues up to 500 records per entity type and every job is a
   * paid embedding call. The check has to be here because there is nowhere else it
   * could happen — this controller is the only caller of `backfillCurrentStore()`,
   * and `EmbeddingService` calls the provider directly rather than through
   * `AIEngineService`, so the inline gate that protects every other AI application
   * never sees these jobs.
   */
  @Post('embeddings/backfill')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('rag_embeddings')
  async backfillEmbeddings() {
    const report = await this.embeddingBackfill.backfillCurrentStore();
    return this.responseService.success(report, 'Indexación encolada');
  }

  /**
   * Everything Vexi has changed in this store, with what justified it.
   *
   * An agent that can write into a commerce's accounting has to be reviewable after
   * the fact, by the owner, without reading logs. Each entry carries the record that
   * changed, the document that originated it when there was one, and who approved.
   */
  @Get('activity')
  async getActivity(@Query('limit') limit?: string) {
    const entries = await this.activity.list(
      limit ? Number(limit) : undefined,
    );
    return this.responseService.success(entries, 'Actividad de Vexi');
  }
}
