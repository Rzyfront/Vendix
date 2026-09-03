import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  CHUNK_BUFFER_TTL_MS,
  MAX_CHUNK_BYTES,
  MAX_TURN_AUDIO_BYTES,
  TRANSCRIPTION_LANGUAGE,
  VOICE_STT_APP_KEY,
} from './vexi-speech.constants';

interface PartialTurn {
  parts: Buffer[];
  bytes: number;
  format: string;
  expiresAt: number;
}

/**
 * Turns a spoken turn into text.
 *
 * The audio is never persisted. The transcript is the only record kept, which is
 * both cheaper and less exposure: a turn's value is entirely in the text it
 * produces, and that text is what the conversation and the write audit need.
 *
 * Chunks are held in process memory rather than S3 or disk for the same reason —
 * they exist for the seconds between the button going down and coming up, and a
 * turn the user abandoned mid-sentence must leave nothing behind.
 */
@Injectable()
export class VexiVoiceService {
  private readonly logger = new Logger(VexiVoiceService.name);

  /** Keyed by `${userId}:${turnId}` so one caller can never touch another's. */
  private readonly partials = new Map<string, PartialTurn>();

  constructor(private readonly aiEngine: AIEngineService) {}

  /**
   * Accepts a slice of a recording still in progress.
   *
   * The browser streams these while the user is still talking, so that when the
   * button comes up only the tail has to travel. It is the upload leg that gets
   * overlapped, not the transcription — the audio still reaches the provider as
   * one request.
   */
  appendChunk(dtoTurnId: string, file?: Express.Multer.File): { bytes: number } {
    const chunk = this.requireFile(file, MAX_CHUNK_BYTES);
    const format = this.resolveFormat(file!);
    const key = this.bufferKey(dtoTurnId);

    this.sweepExpired();

    const existing = this.partials.get(key);
    if (!existing) {
      this.partials.set(key, {
        parts: [chunk],
        bytes: chunk.length,
        // The container is decided by the first slice; the rest are its
        // continuation and carry no header of their own.
        format,
        expiresAt: Date.now() + CHUNK_BUFFER_TTL_MS,
      });
      return { bytes: chunk.length };
    }

    if (existing.bytes + chunk.length > MAX_TURN_AUDIO_BYTES) {
      // Drop what was buffered: keeping a truncated recording around would let
      // the next chunk succeed and produce a transcript of half a sentence.
      this.partials.delete(key);
      throw new VendixHttpException(
        ErrorCodes.VEXI_VOICE_TOO_LARGE,
        'La grabación es demasiado larga. Mandala en turnos más cortos.',
      );
    }

    existing.parts.push(chunk);
    existing.bytes += chunk.length;
    existing.expiresAt = Date.now() + CHUNK_BUFFER_TTL_MS;

    return { bytes: existing.bytes };
  }

  /**
   * Closes the recording and returns its transcript.
   *
   * An empty transcript is a normal outcome, not an error: a tap that caught no
   * speech, or a recording of silence, legitimately produces no text. Returning
   * `{ text: '' }` lets the client drop the turn without a failure the user
   * would have to read.
   */
  async transcribe(
    turnId?: string,
    tail?: Express.Multer.File,
  ): Promise<{ text: string }> {
    this.sweepExpired();

    const key = turnId ? this.bufferKey(turnId) : null;
    const buffered = key ? this.partials.get(key) : undefined;
    if (key) this.partials.delete(key);

    const parts: Buffer[] = buffered ? [...buffered.parts] : [];
    let format = buffered?.format;

    if (tail?.buffer?.length) {
      this.assertSize(tail.buffer, MAX_CHUNK_BYTES);
      parts.push(tail.buffer);
      format = format ?? this.resolveFormat(tail);
    } else if (!parts.length) {
      // Nothing buffered and nothing uploaded: the client asked to close a turn
      // that never carried audio.
      throw new VendixHttpException(
        ErrorCodes.VEXI_VOICE_NO_AUDIO,
        'No se recibió audio para transcribir.',
      );
    }

    // Concatenated in arrival order because that is the only order in which the
    // slices form a valid stream: `MediaRecorder` writes the container header
    // into the first blob only, and every later blob is a bare continuation of
    // it. Reordering or dropping one yields bytes no decoder will accept.
    const audio = Buffer.concat(parts);
    this.assertSize(audio, MAX_TURN_AUDIO_BYTES);

    const response = await this.aiEngine.runTranscription(VOICE_STT_APP_KEY, {
      inputAudio: {
        data: audio.toString('base64'),
        format: format ?? 'webm',
      },
      // Passed explicitly rather than left to the config so the language the
      // product speaks is visible in the code that decides it.
      language: TRANSCRIPTION_LANGUAGE,
    });

    if (!response.success) {
      this.logger.warn(`Transcription failed: ${response.error}`);
      throw new VendixHttpException(
        ErrorCodes.VEXI_VOICE_TRANSCRIBE_FAILED,
        'No pude entender el audio. Prueba de nuevo.',
      );
    }

    return { text: (response.text ?? '').trim() };
  }

  /** Drops any turn the user walked away from. */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, partial] of this.partials) {
      if (partial.expiresAt <= now) this.partials.delete(key);
    }
  }

  private bufferKey(turnId: string): string {
    const userId = RequestContextService.getContext()?.user_id;
    if (!userId) {
      // Without an identity the buffer would be addressable by anyone who
      // guessed the id, which is the one thing the namespacing prevents.
      throw new VendixHttpException(
        ErrorCodes.SYS_UNAUTHORIZED_001,
        'No hay sesión para asociar el turno de voz.',
      );
    }
    return `${userId}:${turnId}`;
  }

  private requireFile(
    file: Express.Multer.File | undefined,
    limit: number,
  ): Buffer {
    if (!file?.buffer?.length) {
      // A multipart request whose `file` part never arrived lands here. The most
      // common cause is a missing FileInterceptor upstream, which leaves the
      // whole body empty rather than just this field.
      throw new VendixHttpException(
        ErrorCodes.VEXI_VOICE_NO_AUDIO,
        'Se esperaba un archivo de audio en el campo "file".',
      );
    }
    this.assertSize(file.buffer, limit);
    return file.buffer;
  }

  private assertSize(buffer: Buffer, limit: number): void {
    if (buffer.length > limit) {
      throw new VendixHttpException(
        ErrorCodes.VEXI_VOICE_TOO_LARGE,
        'El audio excede el tamaño permitido.',
      );
    }
  }

  /**
   * Maps the upload's MIME type to a container name.
   *
   * Rejected rather than guessed when unknown: the transcription endpoint sniffs
   * the filename extension to pick a decoder, so forwarding an unrecognized
   * container produces a provider error the user cannot act on, while refusing
   * here names the actual problem.
   */
  private resolveFormat(file: Express.Multer.File): string {
    const mime = (file.mimetype || '').split(';')[0].trim().toLowerCase();
    const format = ALLOWED_AUDIO_MIME_TYPES[mime];

    if (!format) {
      throw new VendixHttpException(
        ErrorCodes.VEXI_VOICE_INVALID_AUDIO,
        `No puedo leer audio "${mime || 'desconocido'}". Acepto webm, ogg, mp4, m4a, mp3 y wav.`,
      );
    }

    return format;
  }
}
