import { receivedDianLabel, receivedDocumentSourceLabel, receivedIsElectronicPos, receivedMobileInboxLabel, receivedReceiptEvidence } from './received-documents-inbox-projection.util';
import { RECEIVED_EMAIL_REASON_CODES, type ReceivedEmailMessage, type ReceivedEmailStatus } from './received-email-reception.interface';
import { RECEIVED_EMAIL_DIAN_BADGE, RECEIVED_EMAIL_REASON_COPY, projectReceivedEmailMessage, receivedEmailReason, receivedEmailStatusCopy, receivedEmailUsableCode } from './received-email-reception-projection.util';

const status: ReceivedEmailStatus = {
  pilot_available: true, configured: true, enabled: true, active_inboxes: 1, state: 'waiting',
  first_valid_received_at: null, last_email_at: null, last_valid_received_at: null, last_error_code: null, not_processed_count: 0,
};

describe('received email reception display contracts', () => {
  it('covers all 32 closed reason codes with human copy and an explicit action', () => {
    expect(RECEIVED_EMAIL_REASON_CODES.length).toBe(32);
    expect(Object.keys(RECEIVED_EMAIL_REASON_COPY).sort()).toEqual([...RECEIVED_EMAIL_REASON_CODES].sort());
    for (const code of RECEIVED_EMAIL_REASON_CODES) {
      const item = receivedEmailReason(code);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.actionLabel.length).toBeGreaterThan(0);
      expect(`${item.title} ${item.description} ${item.actionLabel}`).not.toMatch(/\b(?:SNS|SES|SQS|MIME|AttachedDocument|CUFE|CUDE|webhook|ledger|lease|intake|canonical|lineage|seam)\b/i);
    }
    expect(RECEIVED_EMAIL_DIAN_BADGE).toBe('Sin verificar ante la DIAN');
  });

  it('shows only bounded authorized identity details and never raw markup or keys', () => {
    expect(receivedEmailReason('RECEIVER_MISMATCH', { receiver_tax_id: '900.123.456-8', expected_receiver_tax_id: '800765432' }).description)
      .toContain('El archivo indica 900.123.456-8; tu negocio usa 800765432');
    const unsafe = receivedEmailReason('RECEIVER_MISMATCH', { receiver_tax_id: '<script>secret</script>', expected_receiver_tax_id: '1'.repeat(100) });
    expect(unsafe.description).not.toContain('script');
    expect(unsafe.description).not.toContain('1'.repeat(100));
    expect(receivedEmailReason('DUPLICATE_OTHER_STORE').action).toBe('administrator');
  });

  it('does not call transport working for advertising/challenge-only intake or imply DIAN validation', () => {
    expect(receivedEmailStatusCopy({ ...status, last_email_at: '2026-10-13T10:00:00Z' }).title).toBe('Esperando tu primera factura');
    const working = receivedEmailStatusCopy({ ...status, state: 'working', first_valid_received_at: '2026-10-13T10:00:00Z', last_valid_received_at: '2026-10-13T10:00:00Z' }, Date.parse('2026-10-13T12:00:00Z'));
    expect(working.title).toBe('Funcionando · última factura hace 2 h');
    expect(working.description).toContain('no están verificados');
    expect(receivedEmailStatusCopy({ ...status, state: 'paused', enabled: false }).title).toBe('Pausado');
    expect(receivedEmailStatusCopy({ ...status, pilot_available: false }).title).toContain('no disponible');
    expect(receivedEmailStatusCopy({ ...status, state: 'attention', not_processed_count: 3 }).title).toContain('(3)');
  });

  it('displays only an available unexpired numeric Gmail code, never a confirmation URL', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    expect(receivedEmailUsableCode({ available: true, code: '123456', expires_at: '2026-10-13T12:01:00Z' }, now)).toBe('123456');
    expect(receivedEmailUsableCode({ available: true, code: '123456', expires_at: '2026-10-13T12:00:00Z' }, now)).toBeNull();
    expect(receivedEmailUsableCode({ available: true, code: 'https://attacker.example/confirm', expires_at: '2026-10-14T12:00:00Z' }, now)).toBeNull();
    expect(receivedEmailUsableCode({ available: false, code: '123456', expires_at: '2026-10-14T12:00:00Z' }, now)).toBeNull();
  });

  it('whitelists history metadata and drops hidden document IDs, facts, checkpoints and raw content', () => {
    const unsafe = {
      id: 1, version: 2, received_at: '2026-10-13T12:00:00Z', processed_at: null, status: 'processed',
      reason_code: 'DUPLICATE_OTHER_STORE', retryable: false, can_retry: false, archived_at: null,
      sender: 'sender@example.test', subject: 'Factura', raw_body: 'private body', alias: 'private alias', gmail_code: '123456',
      parts: [{ message_index: 0, ordinal: 1, filename: 'invoice.xml', kind: 'xml', status: 'processed',
        reason_code: 'DUPLICATE_OTHER_STORE', document_id: 999, transport_facts: { secret: true },
        originals_checkpoint: [{ sha256: 'private hash' }], facts: { hidden: true }, raw_html: '<b>private</b>',
        reason_details: { receiver_tax_id: '900123456', expected_receiver_tax_id: '800765432', hidden_id: 999 } }],
    } as unknown as ReceivedEmailMessage;
    const projected = projectReceivedEmailMessage(unsafe);
    expect(projected.parts[0].document_id).toBeUndefined();
    const serialized = JSON.stringify(projected);
    for (const forbidden of ['raw_body', 'alias', 'gmail_code', 'transport_facts', 'originals_checkpoint', 'facts', 'raw_html', 'hidden_id']) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    expect(projected.parts[0].reason_details).toEqual({ receiver_tax_id: '900123456', expected_receiver_tax_id: '800765432' });
  });
});


