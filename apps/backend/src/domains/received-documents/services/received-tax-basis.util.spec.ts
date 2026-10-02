import { Prisma } from '@prisma/client';
import { buildReceivedTaxBasis, ReceivedTaxBasisInput } from './received-tax-basis.util';

const row = (patch: Partial<ReceivedTaxBasisInput['tax_rows'][number]> = {}) => ({
  id: 1, item_id: null, tax_type: 'iva', scheme_code: '01', rate: '19.00',
  base_amount: '100.00', amount: '19.00', ...patch,
});
const input = (patch: Partial<ReceivedTaxBasisInput> = {}): ReceivedTaxBasisInput => ({
  document_id: 10, document_type: 'invoice', tax_amount: '19.00', tax_rows: [row()], ...patch,
});
const blockerCodes = (basis: ReturnType<typeof buildReceivedTaxBasis>) => basis.blockers.map((blocker) => blocker.code);

describe('buildReceivedTaxBasis', () => {
  it('uses header as authoritative amount representation and only cross-checks item rows', () => {
    const basis = buildReceivedTaxBasis(input({ tax_rows: [
      row({ id: 2, item_id: null }),
      row({ id: 1, item_id: 101 }),
    ] }));
    expect(basis.representation).toBe('header');
    expect(basis.groups).toEqual([expect.objectContaining({
      tax_type: 'iva', scheme_code: '01', rate: '19', base_amount: '100.00', tax_amount: '19.00',
      evidence_tax_ids: [1, 2],
    })]);
    expect(basis.groups[0].tax_amount).toBe('19.00');
    expect(blockerCodes(basis)).toEqual([]);
  });

  it('preserves mixed tax families and distinct rates without reclassifying them', () => {
    const basis = buildReceivedTaxBasis(input({ tax_amount: '33.00', tax_rows: [
      row({ id: 3, tax_type: 'iva', scheme_code: '01', rate: '19', amount: '19', base_amount: '100' }),
      row({ id: 4, tax_type: 'iva', scheme_code: '01', rate: '5', amount: '5', base_amount: '100' }),
      row({ id: 5, tax_type: 'inc', scheme_code: '04', rate: '8', amount: '8', base_amount: '100' }),
      row({ id: 6, tax_type: 'ibua', scheme_code: '34', rate: '0', amount: '1', base_amount: '0', metadata: { tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10' } }),
      row({ id: 7, tax_type: 'withholding', scheme_code: '06', rate: '2.5', amount: '2', base_amount: '80' }),
    ] }));
    expect(basis.groups.map((group) => group.tax_type)).toEqual(['ibua', 'inc', 'iva', 'iva', 'withholding']);
    expect(basis.groups.find((group) => group.tax_type === 'ibua')).toMatchObject({
      rate: '0',
      basis_qualifier: { tax_basis_type: 'unit', base_unit_code: 'ML', per_unit_amount: '0.10' },
      base_quantity: '1000.00',
    });
    // Only non-withholding rows reconcile to document tax_amount; tax family identity remains explicit.
    expect(blockerCodes(basis)).toEqual([]);
  });

  it('validates and preserves nominal IBUA quantity as hashed tax-basis evidence', () => {
    const nominal = (quantity: string) => row({
      id: 20, tax_type: 'ibua', scheme_code: '34', rate: '0', base_amount: '0.00', amount: '1.00',
      metadata: { tax_basis_type: 'unit', base_quantity: quantity, base_unit_code: 'ML', per_unit_amount: '0.10' },
    });
    const basis = buildReceivedTaxBasis(input({ tax_amount: '1.00', tax_rows: [nominal('1000.00')] }));
    const quantityDrift = buildReceivedTaxBasis(input({ tax_amount: '1.00', tax_rows: [nominal('1000.01')] }));
    expect(basis.groups[0]).toMatchObject({ base_quantity: '1000.00', tax_amount: '1.00' });
    expect(blockerCodes(basis)).toEqual([]);
    expect(quantityDrift.groups[0].base_quantity).toBe('1000.01');
    expect(quantityDrift.facts_hash).not.toBe(basis.facts_hash);

    const withinNominalTolerance = buildReceivedTaxBasis(input({ tax_amount: '1.01', tax_rows: [
      { ...nominal('1000.00'), amount: '1.01' },
    ] }));
    const beyondNominalTolerance = buildReceivedTaxBasis(input({ tax_amount: '1.02', tax_rows: [
      { ...nominal('1000.00'), amount: '1.02' },
    ] }));
    expect(blockerCodes(withinNominalTolerance)).not.toContain('INVALID_UNIT_TAX_BASIS');
    expect(blockerCodes(beyondNominalTolerance)).toContain('INVALID_UNIT_TAX_BASIS');

    const compared = buildReceivedTaxBasis(input({ tax_amount: '1.00', tax_rows: [
      nominal('1000.00'), { ...nominal('1000.02'), id: 21, item_id: 101 },
    ] }));
    expect(blockerCodes(compared)).toContain('HEADER_ITEM_UNIT_BASIS_MISMATCH');
  });

  it('blocks incomplete or malformed nominal bases and nominal fields on monetary rows', () => {
    const basis = buildReceivedTaxBasis(input({ tax_amount: '3.00', tax_rows: [
      row({ id: 30, tax_type: 'ibua', scheme_code: '34', rate: '0', amount: '1', metadata: { tax_basis_type: 'unit', base_unit_code: 'ML', per_unit_amount: '0.10' } }),
      row({ id: 31, tax_type: 'inc', scheme_code: '04', rate: '8', amount: '1', metadata: { tax_basis_type: 'unit', base_quantity: '1000', base_unit_code: 'ML', per_unit_amount: '0.10' } }),
      row({ id: 32, tax_type: 'ibua', scheme_code: '34', rate: '1', amount: '1', metadata: { tax_basis_type: 'unit', base_quantity: '1000', base_unit_code: 'ML', per_unit_amount: '0.10' } }),
      row({ id: 33, tax_type: 'iva', scheme_code: '01', rate: '19', amount: '0.5', metadata: { tax_basis_type: 'monetary', base_quantity: '2' } }),
    ] }));
    expect(basis.blockers.find((blocker) => blocker.code === 'INVALID_UNIT_TAX_BASIS')?.evidence_tax_ids).toEqual([30, 31, 32, 33]);
  });

  it('blocks positive IVA facts missing rate or scheme code and validates runtime document type', () => {
    const basis = buildReceivedTaxBasis(input({
      document_type: 'unsupported' as any,
      tax_rows: [row({ id: 40, scheme_code: null, rate: null })],
    }));
    expect(basis.document_type).toBe('unsupported');
    expect(blockerCodes(basis)).toEqual(expect.arrayContaining(['INVALID_DOCUMENT_TYPE', 'MISSING_IVA_RATE', 'MISSING_IVA_SCHEME_CODE']));
    expect(basis.blockers.find((blocker) => blocker.code === 'MISSING_IVA_RATE')?.evidence_tax_ids).toEqual([40]);
  });

  it('supports header-only and item-only representations', () => {
    const header = buildReceivedTaxBasis(input());
    const item = buildReceivedTaxBasis(input({ tax_rows: [row({ id: 2, item_id: 100 })] }));
    expect(header.representation).toBe('header');
    expect(item.representation).toBe('item');
  });

  it('blocks header/item mismatch beyond one cent but accepts exactly one cent', () => {
    const beyond = buildReceivedTaxBasis(input({ tax_rows: [
      row({ id: 1, amount: '19.00' }), row({ id: 2, item_id: 100, amount: '19.02' }),
    ] }));
    expect(blockerCodes(beyond)).toContain('HEADER_ITEM_TAX_MISMATCH');
    expect(beyond.blockers.find((blocker) => blocker.code === 'HEADER_ITEM_TAX_MISMATCH')?.evidence_tax_ids).toEqual([1, 2]);

    const within = buildReceivedTaxBasis(input({ tax_rows: [
      row({ id: 1, amount: '19.00' }), row({ id: 2, item_id: 100, amount: '19.01' }),
    ] }));
    expect(blockerCodes(within)).not.toContain('HEADER_ITEM_TAX_MISMATCH');
  });

  it('blocks a positive document amount with no tax rows', () => {
    const basis = buildReceivedTaxBasis(input({ tax_rows: [] }));
    expect(basis.representation).toBe('none');
    expect(basis.blockers).toContainEqual({ code: 'MISSING_POSITIVE_TAX_ROWS', evidence_tax_ids: [] });
  });

  it('blocks unknown and null types without treating them as IVA', () => {
    const basis = buildReceivedTaxBasis(input({ tax_rows: [
      row({ id: 3, tax_type: null }), row({ id: 4, tax_type: 'unknown-tax', scheme_code: '01' }),
    ] }));
    expect(blockerCodes(basis)).toContain('UNKNOWN_TAX_TYPE');
    expect(basis.groups.every((group) => group.tax_type !== 'iva')).toBe(true);
    expect(basis.blockers.find((blocker) => blocker.code === 'UNKNOWN_TAX_TYPE')?.evidence_tax_ids).toEqual([3, 4]);
  });

  it('blocks invalid/negative amounts and invalid/negative rates with row IDs', () => {
    const basis = buildReceivedTaxBasis(input({ tax_rows: [
      row({ id: 1, amount: '-0.01' }),
      row({ id: 2, rate: '-1' }),
      row({ id: 3, rate: '101' }),
      row({ id: 4, amount: '1.001' }),
    ] }));
    expect(blockerCodes(basis)).toEqual(expect.arrayContaining(['INVALID_TAX_AMOUNT', 'INVALID_TAX_RATE']));
    expect(basis.blockers.find((blocker) => blocker.code === 'INVALID_TAX_AMOUNT')?.evidence_tax_ids).toEqual([1, 4]);
    expect(basis.blockers.find((blocker) => blocker.code === 'INVALID_TAX_RATE')?.evidence_tax_ids).toEqual([2, 3]);
  });

  it('hashes deterministically across row reordering and preserves credit-note positive evidence', () => {
    const rows = [row({ id: 2, tax_type: 'inc', scheme_code: '04', rate: '8', amount: '8', base_amount: '100' }), row({ id: 1 })];
    const first = buildReceivedTaxBasis(input({ tax_amount: '27', tax_rows: rows }));
    const reordered = buildReceivedTaxBasis(input({ tax_amount: '27.00', tax_rows: [...rows].reverse() }));
    expect(first.facts_hash).toBe(reordered.facts_hash);

    const creditNote = buildReceivedTaxBasis(input({ document_type: 'credit_note', tax_amount: '19.00', tax_rows: [row({ amount: '19.00' })] }));
    expect(creditNote.document_tax_amount).toBe('19.00');
    expect(creditNote.groups[0].tax_amount).toBe('19.00');
    expect(blockerCodes(creditNote)).toEqual([]);
  });

  it('records document tax total mismatches and uses exact decimal accumulation', () => {
    const mismatch = buildReceivedTaxBasis(input({ tax_amount: '19.02' }));
    expect(blockerCodes(mismatch)).toContain('DOCUMENT_TAX_AMOUNT_MISMATCH');
    const exact = buildReceivedTaxBasis(input({
      tax_amount: '0.30',
      tax_rows: [
        row({ id: 1, rate: '1', base_amount: '10', amount: '0.10' }),
        row({ id: 2, rate: '2', base_amount: '10', amount: '0.20' }),
      ],
    }));
    expect(exact.groups.reduce((sum, group) => sum.plus(group.tax_amount), new Prisma.Decimal(0)).toFixed(2)).toBe('0.30');
    expect(blockerCodes(exact)).toEqual([]);
  });
});
