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

export type FiscalScopeValue = 'STORE' | 'ORGANIZATION';

export class ChangeFiscalScopeDto {
  @ApiProperty({
    enum: ['STORE', 'ORGANIZATION'],
    description: 'Target fiscal_scope to migrate the organization to.',
  })
  @IsEnum(['STORE', 'ORGANIZATION'] as any, {
    message: 'target_scope must be STORE or ORGANIZATION',
  })
  target_scope!: FiscalScopeValue;

  @ApiPropertyOptional({
    description:
      'Optional free-text justification recorded in fiscal_scope_audit_log. ' +
      'Required when force=true.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ValidateIf((o: ChangeFiscalScopeDto) => o.force === true)
  @IsNotEmpty({
    message: 'Reason is required when force=true (min 10 characters).',
  })
  @MinLength(10, {
    message: 'Reason must be at least 10 characters when force=true.',
  })
  reason?: string;

  @ApiPropertyOptional({
    description:
      'Force-apply a fiscal DOWN migration when blockers exist. Invalid scope combinations cannot be forced.',
    type: Boolean,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
