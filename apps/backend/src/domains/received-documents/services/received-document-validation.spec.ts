import { NormalizedReceivedDocument } from '../interfaces/received-document.interface';
import {
  operationalValidationStatus,
  summarizeReceivedDocumentValidation,
  validationFromPreservedSummary,
} from './received-document-validation';

const validation: NormalizedReceivedDocument['validation'] = {
  errors: [],
  warnings: [],
  has_signature: false,
  document_key_format_valid: true,
};

describe('received document validation axes', () => {
  it('keeps a signed structurally valid XML operationally valid and warns signature is unverified', () => {
    const summary = summarizeReceivedDocumentValidation({
      ...validation,
      has_signature: true,
      warnings: [{ code: 'SIGNATURE_NOT_VERIFIED', message: 'signature present' }],
    });

    expect(summary.structural.status).toBe('valid');
    expect(operationalValidationStatus(summary)).toBe('valid');
    expect(summary.signature).toEqual({ status: 'not_verified', has_signature: true });
    expect(summary.dian.status).toBe('not_checked');
    expect(summary.warnings).toEqual([{ code: 'SIGNATURE_NOT_VERIFIED', message: 'signature present' }]);
  });

  it('preserves unverified ApplicationResponse evidence without making it a structural review blocker', () => {
    const summary = summarizeReceivedDocumentValidation({
      ...validation,
      warnings: [{ code: 'APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED', message: 'evidence' }],
    });
    expect(summary.structural.status).toBe('valid');
    expect(summary.dian).toMatchObject({ status: 'not_checked', application_response_unverified: true });
    expect(summary.warnings).toHaveLength(1);
  });

  it('continues blocking on structural errors and non-verification warnings', () => {
    expect(operationalValidationStatus(summarizeReceivedDocumentValidation({
      ...validation,
      errors: [{ code: 'BAD_NIT', message: 'invalid NIT' }],
      warnings: [{ code: 'SIGNATURE_NOT_VERIFIED', message: 'not checked' }],
    }))).toBe('invalid');
    expect(operationalValidationStatus(summarizeReceivedDocumentValidation({
      ...validation,
      warnings: [{ code: 'TAX_BREAKDOWN_MISSING', message: 'missing tax rows' }],
    }))).toBe('needs_review');
  });

  it('re-evaluates a complete preserved historical summary but rejects incomplete evidence', () => {
    const complete = {
      errors: [], warnings: [{ code: 'SIGNATURE_NOT_VERIFIED', message: 'unverified' }],
      has_signature: true, document_key_format_valid: true,
    };
    expect(validationFromPreservedSummary(complete)).toEqual(complete);
    expect(operationalValidationStatus(summarizeReceivedDocumentValidation(
      validationFromPreservedSummary(complete),
    ))).toBe('valid');
    expect(validationFromPreservedSummary({ errors: [], warnings: [] })).toBeUndefined();
    expect(validationFromPreservedSummary(null)).toBeUndefined();
  });
});
