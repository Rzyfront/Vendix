import { Type } from 'class-transformer';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { WORKFLOW_ACTIONS } from '@common/workflows/contract';

/** The action as it sits in the definition (`vendix.workflow/v1`). */
export class WorkflowActionTestActionDto {
  @IsIn(WORKFLOW_ACTIONS as readonly string[])
  action!: string;

  /** Vendix actions. */
  @IsOptional() @IsObject() map?: Record<string, unknown>;
  @IsOptional() @IsObject() output?: Record<string, string>;
  @IsOptional() @IsObject() on_error?: Record<string, unknown>;

  /** `notify`. */
  @IsOptional() @IsObject() to?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500) message?: string;

  /** `set_field`. */
  @IsOptional() @IsString() @MaxLength(80) field?: string;
  @IsOptional() value?: string | number | boolean | null;
}

export class WorkflowActionTestInstanceDto {
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
}

/** Body of `POST store/workflows/actions/test`. */
export class WorkflowActionTestDto {
  @ValidateNested()
  @Type(() => WorkflowActionTestActionDto)
  action!: WorkflowActionTestActionDto;

  /** Sample form values: what `{{fields.*}}` resolves to. */
  @IsOptional() @IsObject() data?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => WorkflowActionTestInstanceDto)
  instance?: WorkflowActionTestInstanceDto;
}
