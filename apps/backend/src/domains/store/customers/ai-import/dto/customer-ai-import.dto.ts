import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const IMPORT_MAX_CUSTOMERS = 200;
export const IMPORT_MAX_LOCATIONS = 50;

export type ImportPersonType = 'NATURAL' | 'JURIDICA';
export type ImportCommitAction =
  | 'create'
  | 'add_locations'
  | 'update_and_add_locations'
  | 'skip';

export const IMPORT_COMMIT_ACTIONS: ImportCommitAction[] = [
  'create',
  'add_locations',
  'update_and_add_locations',
  'skip',
];

// ── Normalized scan shapes (AI output after normalization) ────────────────

export interface ImportLocation {
  label: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  municipality_code: string | null;
  phone: string | null;
}

export interface ImportCustomer {
  person_type: ImportPersonType | null;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
  email: string | null;
  phone: string | null;
  locations: ImportLocation[];
}

export interface CustomerImportScanResult {
  customers: ImportCustomer[];
  warnings: string[];
}

// ── Request DTOs ──────────────────────────────────────────────────────────

export class ImportLocationDto {
  @IsOptional() @IsString() @MaxLength(120) label?: string | null;
  @IsOptional() @IsString() @MaxLength(255) address_line_1?: string | null;
  @IsOptional() @IsString() @MaxLength(255) address_line_2?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(100) state?: string | null;
  @IsOptional() @IsString() @MaxLength(10) municipality_code?: string | null;
  @IsOptional() @IsString() @MaxLength(50) phone?: string | null;
}

export class ImportCustomerDto {
  @IsOptional()
  @IsIn(['NATURAL', 'JURIDICA'])
  person_type?: ImportPersonType | null;

  @IsOptional() @IsString() @MaxLength(255) first_name?: string | null;
  @IsOptional() @IsString() @MaxLength(255) last_name?: string | null;
  @IsOptional() @IsString() @MaxLength(255) legal_name?: string | null;
  @IsOptional() @IsString() @MaxLength(10) document_type?: string | null;
  @IsOptional() @IsString() @MaxLength(50) document_number?: string | null;
  @IsOptional() @IsString() @MaxLength(2) verification_digit?: string | null;
  @IsOptional() @IsString() @MaxLength(255) email?: string | null;
  @IsOptional() @IsString() @MaxLength(50) phone?: string | null;

  @IsArray()
  @ArrayMaxSize(IMPORT_MAX_LOCATIONS)
  @ValidateNested({ each: true })
  @Type(() => ImportLocationDto)
  locations: ImportLocationDto[];
}

export class AnalyzeCustomerImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_MAX_CUSTOMERS)
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerDto)
  customers: ImportCustomerDto[];
}

export class CommitCustomerItemDto extends ImportCustomerDto {
  @IsIn(IMPORT_COMMIT_ACTIONS)
  action: ImportCommitAction;

  @IsOptional()
  @IsInt()
  @Min(1)
  existing_customer_id?: number | null;
}

export class CommitCustomerImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_MAX_CUSTOMERS)
  @ValidateNested({ each: true })
  @Type(() => CommitCustomerItemDto)
  customers: CommitCustomerItemDto[];
}

// ── Response shapes ───────────────────────────────────────────────────────

export type ImportRowStatus = 'ready' | 'warning' | 'error';

export interface ImportExistingLocation {
  id: number;
  label: string | null;
  address_line1: string | null;
  city: string | null;
}

export interface ImportCustomerMatch {
  existing_customer_id: number;
  display_name: string;
  in_store: boolean;
  existing_locations: ImportExistingLocation[];
  /** S8 — dato(s) por los que coincide: identificación y/o correo. */
  matched_by: ('document' | 'email')[];
  /** Otros clientes que también coinciden (p. ej. el correo es de otro). */
  other_matches: {
    id: number;
    display_name: string;
    matched_by: ('document' | 'email')[];
  }[];
}

export interface AnalyzedImportLocation extends ImportLocation {
  already_registered: boolean;
  status: ImportRowStatus;
  messages: string[];
}

export interface AnalyzedImportCustomer
  extends Omit<ImportCustomer, 'locations'> {
  locations: AnalyzedImportLocation[];
  match: ImportCustomerMatch | null;
  status: ImportRowStatus;
  messages: string[];
}

export interface CustomerImportAnalysis {
  customers: AnalyzedImportCustomer[];
  summary: {
    total_customers: number;
    total_locations: number;
    existing: number;
    with_errors: number;
  };
}

export type CommitCustomerOutcome =
  | 'created'
  | 'updated'
  | 'locations_added'
  | 'skipped'
  | 'failed';

export interface CommitCustomerResult {
  index: number;
  display_name: string;
  outcome: CommitCustomerOutcome;
  customer_id: number | null;
  locations_added: number;
  locations_already_registered: number;
  location_errors: string[];
  error: string | null;
}

export interface CommitCustomerImportResult {
  created: number;
  updated: number;
  locations_added: number;
  locations_already_registered: number;
  skipped: number;
  failed: number;
  results: CommitCustomerResult[];
}
