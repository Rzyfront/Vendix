import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { WORKFLOW_SECRET_NAME_PATTERN } from '@common/workflows/contract';

export const WORKFLOW_SECRET_VALUE_MAX = 4000;

export class CreateWorkflowSecretDto {
  @IsString()
  @Matches(WORKFLOW_SECRET_NAME_PATTERN, {
    message: 'El nombre usa MAYÚSCULAS, números y "_" y empieza con una letra (máximo 60).',
  })
  name!: string;

  @IsString() @MinLength(1) @MaxLength(WORKFLOW_SECRET_VALUE_MAX) value!: string;

  @IsOptional() @IsString() @MaxLength(200) description?: string;
}

export class UpdateWorkflowSecretDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(WORKFLOW_SECRET_VALUE_MAX)
  value?: string;

  @IsOptional() @IsString() @MaxLength(200) description?: string;
}
