import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { PopCartComponent } from './pop-cart.component';
import { PopCartService } from '../services/pop-cart.service';
import { WithholdingTaxService } from '../../../withholding-tax/services/withholding-tax.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
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
});
