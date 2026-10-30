import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { PopCartComponent } from './pop-cart.component';
import { PopCartService } from '../services/pop-cart.service';
import { WithholdingTaxService } from '../../../withholding-tax/services/withholding-tax.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import type { PopCartItem } from '../interfaces/pop-cart.interface';

describe('PopCartComponent — QUI-855 correcciones de auditoría', () => {
  let component: PopCartComponent;
  let cart: PopCartService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PopCartService,
        { provide: WithholdingTaxService, useValue: { previewWithholding: () => of({ lines: [], total_withholding: 0 }) } },
        { provide: AuthFacade, useValue: { activeFiscalAreas: () => [] } },
        { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
        { provide: DialogService, useValue: {} },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => Promise.resolve(null), format: (n: number) => String(n) } },
        {
          provide: StoreSettingsFacade,
          useValue: { settings: signal({ inventory: { low_stock_threshold: 10 } }) },
        },
      ],
    });
    TestBed.overrideComponent(PopCartComponent, { set: { template: '', imports: [] } });
    component = TestBed.createComponent(PopCartComponent).componentInstance;
    cart = TestBed.inject(PopCartService);
  });

  function add(over: Record<string, unknown> = {}): PopCartItem {
    cart
      .addToCart({
        product: { id: 1, name: 'P', code: 'P1', price: 1, cost: 1, stock: 1, is_active: true } as any,
        quantity: 1,
        unit_cost: 100000,
        ...over,
      })
      .subscribe();
    return cart.currentState.items[0];
  }

  it('taxEditorRows respeta el tax_type legacy («inc») y por defecto es iva', () => {
    expect(component.taxEditorRows({ tax_type: 'inc', tax_rate: 8 } as PopCartItem)[0].tax_type).toBe('inc');
    expect(component.taxEditorRows({ tax_rate: 19 } as PopCartItem)[0].tax_type).toBe('iva');
    expect(component.taxEditorRows({ tax_type: 'zzz', tax_rate: 19 } as PopCartItem)[0].tax_type).toBe('iva');
  });

  it('cambiar $ → %: $1.500 sobre 100.000 queda en 1,5 % (no 2 % = $2.000)', () => {
    const item = add({ discount_amount: 1500 });
    expect(component.discountMode(item)).toBe('amount');
    component.setDiscountMode(item, 'pct');
    const line = cart.currentState.items[0];
    expect(line.discount).toBe(1.5);
    expect(line.discount_amount).toBeUndefined();
    // El dinero no se movió: 1,5 % de 100.000 = 1.500.
    expect(component.itemOwnDiscount(line)).toBe(1500);
  });

  it('QUI-861: la línea expone actual / mínimo (variante gana a base)', () => {
    const item = {
      product: { stock_quantity: 17, min_stock_level: 10 },
      variant: null,
    } as unknown as PopCartItem;
    expect(component.hasLineStockData(item)).toBe(true);
    expect(component.lineStock(item)).toBe(17);
    expect(component.lineLowStockThreshold(item)).toBe(10);
    expect(component.isLineLowStock(item)).toBe(false);

    const withVariant = {
      product: { stock_quantity: 17, min_stock_level: 10 },
      variant: { stock_quantity: 4 },
    } as unknown as PopCartItem;
    expect(component.lineStock(withVariant)).toBe(4);
    expect(component.isLineLowStock(withVariant)).toBe(true);
  });

  it('QUI-861: stock igual al mínimo ya es stock bajo (frontera)', () => {
    const item = {
      product: { stock_quantity: 10, min_stock_level: 10 },
      variant: null,
    } as unknown as PopCartItem;
    expect(component.isLineLowStock(item)).toBe(true);
  });

  it('QUI-861: sin mínimo propio usa el default de tienda (10)', () => {
    const item = {
      product: { stock_quantity: 5 },
      variant: null,
    } as unknown as PopCartItem;
    expect(component.lineLowStockThreshold(item)).toBe(10);
    expect(component.isLineLowStock(item)).toBe(true);
  });

  it('QUI-861: oculta la fila sin tracking o en borrador restaurado', () => {
    expect(
      component.hasLineStockData({
        product: { stock_quantity: 17, track_inventory: false },
        variant: null,
      } as unknown as PopCartItem),
    ).toBe(false);
    expect(
      component.hasLineStockData({
        product: { stock: 0 },
        variant: null,
      } as unknown as PopCartItem),
    ).toBe(false);
  });
});
