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
import {
  BulkFileHashField,
  BulkFileNameField,
} from '../../../bulk-uploads/dto/bulk-upload-log.dto';

/** Customers per `analyze` / `commit` request; the web sends bigger loads in chunks. */
export const IMPORT_MAX_CUSTOMERS = 200;
export const IMPORT_MAX_LOCATIONS = 50;
/** Data rows read from one spreadsheet (ia-cargas F1; it used to be 200 customers). */
export const IMPORT_MAX_SHEET_ROWS = 5000;
/** Source row numbers kept per customer (rows merged by document). */
export const IMPORT_MAX_SOURCE_ROWS = 500;

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
  /** Spreadsheet rows this customer came from (absent for images/PDF). */
  source_rows?: number[];
  /** Sheet name, only for workbooks with several sheets. */
  source_sheet?: string;
}

/** A row that did not become a customer, with the reason (nothing is dropped silently). */
export interface ImportSkippedRow {
  row: number;
  row_end?: number;
  sheet?: string;
  reason: 'empty' | 'total' | 'header' | 'limit' | 'unreadable' | 'duplicate';
  message: string;
}

/** Something the user should check on a source row (it was still imported). */
export interface ImportRowIssue {
  row: number;
  sheet?: string;
  level: 'warning' | 'error';
  field?: string;
  message: string;
}

export interface ImportColumnMapping {
  sheet?: string;
  column: string;
  /** Customer field, or null when the column was ignored. */
  field: string | null;
}

export interface CustomerImportScanResult {
  customers: ImportCustomer[];
  warnings: string[];
  /** ia-cargas F1 — all optional so old clients keep working. */
  skipped?: ImportSkippedRow[];
  row_issues?: ImportRowIssue[];
  columns?: ImportColumnMapping[];
  stats?: {
    source: 'sheet' | 'document';
    total_rows: number;
    imported_rows: number;
    skipped_rows: number;
    /** Rows whose ambiguous cells went to the model. */
    ai_rows: number;
    /** How the columns were recognized. */
    mapping: 'synonyms' | 'ai' | null;
    /** ia-cargas F2 — images/PDF: pages (or photo strips) read. */
    pages?: number;
    /** Pages read from the PDF native text, without an image. */
    text_pages?: number;
  };
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

  /** Echo of the scan, so the preview keeps the source row numbers. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(IMPORT_MAX_SOURCE_ROWS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  source_rows?: number[];

  @IsOptional() @IsString() @MaxLength(120) source_sheet?: string;

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

  /** QUI-1004 — devueltos por `async` para el registro de cargas masivas. */
  @BulkFileNameField()
  file_name?: string;

  @BulkFileHashField()
  file_hash?: string;

  /**
   * ia-cargas F1 — a load bigger than one request is committed in chunks with
   * the same id, so the upload log keeps ONE row for the whole file.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  session_id?: string;

  /** Customers of the whole load (all chunks), for the upload log. */
  @IsOptional()
  @IsInt()
  @Min(1)
  total_customers?: number;
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
