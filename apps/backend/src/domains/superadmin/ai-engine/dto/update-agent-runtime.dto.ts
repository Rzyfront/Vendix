import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AgentVoiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  voice?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  vol?: number;
}

/** Body of `PATCH superadmin/ai-engine/agent-runtime/:agentKey`. */
export class UpdateAgentRuntimeDto {
  /** Model/provider: points the agent's app at another engine config. */
  @IsOptional()
  @IsInt()
  @Min(1)
  config_id?: number;

  @IsOptional()
  @IsString()
  system_prompt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  allowed_tools?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  denied_tools?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  max_iterations?: number | null;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(600)
  timeout_seconds?: number | null;

  /** `null` removes the agent's override and falls back to the base voice. */
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentVoiceDto)
  voice?: AgentVoiceDto | null;

  /** F8 T49 — catalog voice of this agent; `null` goes back to the fallback. */
  @IsOptional()
  @IsInt()
  @Min(1)
  voice_profile_id?: number | null;
}

export class VoicePreviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  text?: string;
}