describe('received invoice email trace display projections', () => {
  it('keeps all DIAN states, missing and invented verification codes unverified', () => {
    for (const code of [undefined, null, 'not_checked', 'accepted', 'verified', 'INVENTED_CODE'])
      expect(receivedDianLabel({ dian_validation_status: code })).toBe('Sin verificar ante la DIAN');
    expect(receivedMobileInboxLabel('new')).toBe('Nueva · Sin verificar ante la DIAN');
    expect(receivedMobileInboxLabel('requires_review')).toBe('Requiere revisión · Sin verificar ante la DIAN');
  });
  it('labels electronic POS only from server-authored fiscal markers without altering invoice facts', () => {
    expect(receivedIsElectronicPos({ fiscal_document_type_code: '20' })).toBe(true);
    expect(receivedIsElectronicPos({ fiscal_document_type_code: '01' })).toBe(false);
    expect(receivedIsElectronicPos({})).toBe(false);
    const doc = { fiscal_document_type_code: '01', email_reception: { document_type_code: '20', profile_execution_id: '1', uuid_scheme_name: 'CUDE-SHA384', receipt_evidence: { included: false, reference_matches: false, response_code: null } } };
    expect(receivedIsElectronicPos(doc)).toBe(true);
    expect(doc.fiscal_document_type_code).toBe('01');
  });
  it('distinguishes declared email from actual transport and preserves historical API source', () => {
    expect(receivedDocumentSourceLabel({ source_channel: 'email' })).toBe('Correo (origen declarado)');
    expect(receivedDocumentSourceLabel({ source_channel: 'email', email_transport_received: false })).toBe('Correo (origen declarado)');
    expect(receivedDocumentSourceLabel({ source_channel: 'email', email_transport_received: true })).toBe('Correo');
    const historical = { source_channel: 'api', email_transport_received: true };
    expect(receivedDocumentSourceLabel(historical)).toBe('Correo · origen inicial: API de proveedor');
    expect(historical.source_channel).toBe('api');
    expect(receivedDocumentSourceLabel({ source_channel: 'api' })).toBe('API de proveedor');
  });
  it('copies receipt evidence safe fields only, never AR XML, checkpoints or a claim of acceptance', () => {
    const doc = { email_reception: { document_type_code: '01', profile_execution_id: '1', uuid_scheme_name: 'CUFE-SHA384',
      receipt_evidence: { included: true, reference_matches: true, response_code: '02', raw_ar: '<ApplicationResponse/>', originals_checkpoint: [{ secret: true }] } } };
    expect(receivedReceiptEvidence(doc)).toEqual({ included: true, reference_matches: true, response_code: '02' });
    expect(receivedReceiptEvidence({})).toBeNull();
    const evidence = { ...doc.email_reception, receipt_evidence: { included: true, reference_matches: false, response_code: '<script>private</script>' } };
    expect(receivedReceiptEvidence({ email_reception: evidence })).toEqual({ included: true, reference_matches: false, response_code: null });
    expect(receivedReceiptEvidence({ email_reception: { ...evidence, receipt_evidence: { included: true, reference_matches: false, response_code: 'x'.repeat(33) } } })?.response_code).toBeNull();
  });
});
