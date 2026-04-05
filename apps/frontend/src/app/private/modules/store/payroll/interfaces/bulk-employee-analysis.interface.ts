export interface BulkEmployeeAnalysisItem {
  row_number: number;
  name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  base_salary: number;
  position?: string;
  department?: string;
  contract_type: string;
  is_user: boolean;
  email?: string;
  action: 'create' | 'update' | 'associate';
  status: 'ready' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

export interface BulkEmployeeAnalysisResult {
  session_id: string;
  total_employees: number;
  ready: number;
  with_warnings: number;
  with_errors: number;
  employees: BulkEmployeeAnalysisItem[];
}

export interface BulkEmployeeUploadItemResult {
  employee_name?: string;
  document_number?: string;
  action?: 'created' | 'updated' | 'associated';
  employee: any;
  status: 'success' | 'error';
  message: string;
  user_created?: boolean;
  user_linked?: boolean;
}

export interface BulkEmployeeUploadResult {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  users_created: number;
  users_linked: number;
  updated?: number;
  associated?: number;
  results: BulkEmployeeUploadItemResult[];
}
