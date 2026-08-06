import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResponseService } from '../../../common/responses/response.service';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import {
  AiAccessGuard,
  RequireAIFeature,
} from '../subscriptions/guards/ai-access.guard';
import { VexiEnabledGuard } from './guards/vexi-enabled.guard';
import { VexiVoiceService } from './vexi-voice.service';
import { VexiSpeechService } from './vexi-speech.service';
import { VoiceChunkDto, VoiceTranscribeDto } from './dto/voice-turn.dto';

/**
 * Input end of the pipeline voice mode.
 *
 * Only the audio→text leg lives here. The answer travels back over the chat's
 * existing SSE stream, because a pipeline voice turn *is* a chat turn: that is
 * what makes voice inherit the tool catalog, the confirmation card, the
 * conversation and the write audit instead of reimplementing them.
 *
 * Same role restriction as the rest of Vexi — a spoken turn can reach every
 * write the chat can.
 */
@Controller('store/vexi/voice')
@UseGuards(RolesGuard, VexiEnabledGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class VexiVoiceController {
  constructor(
    private readonly voice: VexiVoiceService,
    private readonly speech: VexiSpeechService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Accepts a slice of a recording still in progress.
   *
   * Called repeatedly while the user holds the button, so that when they release
   * only the tail has to travel — it removes the upload leg from the critical
   * path without changing where the audio ends up.
   *
   * Deliberately NOT behind `AiAccessGuard`. This endpoint spends nothing: it
   * buffers bytes in memory and calls no provider. The gate belongs on
   * `transcribe`, which is the call that bills. Gating here too would reject the
   * cheap half of a flow and leave the expensive half as the only thing metered.
   */
  @Post('chunk')
  @UseInterceptors(FileInterceptor('file'))
  async appendChunk(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: VoiceChunkDto,
  ) {
    const result = this.voice.appendChunk(dto.turn_id, file);
    return this.responseService.success(result, 'Fragmento recibido');
  }

  /**
   * Closes the recording and returns its transcript.
   *
   * Metered against `realtime_voice` because this is the call that reaches the
   * provider. The guard runs before the interceptor on purpose: Nest orders
   * guards ahead of interceptors, so a plan without voice is rejected before
   * Multer buffers the audio at all.
   *
   * An empty transcript comes back as a success with `text: ''`. A tap that
   * caught no speech is a normal outcome, and surfacing it as an error would
   * make the user read a failure for having changed their mind.
   */
  @Post('transcribe')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('realtime_voice')
  @UseInterceptors(FileInterceptor('file'))
  async transcribe(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: VoiceTranscribeDto,
  ) {
    const result = await this.voice.transcribe(dto.turn_id, file);
    return this.responseService.success(result, 'Audio transcrito');
  }

  /**
   * Synthesizes the filler bank so the first spoken turn does not pay for it.
   *
   * Called when a voice session opens. The fillers are what cover the entire
   * STT + LLM + first-TTS window with something human, and a filler that has to
   * be synthesized on demand covers nothing — it *is* the latency it was meant
   * to hide. Idempotent: a second call finds everything pinned and returns
   * without touching the provider.
   */
  @Post('warm')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('realtime_voice')
  async warm() {
    const result = await this.speech.warmFillers();
    return this.responseService.success(result, 'Banco de voz listo');
  }
}
