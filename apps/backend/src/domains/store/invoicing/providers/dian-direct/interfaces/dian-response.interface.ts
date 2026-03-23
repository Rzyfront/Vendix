/**
 * Parsed response from DIAN's ApplicationResponse XML.
 */
export interface DianApplicationResponse {
  /** Whether the document was accepted */
  is_valid: boolean;
  /** DIAN status code */
  status_code: string;
  /** Status description */
  status_description: string;
  /** List of validation errors/warnings */
  errors: DianValidationError[];
  /** CUFE/CUDE assigned by DIAN */
  document_key?: string;
  /** Raw XML response */
  raw_xml: string;
}

export interface DianValidationError {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Response from DIAN's SendBillSync operation.
 */
export interface DianSendBillResponse {
  /** Whether the SOAP call succeeded */
  success: boolean;
  /** Status code from DIAN (00 = accepted) */
  status_code: string;
  /** Status message */
  status_message: string;
  /** The ApplicationResponse XML (base64 decoded) */
  application_response?: DianApplicationResponse;
  /** Raw SOAP response XML */
  raw_response: string;
  /** Request duration in ms */
  duration_ms: number;
  /** Whether the response is a SOAP Fault (e.g., InvalidSecurity) */
  is_soap_fault?: boolean;
}

/**
 * Response from DIAN's GetStatus operation.
 */
export interface DianGetStatusResponse {
  success: boolean;
  status_code: string;
  status_message: string;
  is_valid: boolean;
  errors: DianValidationError[];
  raw_response: string;
}

/**
 * Response from DIAN's SendTestSetAsync operation.
 */
export interface DianTestSetResponse {
  success: boolean;
  test_set_id: string;
  tracking_id: string;
  message: string;
  raw_response: string;
}
