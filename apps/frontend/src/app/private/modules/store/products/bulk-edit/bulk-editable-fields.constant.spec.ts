import {
  findBulkEditableField,
  getVisibleBulkEditGroups,
} from './bulk-editable-fields.constant';
import { coerceBulkEditValue } from './products-bulk-edit-page.component';
import {
  KDS_DEFAULT_OPTION_VALUE,
  type BulkEditFieldContext,
} from './bulk-edit.interface';

function keysOf(ctx: BulkEditFieldContext, groupKey?: string): string[] {
  return getVisibleBulkEditGroups(ctx)
    .filter((group) => !groupKey || group.key === groupKey)
    .flatMap((group) => group.fields.map((field) => field.key as string));
}

describe('bulk-editable-fields registry (QUI-752)', () => {
  it('prepared + restaurant incluye kds_id', () => {
    const keys = keysOf({
      targetType: 'prepared',
      industries: ['restaurant'],
    });
    expect(keys).toContain('kds_id');
  });

  it('prepared sin industria restaurant no incluye kds_id', () => {
    const keys = keysOf({ targetType: 'prepared', industries: ['retail'] });
    expect(keys).not.toContain('kds_id');
  });

  it('service incluye buffer_minutes e is_eligible_for_home_service y no offer_loose_unit', () => {
    const keys = keysOf({ targetType: 'service', industries: ['retail'] });
    expect(keys).toContain('buffer_minutes');
    expect(keys).toContain('is_eligible_for_home_service');
    expect(keys).not.toContain('offer_loose_unit');
  });

  it('physical incluye offer_loose_unit', () => {
    const keys = keysOf({ targetType: 'physical', industries: ['retail'] });
    expect(keys).toContain('offer_loose_unit');
  });

  it('el grupo replenishment contiene los 4 umbrales', () => {
    const keys = keysOf(
      { targetType: 'physical', industries: ['retail'] },
      'replenishment',
    );
    expect(keys).toEqual([
      'min_stock_level',
      'max_stock_level',
      'reorder_point',
      'reorder_quantity',
    ]);
  });

  it('replenishment en servicio contiene solo min_stock_level', () => {
    expect(
      keysOf({ targetType: 'service', industries: ['retail'] }, 'replenishment'),
    ).toEqual(['min_stock_level']);
  });

  it('account_code vive en el grupo accounting para cualquier tipo', () => {
    for (const targetType of ['physical', 'service', 'prepared'] as const) {
      expect(
        keysOf({ targetType, industries: ['restaurant', 'service'] }, 'accounting'),
      ).toEqual(['account_code']);
    }
  });

  describe('coerceBulkEditValue', () => {
    const field = (key: Parameters<typeof findBulkEditableField>[0]) =>
      findBulkEditableField(key)!;

    it('deja pasar null en umbrales vacíos', () => {
      for (const key of [
        'min_stock_level',
        'max_stock_level',
        'reorder_point',
        'reorder_quantity',
      ] as const) {
        expect(coerceBulkEditValue(field(key), '')).toBeNull();
        expect(coerceBulkEditValue(field(key), 5)).toBe(5);
      }
    });

    it('kds_id: sentinela → null, id → número, vacío → omitido', () => {
      expect(
        coerceBulkEditValue(field('kds_id'), KDS_DEFAULT_OPTION_VALUE),
      ).toBeNull();
      expect(coerceBulkEditValue(field('kds_id'), '7')).toBe(7);
      expect(coerceBulkEditValue(field('kds_id'), null)).toBeUndefined();
    });

    it('account_code: vacío → null, código → string', () => {
      expect(coerceBulkEditValue(field('account_code'), '')).toBeNull();
      expect(coerceBulkEditValue(field('account_code'), null)).toBeNull();
      expect(coerceBulkEditValue(field('account_code'), '413550')).toBe('413550');
    });
  });
});
