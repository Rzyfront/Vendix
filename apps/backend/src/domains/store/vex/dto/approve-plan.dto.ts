import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_PLAN_STEPS } from '../../../../ai-engine/tools/domains/planning.tools';

/**
 * One reversible-or-not step the person is approving sight unseen as a bundle.
 *
 * The arguments travel with the approval because the plan token stores only
 * hashes, never the payload — same doctrine as `ApplyConfirmationDto`: at apply
 * time the server verifies that each step is byte-for-byte the change that was
 * shown, instead of trusting a server-side copy.
 */
export class PlanApprovalStepDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order!: number;

  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'tool must be a snake_case tool identifier',
  })
  tool!: string;

  @IsObject()
  arguments!: Record<string, unknown>;
}

/**
 * Approval of a whole Vex plan in one click.
 *
 * `plan_id` travels in the route (`POST plans/:id/approve`); the body carries
 * the conversation it belongs to plus the exact steps shown on the plan card,
 * so the issued token binds user + ordered step hashes and nothing else.
 */
export class ApprovePlanDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversation_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PLAN_STEPS)
  @ValidateNested({ each: true })
  @Type(() => PlanApprovalStepDto)
  steps!: PlanApprovalStepDto[];
}
