import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { TransferFlowPanelComponent } from './transfer-flow-panel.component';
import type { TransferFlowView } from './transfer-advanced';

function transfer(over: Partial<TransferFlowView> = {}): TransferFlowView {
  return {
    id: 1,
    status: 'in_transit',
    movement_mode: 'with_dispatch_notes',
    is_external_destination: false,
    dispatched_at: '2026-11-10T10:00:00Z',
    expected_date: '2026-11-15T00:00:00Z',
    stock_transfer_items: [
      {
        id: 11,
        quantity: 5,
        quantity_dispatched: 5,
        quantity_received: 2,
        quantity_lost: 0,
        products: { id: 10, name: 'Café' },
      },
    ],
    ...over,
  };
}

/**
 * Panel del detalle de la orden avanzada (P3): despacho con conteo, alerta de
 * salida sin soporte, aviso de tienda de la recepción y cierre con pérdida
 * solo con la fecha límite vencida (D4).
 */
describe('TransferFlowPanelComponent', () => {
  let fixture: ComponentFixture<TransferFlowPanelComponent>;
  let component: TransferFlowPanelComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransferFlowPanelComponent],
      providers: [
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            format: (value: number) => `$ ${value.toLocaleString('es-CO')}`,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TransferFlowPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('now', new Date('2026-11-19T12:00:00Z'));
  });

  function render(
    t: TransferFlowView | null,
    inputs: Record<string, unknown> = {},
  ): HTMLElement {
    fixture.componentRef.setInput('transfer', t);
    for (const [k, v] of Object.entries(inputs))
      fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const q = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="${id}"]`);

  it('m6: muestra el costo de transporte con formato de moneda', () => {
    const el = render(transfer({ shipping_cost: 25000 } as any));
    expect(q(el, 'shipping-cost')?.textContent?.trim()).toBe('$ 25.000');
  });

  it('muestra "Cerrar pendiente como pérdida" solo con la fecha límite vencida', () => {
    let el = render(transfer());
    expect(q(el, 'flow-loss-open')).not.toBeNull();
    expect(q(el, 'flow-loss-hint')).toBeNull();

    el = render(transfer({ expected_date: '2026-11-25T00:00:00Z' }));
    expect(q(el, 'flow-loss-open')).toBeNull();
    expect(q(el, 'flow-loss-hint')).not.toBeNull();
  });

  it('respeta el permiso de cierre de la superficie', () => {
    const el = render(transfer(), { allowCloseWithLoss: false });
    expect(q(el, 'flow-loss-open')).toBeNull();
  });

  it('exige motivo para cerrar como pérdida', () => {
    const emitted: unknown[] = [];
    component.closeWithLoss.subscribe((v) => emitted.push(v));
    render(transfer());
    component.lossOpen.set(true);
    component.lossReason.set('  ');
    component.confirmLoss();
    expect(emitted).toEqual([]);
    expect(component.lossError()).toContain('motivo');

    component.lossReason.set('Se dañó en el camino');
    component.confirmLoss();
    expect(emitted).toEqual([{ reason: 'Se dañó en el camino' }]);
  });

  it('muestra la alerta de salida sin documento ni motivo', () => {
    const el = render(
      transfer({
        is_external_destination: true,
        no_support_alert: true,
        external_destination_name: 'Cliente X',
      }),
    );
    expect(q(el, 'flow-exit-alert')?.textContent).toContain(
      'sin documento ni motivo',
    );
    expect(el.textContent).toContain('Cliente X');
  });

  it('despacha con el conteo de salida editado', () => {
    const emitted: unknown[] = [];
    component.dispatch.subscribe((v) => emitted.push(v));
    const el = render(
      transfer({
        status: 'in_transit',
        dispatched_at: null,
        stock_transfer_items: [
          {
            id: 11,
            quantity: 5,
            quantity_dispatched: null,
            batch_id: 9,
            products: { id: 10, name: 'Café' },
          },
        ],
      }),
    );
    expect(q(el, 'flow-dispatch-open')).not.toBeNull();
    component.openDispatch();
    component.setDispatchQty(11, '3');
    component.confirmDispatch();
    expect(emitted).toEqual([
      { items: [{ id: 11, quantity_dispatched: 3, batch_id: 9 }] },
    ]);

    component.setDispatchQty(11, '9');
    component.confirmDispatch();
    expect(component.dispatchError()).toContain('más de lo pedido');
    expect(emitted.length).toBe(1);
  });

  it('no ofrece despachar sin permiso ni en filas del flujo anterior', () => {
    const pending = transfer({
      status: 'approved',
      dispatched_at: null,
      stock_transfer_items: [
        { id: 11, quantity: 5, quantity_dispatched: null },
      ],
    });
    expect(
      q(render(pending, { allowDispatch: false }), 'flow-dispatch-open'),
    ).toBeNull();
    expect(
      q(
        render({ ...pending, movement_mode: null }, { allowDispatch: true }),
        'flow-dispatch-open',
      ),
    ).toBeNull();
  });

  it('R3-2: guía cuando las entregas siguen en otra tienda', () => {
    const el = render(
      transfer({
        receipt_note: {
          id: 5,
          dispatch_number: 'REM261119-0001',
          store_id: 4,
          store: { id: 4, name: 'Centro' },
        },
      }),
      { surface: 'store', currentStoreId: 3 },
    );
    expect(q(el, 'flow-receipt-store-block')?.textContent).toContain('Centro');
    expect(q(el, 'flow-receipt-note')?.textContent).toContain('REM261119-0001');
  });

  it('emite la remisión al pulsarla', () => {
    const opened: unknown[] = [];
    component.openNote.subscribe((n) => opened.push(n));
    const note = { id: 7, dispatch_number: 'REM-7' };
    const el = render(transfer({ dispatch_note: note }));
    (q(el, 'flow-dispatch-note') as HTMLButtonElement).click();
    expect(opened).toEqual([note]);
  });
});
