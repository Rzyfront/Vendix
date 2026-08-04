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
import { ApplyConfirmationDto } from './dto/apply-confirmation.dto';
import { UiResultDto, UploadAttachmentDto } from './dto/ui-result.dto';
import { VexiEnabledGuard } from './guards/vexi-enabled.guard';
import { VexiAttachmentsService } from './vexi-attachments.service';
import { VexiUiChannelService } from './vexi-ui-channel.service';
import { VexiTaskService } from './vexi-task.service';
import { VexiActivityService } from './vexi-activity.service';
import { EmbeddingBackfillService } from '../../../ai-engine/embeddings/embedding-backfill.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

/**
 * Vexi's non-realtime surface.
 *
 * Restricted to owner and admin for the same reason as the voice controller:
 * the snapshot carries revenue, plan state and module configuration.
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

    return this.responseService.success(
      { tool: dto.tool, output },
      'Cambio aplicado',
    );
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
   */
  @Post('attachments')
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
   */
  @Post('embeddings/backfill')
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
