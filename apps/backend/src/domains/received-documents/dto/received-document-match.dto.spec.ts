import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ConfirmReceivedDocumentMatchDto,
  ReceivedDocumentMatchCandidatesQueryDto,
  RevokeReceivedDocumentMatchDto,
} from './received-document-match.dto';

const validConfirm = (overrides: Record<string, unknown> = {}) => ({
  expected_version: 3,
  idempotency_key: '4ebba4d6-c50b-4d89-b926-c23e2e720f88',
  document_item_id: 10,
  purchase_order_id: 20,
  purchase_order_item_id: 21,
  source_quantity: '2.1250',
  target_quantity: '2.1250',
  target_unit_code: 'EA',
  allocated_net_amount: '100.25',
  ...overrides,
});

describe('received document match DTOs', () => {
  it('normalizes candidate search and coerces a bounded query limit', async () => {
    const dto = plainToInstance(ReceivedDocumentMatchCandidatesQueryDto, {
      search: '  Factura   del   proveedor  ',
      limit: '20',
    });

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto).toMatchObject({ search: 'Factura del proveedor', limit: 20 });
  });

  it('rejects invalid candidate query bounds and a blank normalized search', async () => {
    const invalidLimit = plainToInstance(ReceivedDocumentMatchCandidatesQueryDto, { limit: '21' });
    const blankSearch = plainToInstance(ReceivedDocumentMatchCandidatesQueryDto, { search: '   ' });

    expect(await validate(invalidLimit)).not.toEqual([]);
    expect(await validate(blankSearch)).not.toEqual([]);
  });

  it.each([true, false, '1e2', [1]])('does not coerce ambiguous candidate limit %p', async (limit) => {
    const dto = plainToInstance(ReceivedDocumentMatchCandidatesQueryDto, { limit });
    expect(await validate(dto)).not.toEqual([]);
  });

  it('accepts a structurally valid PO allocation proposal without enforcing target XOR in the DTO', async () => {
    const dto = plainToInstance(ConfirmReceivedDocumentMatchDto, validConfirm({ expected_version: '3' }));

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.expected_version).toBe(3);
  });

  it('accepts the alternative expense target shape', async () => {
    const dto = plainToInstance(ConfirmReceivedDocumentMatchDto, validConfirm({
      purchase_order_id: undefined,
      purchase_order_item_id: undefined,
      expense_id: '30',
      expense_item_id: '31',
      target_quantity: undefined,
      target_unit_code: undefined,
    }));

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.expense_id).toBe(30);
    expect(dto.expense_item_id).toBe(31);
  });

  it.each([true, false, '1e2', [1]])('rejects unsafe numeric coercion %p for every ID/version field', async (value) => {
    const numericFields = [
      'expected_version',
      'document_item_id',
      'purchase_order_id',
      'purchase_order_item_id',
      'reception_id',
      'reception_item_id',
      'expense_id',
      'expense_item_id',
    ] as const;

    for (const field of numericFields) {
      const dto = plainToInstance(ConfirmReceivedDocumentMatchDto, validConfirm({ [field]: value }));
      expect(await validate(dto)).not.toEqual([]);
    }

    const revoke = plainToInstance(RevokeReceivedDocumentMatchDto, {
      expected_version: value,
      reason: 'Motivo de revocación con longitud suficiente',
    });
    expect(await validate(revoke)).not.toEqual([]);
  });

  it.each(['2147483648', '9007199254740993'])('rejects out-of-range integer %s for required and optional IDs', async (value) => {
    const numericFields = [
      'expected_version',
      'document_item_id',
      'purchase_order_id',
      'purchase_order_item_id',
      'reception_id',
      'reception_item_id',
      'expense_id',
      'expense_item_id',
    ] as const;

    for (const field of numericFields) {
      const dto = plainToInstance(ConfirmReceivedDocumentMatchDto, validConfirm({ [field]: value }));
      expect(await validate(dto)).not.toEqual([]);
    }

    const revoke = plainToInstance(RevokeReceivedDocumentMatchDto, {
      expected_version: value,
      reason: 'Motivo de revocación con longitud suficiente',
    });
    expect(await validate(revoke)).not.toEqual([]);
  });

  it.each([
    ['zero quantity', { source_quantity: '0.0000' }],
    ['negative quantity', { source_quantity: '-1' }],
    ['quantity precision overflow', { source_quantity: '1.00001' }],
    ['quantity integer overflow', { source_quantity: '100000000000.0000' }],
    ['invalid optional target quantity', { target_quantity: 'NaN' }],
    ['negative allocation money', { allocated_net_amount: '-0.01' }],
    ['allocation money precision overflow', { allocated_net_amount: '1.001' }],
    ['allocation money integer overflow', { allocated_net_amount: '10000000000000.00' }],
  ])('rejects %s', async (_name, overrides) => {
    const dto = plainToInstance(ConfirmReceivedDocumentMatchDto, validConfirm(overrides));
    expect(await validate(dto)).not.toEqual([]);
  });

  it('rejects tenant overrides through the global whitelist contract', async () => {
    const dto = plainToInstance(ConfirmReceivedDocumentMatchDto, validConfirm({
      organization_id: 2,
      accounting_entity_id: 3,
      store_id: 4,
    }));
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    const rejected = errors.flatMap((error) => Object.keys(error.constraints ?? {}));

    expect(rejected).toContain('whitelistValidation');
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      'organization_id', 'accounting_entity_id', 'store_id',
    ]));
  });

  it('requires a valid UUIDv4 and 10–500 character manual reason when supplied', async () => {
    const invalidUuid = plainToInstance(ConfirmReceivedDocumentMatchDto, validConfirm({ idempotency_key: 'not-a-uuid' }));
    const shortManualReason = plainToInstance(ConfirmReceivedDocumentMatchDto, validConfirm({ manual_reason: 'short' }));
    const validRevoke = plainToInstance(RevokeReceivedDocumentMatchDto, {
      expected_version: '3', reason: '  Revisión manual de la asignación  ',
    });
    const invalidRevoke = plainToInstance(RevokeReceivedDocumentMatchDto, {
      expected_version: 3, reason: 'corto',
    });

    expect(await validate(invalidUuid)).not.toEqual([]);
    expect(await validate(shortManualReason)).not.toEqual([]);
    expect(await validate(validRevoke)).toEqual([]);
    expect(validRevoke.reason).toBe('Revisión manual de la asignación');
    expect(await validate(invalidRevoke)).not.toEqual([]);
  });
});
