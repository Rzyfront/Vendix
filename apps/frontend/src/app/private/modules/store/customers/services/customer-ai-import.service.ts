import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  AiScanJobOptions,
  AiScanJobService,
} from '../../../../../core/services/ai-scan-job.service';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export type ImportPersonType = 'NATURAL' | 'JURIDICA';
export type ImportRowStatus = 'ready' | 'warning' | 'error';
export type ImportCommitAction =
  | 'create'
  | 'add_locations'
  | 'update_and_add_locations'
  | 'skip';

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

/** Cuerpo de `commit`: el backend rechaza campos no declarados. */
export interface CommitCustomerItem extends ImportCustomer {
  action: ImportCommitAction;
  existing_customer_id: number | null;
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

/**
 * Carga de clientes con IA (S7): escaneo async -> analisis -> commit.
 * Nada se persiste hasta `commit`. Permiso: `store:customers:create`.
 */
@Injectable({ providedIn: 'root' })
export class CustomerAiImportService {
  private readonly apiUrl = `${environment.apiUrl}/store/customers/ai-import`;
  private readonly http = inject(HttpClient);
  private readonly aiScanJobs = inject(AiScanJobService);

  scan(
    file: File,
    opts?: AiScanJobOptions,
  ): Observable<ApiResponse<CustomerImportScanResult>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.aiScanJobs
      .enqueueAndWait<CustomerImportScanResult>(
        `${this.apiUrl}/async`,
        formData,
        opts,
      )
      .pipe(map((result) => ({ success: true, data: result })));
  }

  analyze(
    customers: ImportCustomer[],
  ): Observable<ApiResponse<CustomerImportAnalysis>> {
    return this.http.post<ApiResponse<CustomerImportAnalysis>>(
      `${this.apiUrl}/analyze`,
      { customers },
    );
  }

  commit(
    customers: CommitCustomerItem[],
  ): Observable<ApiResponse<CommitCustomerImportResult>> {
    return this.http.post<ApiResponse<CommitCustomerImportResult>>(
      `${this.apiUrl}/commit`,
      { customers },
    );
  }
}
