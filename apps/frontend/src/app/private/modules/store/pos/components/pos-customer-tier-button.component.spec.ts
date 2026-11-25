import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CartItem } from '../models/cart.model';
import { PosCustomerTierButtonComponent } from './pos-customer-tier-button.component';

/**
 * Como cajero en el POS, con el cliente ya aplicado a la orden, quiero aplicar
 * su tarifa desde el bloque del cliente para no tener que quitarlo y volverlo
 * a poner.
 */
describe('PosCustomerTierButtonComponent', () => {
  const line = (id: string, appliedTierId: number | null = null): CartItem =>
    ({
      id,
      quantity: 1,
      itemType: 'product',
      applied_price_tier_id: appliedTierId,
      product: {
        id: 1,
        name: `Producto ${id}`,
        enabled_price_tier_ids: [7],
        has_multiple_price_tiers: true,
      },
    }) as unknown as CartItem;
  const mayorista = { id: 7, name: 'Mayorista' };

  const render = async (inputs: {
    items: CartItem[];
    tier: { id: number; name: string } | null;
    canApplyTier?: boolean;
  }) => {
    TestBed.configureTestingModule({
      imports: [PosCustomerTierButtonComponent],
      providers: [provideZonelessChangeDetection()],
    });
    const fixture = TestBed.createComponent(PosCustomerTierButtonComponent);
    fixture.componentRef.setInput('items', inputs.items);
    fixture.componentRef.setInput('tier', inputs.tier);
    fixture.componentRef.setInput('canApplyTier', inputs.canApplyTier ?? true);
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement | null;
    return { fixture, button };
  };

  it('no se pinta si el cliente no tiene tarifa', async () => {
    const { button } = await render({ items: [line('a')], tier: null });
    expect(button).toBeNull();
  });

  it('con líneas pendientes muestra el contador y emite al pulsar', async () => {
    const { fixture, button } = await render({
      items: [line('a'), line('b'), line('c', 7)],
      tier: mayorista,
    });
    let emitted = 0;
    fixture.componentInstance.apply.subscribe(() => emitted++);
    expect(button?.textContent?.trim()).toBe('2');
    expect(button?.getAttribute('aria-disabled')).toBeNull();
    expect(button?.getAttribute('title')).toBe('Aplicar la tarifa "Mayorista" a 2 producto(s)');
    expect(button?.getAttribute('aria-label')).toContain(
      'Aplicar la tarifa del cliente a la orden',
    );
    button?.click();
    expect(emitted).toBe(1);
  });

  it('ya aplicada a toda la orden: deshabilitado con motivo y no emite', async () => {
    const { fixture, button } = await render({ items: [line('a', 7)], tier: mayorista });
    let emitted = 0;
    fixture.componentInstance.apply.subscribe(() => emitted++);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.getAttribute('title')).toBe('Ya aplicada a toda la orden');
    button?.click();
    expect(emitted).toBe(0);
  });
});
