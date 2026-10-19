import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parsePlaybookMarkdown } from './playbook-validator';
import { PLAYBOOK_VERIFIERS, verifyPlaybook } from './playbook-verifiers';

const directory = join(__dirname, 'content');
const documents = readdirSync(directory)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((file) =>
    parsePlaybookMarkdown(readFileSync(join(directory, file), 'utf8'), file),
  );

describe('20 executable pure process verifiers, synthetic domain happy/sad', () => {
  it('binds exactly one versioned verifier to each approved process', () => {
    expect(Object.keys(PLAYBOOK_VERIFIERS).sort()).toEqual(
      documents.map((d) => `${d.id}:v1`).sort(),
    );
    expect(verifyPlaybook('unknown', {}, []).verified).toBe(false);
  });
  describe.each(documents.map((document) => [document.id, document] as const))(
    '%s',
    (_id, document) => {
      const happy = document.contract.examples.find((e) => e.kind === 'happy')!;
      const sad = document.contract.examples.find((e) => e.kind === 'sad')!;
      it('verifies the actual process postcondition, not Markdown lint or a model success claim', () => {
        const frozen = structuredClone(happy);
        expect(
          verifyPlaybook(document.id, happy.input, happy.observations),
        ).toEqual(expect.objectContaining({ verified: true, reasons: [] }));
        expect(happy).toEqual(frozen); // All verifiers are pure; no fixture state mutation.
      });
      it('rejects its domain-specific sad case with fresh but wrong state/quantity/balance/identity', () => {
        const result = verifyPlaybook(document.id, sad.input, sad.observations);
        expect(result.verified).toBe(false);
        expect(result.evidence_step_ids).toEqual([]);
        expect(result.reasons.length).toBeGreaterThan(0);
      });
      it.each(['fresh', 'complete', 'artifact', 'pending', 'unknown'])(
        'rejects evidence that is %s rather than a current complete domain observation',
        (kind) => {
          const observations = structuredClone(happy.observations);
          const final = observations.find((o) => o.step_id === 'verify')!;
          if (kind === 'fresh') final.fresh = false;
          if (kind === 'complete') final.complete = false;
          if (kind === 'artifact') final.artifact = true;
          if (kind === 'pending') final.status = 'pending_confirmation';
          if (kind === 'unknown') final.status = 'unknown_effect';
          expect(
            verifyPlaybook(document.id, happy.input, observations).verified,
          ).toBe(false);
        },
      );
      it('never verifies an empty receipt set or textual assertion', () => {
        expect(verifyPlaybook(document.id, happy.input, []).verified).toBe(
          false,
        );
        const observations = structuredClone(happy.observations);
        observations.find((o) => o.step_id === 'verify')!.data = {
          message: 'todo exitoso',
        };
        expect(
          verifyPlaybook(document.id, happy.input, observations).verified,
        ).toBe(false);
      });
      if (
        happy.observations.some(
          (o) =>
            o.step_id !== 'verify' &&
            o.data &&
            (o.data as any).synthetic_receipt,
        )
      ) {
        it('requires post-write ordering and linked domain receipt IDs, not a pending card', () => {
          const observations = structuredClone(happy.observations);
          const final = observations.find((o) => o.step_id === 'verify')!;
          delete final.after_step;
          expect(
            verifyPlaybook(document.id, happy.input, observations).verified,
          ).toBe(false);
          const pending = structuredClone(happy.observations);
          const effect = pending.find(
            (o) => o.data && (o.data as any).synthetic_receipt,
          )!;
          effect.status = 'pending_confirmation';
          expect(
            verifyPlaybook(document.id, happy.input, pending).verified,
          ).toBe(false);
          const wrong = structuredClone(happy.observations);
          wrong.find(
            (o) => o.data && (o.data as any).synthetic_receipt,
          )!.resource_ids = {};
          expect(verifyPlaybook(document.id, happy.input, wrong).verified).toBe(
            false,
          );
        });
      }
    },
  );
  it('asks a supplier-specific decision when sourcing calls for purchase but supplier is missing', () => {
    const example = documents
      .find((d) => d.id === 'reponer-inventario')!
      .contract.examples.find((e) => e.kind === 'sad')!;
    expect(
      verifyPlaybook('reponer-inventario', example.input, example.observations)
        .reasons,
    ).toContain('supplier_choice_required');
  });
  it('does not mistake sent for DIAN accepted or evidence of a closed cash session', () => {
    const invoice = documents
      .find((d) => d.id === 'facturar-venta')!
      .contract.examples.find((e) => e.kind === 'sad')!;
    expect(
      verifyPlaybook('facturar-venta', invoice.input, invoice.observations)
        .verified,
    ).toBe(false);
    const cash = documents
      .find((d) => d.id === 'cerrar-caja')!
      .contract.examples.find((e) => e.kind === 'happy')!;
    const observations = structuredClone(cash.observations);
    observations.find((o) => o.step_id === 'verify')!.data = { session: null };
    expect(
      verifyPlaybook('cerrar-caja', cash.input, observations).verified,
    ).toBe(false);
  });
  it('treats two preparation-only verifier outcomes as preparation evidence, never a mutation permission', () => {
    for (const id of ['crear-producto-inventario', 'mesa-cocina-cobro']) {
      const doc = documents.find((d) => d.id === id)!;
      const example = doc.contract.examples.find((e) => e.kind === 'happy')!;
      expect(doc.contract.mode).toBe('preparation_only');
      expect(doc.contract.gaps.length).toBeGreaterThan(0);
      expect(
        verifyPlaybook(id, example.input, example.observations).verified,
      ).toBe(true);
      expect(example.observations.some((o) => o.after_step)).toBe(false);
    }
  });
  it('rejects a different product even when its stock math and requested quantity are valid', () => {
    const example = structuredClone(
      documents
        .find((d) => d.id === 'reponer-inventario')!
        .contract.examples.find((e) => e.kind === 'happy')!,
    );
    const stock = example.observations.find((o) => o.step_id === 'stock')!
      .data as { data: Array<{ product_id: number }> };
    stock.data[0].product_id = 999999;
    expect(
      verifyPlaybook('reponer-inventario', example.input, example.observations)
        .verified,
    ).toBe(false);
    const another = structuredClone(
      documents
        .find((d) => d.id === 'reponer-inventario')!
        .contract.examples.find((e) => e.kind === 'happy')!,
    );
    another.observations.find(
      (o) => o.step_id === 'verify',
    )!.arguments!.product_id = 999999;
    expect(
      verifyPlaybook('reponer-inventario', another.input, another.observations)
        .reasons,
    ).toContain('read_arguments_mismatch:product_id');
  });
  it('rejects an accepted invoice belonging to another order and a preflight for another invoice', () => {
    const example = structuredClone(
      documents
        .find((d) => d.id === 'facturar-venta')!
        .contract.examples.find((e) => e.kind === 'happy')!,
    );
    const order = example.observations.find(
      (o) => o.step_id === 'order-verify',
    )!.data as { orden: { order_id: number } };
    order.orden.order_id = 999999;
    expect(
      verifyPlaybook('facturar-venta', example.input, example.observations)
        .verified,
    ).toBe(false);
    const another = structuredClone(
      documents
        .find((d) => d.id === 'facturar-venta')!
        .contract.examples.find((e) => e.kind === 'happy')!,
    );
    (
      another.observations.find((o) => o.step_id === 'preflight')!.data as {
        invoice_id: number;
      }
    ).invoice_id = 999999;
    expect(
      verifyPlaybook('facturar-venta', another.input, another.observations)
        .verified,
    ).toBe(false);
  });
  it('rejects the right-looking closed cash data read from a different endpoint or payload identity', () => {
    const example = structuredClone(
      documents
        .find((d) => d.id === 'cerrar-caja')!
        .contract.examples.find((e) => e.kind === 'happy')!,
    );
    const final = example.observations.find((o) => o.step_id === 'verify')!;
    final.bridge!.path = 'store/cash-registers/sessions/999999';
    expect(
      verifyPlaybook('cerrar-caja', example.input, example.observations)
        .reasons,
    ).toContain('domain_endpoint_identity_mismatch');
    final.bridge!.path = `store/cash-registers/sessions/${example.input.session_id}`;
    (final.data as { id: number }).id = 999999;
    expect(
      verifyPlaybook('cerrar-caja', example.input, example.observations)
        .reasons,
    ).toContain('payload_identity_mismatch');
  });
  it('does not mistake a final report page for the complete sales dataset', () => {
    const example = structuredClone(
      documents
        .find((d) => d.id === 'reporte-ventas-margen')!
        .contract.examples.find((e) => e.kind === 'happy')!,
    );
    example.observations.find((o) => o.step_id === 'verify')!.data = {
      report_id: 'sales-summary',
      range: {
        date_from: example.input.date_from,
        date_to: example.input.date_to,
      },
      rows: [{ total: 20 }],
      offset: 10,
      row_count: 11,
      truncated: false,
    };
    expect(
      verifyPlaybook(
        'reporte-ventas-margen',
        example.input,
        example.observations,
      ).verified,
    ).toBe(false);
  });
});
