import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** No browser-supplied tenant, objective, tool catalog or confidence is accepted. */
export class CreateVoiceConsentSessionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversation_id!: number;

  @IsIn(['vex', 'vexi'])
  agent_key!: 'vex' | 'vexi';

  @IsOptional()
  @IsIn(['pipeline', 'realtime'])
  channel?: 'pipeline' | 'realtime';
}

export class CloseVoiceConsentSessionDto {
  @IsUUID('4')
  session_id!: string;
}

/** Realtime uses proposal_id; a displayed text proposal uses token + arguments. */
export class VoiceConsentChallengeDto extends CloseVoiceConsentSessionDto {
  @IsOptional()
  @IsUUID('4')
  proposal_id?: string;

  @ValidateIf((dto: VoiceConsentChallengeDto) => !dto.proposal_id)
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_]*$/)
  tool?: string;

  @ValidateIf((dto: VoiceConsentChallengeDto) => !dto.proposal_id)
  @IsObject()
  arguments?: Record<string, unknown>;

  @ValidateIf(
    (dto: VoiceConsentChallengeDto) => !dto.proposal_id && !dto.plan_id,
  )
  @IsUUID('4')
  confirmation_token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  plan_id?: string;
}

/** Lifecycle hints are not biometric proof, STT confidence or authentication. */
export class VoiceConsentCaptureDto {
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  dedicated!: boolean;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  foreground!: boolean;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  focused!: boolean;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  assistantSilent!: boolean;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  noBargeIn!: boolean;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  notEcho!: boolean;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  reconnected!: boolean;
}

function captureInstance(value: unknown): unknown {
  try {
    const parsed: unknown =
      typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return value;
    return plainToInstance(VoiceConsentCaptureDto, parsed, {
      enableImplicitConversion: false,
    });
  } catch {
    return value;
  }
}

/** Audio is multipart binary handled by FileInterceptor; never transcript/confidence. */
export class ConsumeVoiceConsentDto extends CloseVoiceConsentSessionDto {
  @IsUUID('4')
  proposal_id!: string;

  @IsUUID('4')
  challenge_id!: string;

  @Transform(({ value }) => captureInstance(value))
  @ValidateNested()
  @IsObject()
  capture!: VoiceConsentCaptureDto;

  @IsOptional()
  @Transform(({ obj, key }) =>
    obj[key] === 'true' ? true : obj[key] === 'false' ? false : obj[key],
  )
  @IsBoolean()
  speak?: boolean;
}

/** Click alternative for a server-held realtime proposal; not spoken consent. */
export class ApplyVoiceConsentProposalDto extends CloseVoiceConsentSessionDto {
  @IsUUID('4')
  proposal_id!: string;

  @IsOptional()
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  speak?: boolean;
}
