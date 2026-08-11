import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class PosContextDto {
  @IsOptional()
  @IsNumber()
  item_count?: number;

  @IsOptional()
  @IsNumber()
  total?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customer?: string | null;
}

class HiddenModuleDto {
  @IsString()
  @MaxLength(80)
  key!: string;

  @IsString()
  @MaxLength(40)
  blocked_by!: string;
}

/**
 * The screen the user is looking at, as reported by the browser.
 *
 * Validated for shape and size only. It is prompt material, never an
 * authorization input — see `VexiUiContext`. The length caps exist so a
 * malformed or hostile client cannot push the real conversation out of the
 * context window with a giant module list.
 */
export class UiContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visible_modules?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HiddenModuleDto)
  hidden_modules?: HiddenModuleDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PosContextDto)
  pos?: PosContextDto;
}

/**
 * Body of the handshake that precedes the SSE connection. Returns a `stream_id`
 * the browser puts in the EventSource URL, so the prompt itself never lands in
 * an access log.
 */
export class StreamIntentDto {
  @IsString()
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => UiContextDto)
  ui_context?: UiContextDto;

  /**
   * Documents the person attached to this specific message.
   *
   * Handles only (`att_41`), never bytes: the file was uploaded beforehand to
   * `POST /store/vexi/attachments`, which is what keeps the SSE handshake a small
   * JSON body. Travels with the turn for the same reason `ui_context` does — a
   * document sent out of band could attach itself to a message the person already
   * moved past.
   *
   * Capped at five because the vision applications process one document per call
   * and a person genuinely handing over more than five in one message is asking
   * for a bulk upload, which has its own flow.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  attachment_ids?: string[];

  /**
   * Asks for the answer to be spoken as well as written.
   *
   * Per turn rather than per conversation, because the person can switch between
   * chat and voice mode inside the same thread — the previous turn being spoken
   * says nothing about this one.
   *
   * Only adds audio frames; it never changes the text, the tools, or what gets
   * persisted. That is the premise of the pipeline: a voice turn *is* a chat
   * turn, so nothing about the answer depends on how it will be delivered.
   */
  @IsOptional()
  @IsBoolean()
  speak?: boolean;

  /**
   * Replay of a turn whose transport dropped before it produced anything.
   *
   * The `user` row is written before the model is called, so a turn that died
   * mid-flight already left it in the conversation. Without this flag the
   * automatic retry would write it again and the person would see their question
   * twice — the one visible trace a transparent recovery must not leave.
   *
   * The client is trusted with it because the worst it can do is *omit* a row
   * whose content it supplied anyway. It cannot forge history, skip a guard, or
   * reach another conversation: everything else about the turn is resolved
   * server-side from the conversation id and the session.
   */
  @IsOptional()
  @IsBoolean()
  skip_user_message?: boolean;
}
