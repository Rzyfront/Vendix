import {
  BULK_CUSTOMER_EDITABLE_FIELDS,
  findBulkCustomerField,
  getBulkCustomerGroups,
  NO_PRICE_TIER_VALUE,
} from './bulk-editable-customer-fields.constant';
import {
  buildChangesForm,
  coerceCustomerFieldValue,
} from './customers-bulk-edit-page.component';
import {
  BulkCustomerFilters,
  BulkEditableCustomerChanges,
  EMPTY_BULK_CUSTOMER_FILTERS,
} from './bulk-edit-customers.interface';

/**
 * El registro de campos es el espejo del contrato del backend. Si el espejo se
 * desvía, el `ValidationPipe` devuelve 400 para el lote ENTERO, así que estas
 * pruebas vigilan las dos formas de desviarse: un campo del contrato sin
 * entrada en el registro, y un valor que se envía cuando no debería.
 */
describe('bulk-editable-customer-fields registry', () => {
  const contractKeys: Array<keyof BulkEditableCustomerChanges> = [
    'first_name',
    'last_name',
    'legal_name',
    'phone',
    'person_type',
    'tax_regime',
    'is_withholding_agent',
    'ciiu_code',
    'fiscal_responsibilities',
    'price_tier_id',
    'tag_action',
  ];

  it('todo campo del contrato tiene exactamente una entrada en el registro', () => {
    const registryKeys = BULK_CUSTOMER_EDITABLE_FIELDS.map(
      (field) => field.key as string,
    );
    expect([...registryKeys].sort()).toEqual([...contractKeys].sort());
    expect(new Set(registryKeys).size).toBe(registryKeys.length);
  });

  it('los grupos cubren todos los campos y no repiten ninguno', () => {
    const grouped = getBulkCustomerGroups().flatMap((group) =>
      group.fields.map((field) => field.key as string),
    );
    expect([...grouped].sort()).toEqual([...contractKeys].sort());
  });

  it('el formulario crea un control por campo del contrato', () => {
    const form = buildChangesForm();
    for (const key of contractKeys) {
      expect(form.get(key as string)).toBeTruthy();
    }
  });
});

describe('coerceCustomerFieldValue', () => {
  const field = (key: string) => {
    const found = findBulkCustomerField(key);
    if (!found) throw new Error(`Campo sin registro: ${key}`);
    return found;
  };

  it('el texto vacío LIMPIA el dato cuando el registro lo declara nulo', () => {
    expect(coerceCustomerFieldValue(field('legal_name'), '   ')).toBeNull();
    expect(coerceCustomerFieldValue(field('phone'), '')).toBeNull();
  });

  it('el texto vacío de nombre/apellido se envía como cadena vacía', () => {
    expect(coerceCustomerFieldValue(field('first_name'), '  ')).toBe('');
  });

  it('el texto se recorta antes de viajar', () => {
    expect(coerceCustomerFieldValue(field('first_name'), '  Ana ')).toBe('Ana');
  });

  it('un selector de enum vacío limpia con null, no con cadena vacía', () => {
    expect(coerceCustomerFieldValue(field('tax_regime'), '')).toBeNull();
    expect(coerceCustomerFieldValue(field('person_type'), null)).toBeNull();
    expect(coerceCustomerFieldValue(field('person_type'), 'JURIDICA')).toBe(
      'JURIDICA',
    );
  });

  it('la tarifa traduce la sentinela «Sin tarifa» a null y el vacío a undefined', () => {
    expect(coerceCustomerFieldValue(field('price_tier_id'), null)).toBeUndefined();
    expect(coerceCustomerFieldValue(field('price_tier_id'), '')).toBeUndefined();
    expect(
      coerceCustomerFieldValue(field('price_tier_id'), NO_PRICE_TIER_VALUE),
    ).toBeNull();
    expect(coerceCustomerFieldValue(field('price_tier_id'), 7)).toBe(7);
  });

  it('una acción de etiquetas sin ids no viaja', () => {
    expect(
      coerceCustomerFieldValue(field('tag_action'), { mode: 'add', ids: [] }),
    ).toBeUndefined();
  });

  it('la acción de etiquetas deduplica y normaliza el modo', () => {
    expect(
      coerceCustomerFieldValue(field('tag_action'), {
        mode: 'remove',
        ids: [3, 3, '5', 0, null],
      }),
    ).toEqual({ mode: 'remove', ids: [3, 5] });

    expect(
      coerceCustomerFieldValue(field('tag_action'), {
        mode: 'cualquier-cosa',
        ids: [1],
      }),
    ).toEqual({ mode: 'add', ids: [1] });
  });

  it('las responsabilidades fiscales viajan como arreglo de strings', () => {
    expect(
      coerceCustomerFieldValue(field('fiscal_responsibilities'), ['O-13', 15]),
    ).toEqual(['O-13', '15']);
    expect(
      coerceCustomerFieldValue(field('fiscal_responsibilities'), null),
    ).toEqual([]);
  });

  it('el toggle siempre viaja como booleano', () => {
    expect(
      coerceCustomerFieldValue(field('is_withholding_agent'), true),
    ).toBe(true);
    expect(
      coerceCustomerFieldValue(field('is_withholding_agent'), undefined),
    ).toBe(false);
  });
});

describe('EMPTY_BULK_CUSTOMER_FILTERS', () => {
  it('no envía ningún filtro que acote el listado', () => {
    const filters: BulkCustomerFilters = { ...EMPTY_BULK_CUSTOMER_FILTERS };
    expect(filters.state).toBe('');
    expect(filters.tag_ids).toEqual([]);
    expect(filters.segment_ids).toEqual([]);
    expect(filters.price_tier_id).toBeNull();
    expect(filters.without_price_tier).toBe(false);
  });
});
