import {
  NormalizedReceivedDocument,
  ReceivedDocumentValidationIssue,
  ReceivedDocumentValidationSummary,
  StructuralValidationStatus,
} from '../interfaces/received-document.interface';

const VERIFICATION_ONLY_WARNING_CODES = new Set([
  'SIGNATURE_NOT_VERIFIED',
  'APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED',
]);

/**
 * Separates local document consistency from signature authenticity and DIAN
 * acceptance. This application currently verifies neither of the latter two.
 */
export function summarizeReceivedDocumentValidation(
  validation: NormalizedReceivedDocument['validation'] | undefined,
): ReceivedDocumentValidationSummary {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : [];
  const hasSignature = validation?.has_signature === true;
  const structuralErrors = [...errors];
  const structuralWarnings = warnings.filter(
    (issue) => !VERIFICATION_ONLY_WARNING_CODES.has(issue.code),
  );
  const hasValidationEvidence = !!validation && Array.isArray(validation.errors) && Array.isArray(validation.warnings);
  const status: StructuralValidationStatus = !hasValidationEvidence
    ? 'pending'
    : structuralErrors.length > 0
    ? 'invalid'
    : structuralWarnings.length > 0
      ? 'needs_review'
      : 'valid';

  return {
    structural: { status, errors: structuralErrors, warnings: structuralWarnings },
    signature: { status: hasSignature ? 'not_verified' : 'unsigned', has_signature: hasSignature },
    dian: {
      status: 'not_checked',
      application_response_unverified: warnings.some(
        (issue) => issue.code === 'APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED',
      ),
    },
    // Preserve the original issues, including verification-only warnings, for
    // existing readers and the audit trail. Never imply they were verified.
    errors: [...errors],
    warnings: [...warnings],
    has_signature: hasSignature,
    document_key_format_valid: validation?.document_key_format_valid === true,
  };
}

/** Legacy records can only be re-evaluated when the preserved summary is complete. */
export function validationFromPreservedSummary(value: unknown): {
  errors: ReceivedDocumentValidationIssue[];
  warnings: ReceivedDocumentValidationIssue[];
  has_signature: boolean;
  document_key_format_valid: boolean;
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.errors) || !Array.isArray(record.warnings) ||
      typeof record.has_signature !== 'boolean' ||
      typeof record.document_key_format_valid !== 'boolean') return undefined;
  const isIssue = (issue: unknown): issue is ReceivedDocumentValidationIssue =>
    !!issue && typeof issue === 'object' && !Array.isArray(issue) &&
    typeof (issue as Record<string, unknown>).code === 'string' &&
    typeof (issue as Record<string, unknown>).message === 'string';
  if (!record.errors.every(isIssue) || !record.warnings.every(isIssue)) return undefined;
  return {
    errors: record.errors,
    warnings: record.warnings,
    has_signature: record.has_signature,
    document_key_format_valid: record.document_key_format_valid,
  };
}

export function operationalValidationStatus(
  summary: ReceivedDocumentValidationSummary,
): 'valid' | 'needs_review' | 'invalid' {
  return summary.structural.status === 'pending' ? 'needs_review' : summary.structural.status;
}

/** Project the canonical validation snapshot into the persisted independent axes. */
export function receivedDocumentValidationSnapshot(
  validation: NormalizedReceivedDocument['validation'] | undefined,
): ReceivedDocumentValidationSummary {
  return summarizeReceivedDocumentValidation(validation);
}
