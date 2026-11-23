import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const SKILL_KEY_REGEX = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class CreateAISkillDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(SKILL_KEY_REGEX, {
    message: 'key must be a kebab-case slug (e.g. cierre-de-caja)',
  })
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  module?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60000)
  body: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  candidate_tools?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  help_article_id?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  video_id?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  agent_keys?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  change_note?: string | null;
}

/** Every field optional: omitted fields keep the current value. */
export class UpdateAISkillDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  module?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  candidate_tools?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  help_article_id?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  video_id?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  agent_keys?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  change_note?: string | null;
}

export class AISkillQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  module?: string;

  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: 'draft' | 'published' | 'archived';
}

export class SearchTestAISkillDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query: string;
}

export class SkillDiffQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  from: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  to: number;
}
