import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  ACCESS_AUDIT_DECISIONS,
  ACCESS_AUDIT_LAYERS,
  ACCESS_AUDIT_SURFACES,
  AccessAuditDecision,
  AccessAuditLayer,
  AccessAuditSurface,
} from '../access-audit.types';

/** Surfaces a browser can report ('api' is backend-only). */
export const FRONTEND_AUDIT_SURFACES = ACCESS_AUDIT_SURFACES.filter(
  (s) => s !== 'api',
);

/** Identity is never part of the body: the backend takes it from the JWT. */
export class AccessAuditEventDto {
  @IsString()
  @Matches(/^[a-z0-9_]{1,64}$/)
  key!: string;

  @IsIn([...ACCESS_AUDIT_DECISIONS])
  decision!: AccessAuditDecision;

  @IsIn([...ACCESS_AUDIT_LAYERS])
  layer!: AccessAuditLayer;

  @IsIn(FRONTEND_AUDIT_SURFACES)
  surface!: Exclude<AccessAuditSurface, 'api'>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string;
}

export class AccessAuditBatchDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AccessAuditEventDto)
  events!: AccessAuditEventDto[];
}
