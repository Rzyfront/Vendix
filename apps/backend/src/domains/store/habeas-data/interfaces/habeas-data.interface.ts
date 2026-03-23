export interface ConsentUpdate {
  consent_type: string;
  granted: boolean;
}

export interface DataExportResult {
  request_id: number;
  status: string;
  download_url?: string;
}

export interface AnonymizationResult {
  request_id: number;
  status: string;
}
