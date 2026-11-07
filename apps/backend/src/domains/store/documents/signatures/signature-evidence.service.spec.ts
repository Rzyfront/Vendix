import 'reflect-metadata';

jest.mock('../../../../messaging/messaging.service', () => ({ MessagingService: class {} }));
jest.mock('../../../../email/email.service', () => ({ EmailService: class {} }));

import { canonicalJson, EvidenceRow, verifyEvidenceChain } from './signature-evidence.service';
import { buildSignatureKit, SignatureKit } from './signatures.testkit';

describe('Signature evidence chain (P4.2)', () => {
  let k: SignatureKit;

  const append = (type: any, payload: Record<string, unknown> = {}, signer_id: number | null = null) =>
    k.kit.prisma.$transaction((tx: any) =>
      k.evidence.append(tx, { request_id: 1, signer_id, type, ip_address: '203.0.113.7', user_agent: 'UA', payload }),
    );

  beforeEach(() => {
    k = buildSignatureKit();
    k.asAdmin();
    k.kit.db.insert('signature_requests', {
      id: 1, organization_id: 1, store_id: 1, issued_document_id: 1, document_sha256: 'a'.repeat(64),
      expires_at: new Date(Date.now() + 86_400_000), consent_text: 't', consent_text_version: 'v1', created_by_type: 'user',
    });
  });

  it('numbers events from 1 and links each one to the hash of the previous', async () => {
    const a = await append('created', { n: 1 });
    const b = await append('sent', { n: 2 });
    const c = await append('opened');
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(a.prev_hash).toBeNull();
    expect(b.prev_hash).toBe(a.event_hash);
    expect(c.prev_hash).toBe(b.event_hash);
    expect(a.event_hash).toMatch(/^[0-9a-f]{64}$/);
    const stored = k.kit.db.table('signature_evidence_events');
    expect(stored).toHaveLength(3);
    expect(stored.every((e) => e.store_id === 1)).toBe(true);
  });

  it('verifies an intact chain and reports its last hash', async () => {
    await append('created');
    const last = await append('sent');
    expect(await k.evidence.verify(1)).toEqual({ valid: true, count: 2, broken_at_seq: null, last_hash: last.event_hash });
  });

  it('detects an altered payload, an altered hash, a removed event and a reordered link', async () => {
    await append('created', { a: 1 });
    await append('sent', { a: 2 });
    await append('opened', { a: 3 });
    const rows = () =>
      k.kit.db.table('signature_evidence_events').map((r) => ({ ...r }) as unknown as EvidenceRow);

    const edited = rows();
    edited[1].payload = { a: 999 };
    expect(verifyEvidenceChain(edited)).toMatchObject({ valid: false, broken_at_seq: 2 });

    const forged = rows();
    forged[2].event_hash = 'f'.repeat(64);
    expect(verifyEvidenceChain(forged)).toMatchObject({ valid: false, broken_at_seq: 3 });

    const removed = rows().filter((r) => r.seq !== 2);
    expect(verifyEvidenceChain(removed)).toMatchObject({ valid: false, broken_at_seq: 3 });

    const relinked = rows();
    relinked[2].prev_hash = relinked[0].event_hash;
    expect(verifyEvidenceChain(relinked)).toMatchObject({ valid: false, broken_at_seq: 3 });

    // The database copy was not touched by the experiments above.
    expect((await k.evidence.verify(1)).valid).toBe(true);
    k.kit.db.table('signature_evidence_events')[0].ip_address = '10.0.0.1';
    expect(await k.evidence.verify(1)).toMatchObject({ valid: false, broken_at_seq: 1 });
  });

  it('serializes concurrent writers of one request: seq never collides', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => append('otp_sent', { i })));
    expect(results.map((r) => r.seq).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await k.evidence.verify(1)).toMatchObject({ valid: true, count: 6 });
  });

  it('refuses to write on a request of another store', async () => {
    k.asAdmin(2);
    await expect(append('created')).rejects.toMatchObject({ errorCode: 'SIGNATURE_REQUEST_NOT_FOUND' });
    expect(k.kit.db.table('signature_evidence_events')).toHaveLength(0);
  });

  it('canonical JSON does not depend on key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(
      canonicalJson({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }),
    );
  });
});
