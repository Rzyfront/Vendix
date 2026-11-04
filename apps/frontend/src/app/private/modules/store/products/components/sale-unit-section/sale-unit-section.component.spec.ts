import { TestBed } from '@angular/core/testing';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { UnitOfMeasure } from '../../../inventory/services/uom.service';
import {
  emptySaleUnitState,
  fromProduct,
  isMassPrincipal,
  PIECE,
  SaleUnitFormState,
  SaleUnitPayload,
} from '../../utils/sale-unit-form.util';
import { SaleUnitSectionComponent } from './sale-unit-section.component';

function u(
  id: number,
  code: string,
  name: string,
  dimension: UnitOfMeasure['dimension'],
  factor: number,
): UnitOfMeasure {
  return {
    id,
    code,
    name,
    dimension,
    factor_to_base: factor,
    is_base: factor === 1,
    is_active: true,
    is_stock_eligible: true,
  };
}

const G = u(1, 'g', 'Gramo', 'mass', 1);
const LB = u(2, 'lb', 'Libra', 'mass', 500);
const KG = u(3, 'kg', 'Kilogramo', 'mass', 1000);
const ML = u(7, 'ml', 'Mililitro', 'volume', 1);
const L = u(8, 'L', 'Litro', 'volume', 1000);
const UNIT = u(12, 'unit', 'Unidad', 'count', 1);
const CATALOG: UnitOfMeasure[] = [G, LB, KG, ML, L, UNIT];

function setup(initial: SaleUnitFormState, touched = false) {
  TestBed.configureTestingModule({
    imports: [SaleUnitSectionComponent],
    providers: [
      { provide: CurrencyFormatService, useValue: { format: (v: number) => `$${v}` } },
    ],
  });
  const fixture = TestBed.createComponent(SaleUnitSectionComponent);
  fixture.componentRef.setInput('state', initial);
  fixture.componentRef.setInput('touched', touched);
  fixture.componentRef.setInput('catalog', CATALOG);
  fixture.componentRef.setInput('price', 24000);
  fixture.detectChanges();
  const emitted: SaleUnitPayload[] = [];
  fixture.componentInstance.committed.subscribe((p) => emitted.push(p));
  return { fixture, cmp: fixture.componentInstance, emitted };
}

describe('SaleUnitSectionComponent', () => {
  it('hydrates a product with sale_uoms and shows the summary', () => {
    const state = fromProduct(
      {
        pricing_type: 'weight',
        stock_uom_id: 1,
        sale_uoms: [
          { uom_id: 3, is_principal: true },
          { uom_id: 1 },
          { uom_id: 2 },
        ],
      },
      CATALOG,
    );
    const { cmp } = setup(state);
    expect(cmp.summary()).toBe(
      'Se vende por kg a $24000 · también en g y lb · el inventario se cuenta en g',
    );
    expect(isMassPrincipal(cmp.state(), CATALOG)).toBeTrue();
  });

  it('offers only compatible additional units for a mass principal', () => {
    const state = fromProduct(
      { stock_uom_id: 1, sale_uoms: [{ uom_id: 3, is_principal: true }] },
      CATALOG,
    );
    const { cmp } = setup(state);
    const values = cmp.additionalOptions().map((o) => o.value);
    expect(values).toEqual([1, 2]);
  });

  it('emits no payload and stays untouched until the user edits', () => {
    const state = fromProduct(
      { pricing_type: 'weight', stock_uom_id: null },
      CATALOG,
    );
    const { cmp, emitted } = setup(state);
    expect(cmp.touched()).toBeFalse();
    expect(emitted.length).toBe(0);
    expect(cmp.violationList()).toEqual([]);
  });

  it('emits the canonical payload when the principal changes', async () => {
    const { cmp, emitted } = setup(emptySaleUnitState());
    await cmp.onPrincipalChange(3);
    cmp.onAdditionalChange([1, 2]);
    expect(cmp.touched()).toBeTrue();
    const last = emitted[emitted.length - 1];
    expect(last).toEqual({
      pricing_type: 'weight',
      stock_uom_id: 1,
      purchase_uom_id: null,
      sale_uoms: [
        { uom_id: 3, is_principal: true },
        { uom_id: 1 },
        { uom_id: 2 },
      ],
      price_unit_quantity: 1000,
    });
  });

  it('emits an empty sale_uoms list when going back to piece', async () => {
    const state = fromProduct(
      { stock_uom_id: 1, sale_uoms: [{ uom_id: 3, is_principal: true }] },
      CATALOG,
    );
    const { cmp, emitted } = setup(state);
    await cmp.onPrincipalChange(PIECE);
    expect(emitted[0].sale_uoms).toEqual([]);
    expect(emitted[0].stock_uom_id).toBeNull();
    expect(emitted[0].pricing_type).toBe('unit');
  });

  it('keeps the principal when the guard rejects the change', async () => {
    const state = fromProduct(
      { stock_uom_id: 1, sale_uoms: [{ uom_id: 3, is_principal: true }] },
      CATALOG,
    );
    const { fixture, cmp, emitted } = setup(state);
    fixture.componentRef.setInput('confirmPrincipalChange', async () => false);
    const changes: unknown[] = [];
    cmp.principalChanged.subscribe((c) => changes.push(c));
    await cmp.onPrincipalChange(2);
    expect(cmp.state().principalUomId).toBe(3);
    expect(emitted.length).toBe(0);
    expect(changes.length).toBe(0);
  });

  it('drops additional units that are no longer compatible', async () => {
    const state = fromProduct(
      {
        stock_uom_id: 1,
        sale_uoms: [{ uom_id: 3, is_principal: true }, { uom_id: 1 }],
      },
      CATALOG,
    );
    const { cmp } = setup(state);
    await cmp.onPrincipalChange(8);
    expect(cmp.state().additionalUomIds).toEqual([]);
    expect(cmp.state().stockUomId).toBe(7);
  });
});
