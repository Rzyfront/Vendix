import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type OperatingScopeValue = 'STORE' | 'ORGANIZATION';

/**
 * Payload for both `preview` and `apply` of the operating-scope wizard.
 *
 * `target_scope` is mandatory.
 *
 * `reason` is optional free-text persisted into `operating_scope_audit_log.reason`
 * for traceability **except** when `force=true` is supplied — in that case the
 * reason becomes REQUIRED (Plan P4.5 §13 #3 — double-confirmation + audit) and
 * must be at least 10 characters.
 *
 * `force` is the server-authoritative bypass for downgrade blockers
 * (Plan §6.5.4): when at least one of the 4 blockers (open POs to central,
 * cross-store transfers, stock at central, active reservations at central) is
 * present, the wizard caller MUST opt-in with `force=true` and a justification
 * `reason`. Both the override and the original blocker snapshot are persisted
 * to `audit_logs` via {@link AuditService}.
 */
export class ChangeOperatingScopeDto {
  @ApiProperty({
    enum: ['STORE', 'ORGANIZATION'],
    description: 'Target operating_scope to migrate the organization to.',
  })
  @IsEnum(['STORE', 'ORGANIZATION'] as any, {
    message: 'target_scope must be STORE or ORGANIZATION',
  })
  target_scope!: OperatingScopeValue;

  @ApiPropertyOptional({
    description:
      'Optional free-text justification recorded in operating_scope_audit_log. ' +
      'REQUIRED (min 10 chars) when force=true.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ValidateIf((o: ChangeOperatingScopeDto) => o.force === true)
  @IsNotEmpty({
    message: 'Reason is required when force=true (min 10 characters).',
  })
  @MinLength(10, {
    message: 'Reason must be at least 10 characters when force=true.',
  })
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Force-apply the downgrade even when server-authoritative blockers ' +
      '(open POs to central, cross-store transfers, stock at central, active ' +
      'reservations at central) are present. Requires `reason` (min 10 chars). ' +
      'Logs both the override and the blocker snapshot to audit_logs.',
    type: Boolean,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
