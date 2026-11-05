import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WORKFLOW_KEY_PATTERN } from '@common/workflows/contract';

export class CreateWorkGroupDto {
  @IsString() @Matches(WORKFLOW_KEY_PATTERN, {
    message: 'La clave solo admite minúsculas, números, guion y guion bajo.',
  })
  key!: string;
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(['any', 'round_robin', 'least_load']) assignment_strategy?:
    | 'any'
    | 'round_robin'
    | 'least_load';
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class UpdateWorkGroupDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(['any', 'round_robin', 'least_load']) assignment_strategy?:
    | 'any'
    | 'round_robin'
    | 'least_load';
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class WorkGroupMemberDto {
  @IsOptional() @IsBoolean() is_lead?: boolean;
  @IsOptional() @IsBoolean() is_available?: boolean;
}
