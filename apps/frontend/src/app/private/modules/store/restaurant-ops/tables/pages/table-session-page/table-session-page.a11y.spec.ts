import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { TableSessionPageComponent } from './table-session-page.component';
import { TablesService } from '../../services/tables.service';
import { AdminTablesSseService } from '../../services/admin-tables-sse.service';
import { KitchenTicketsService, KdsSseService } from '../../../kds/services';
import { KitchenTicketPrintService } from '../../../kds/services/kitchen-ticket-print.service';
import { PosPreCuentaPrintService } from '../../../../pos/services/pos-pre-cuenta-print.service';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { ButtonComponent, DialogService, IconComponent, ToastService } from '../../../../../../../shared/components';
import type { TableSession, TableSessionOrderItem } from '../../interfaces';

/**
 * QUI-1053 — los botones de solo icono de la sesión de mesa deben tener nombre
 * accesible en el `<button>` interno de `app-button`. Un `aria-label` puesto
 * en el host cae en el envoltorio y el lector de pantalla anuncia "botón" a
 * secas: pasaba con la papelera deshabilitada de los ítems entregados y con
 * "Más acciones" de la barra móvil.
 *
 * Se renderiza la plantilla real con `app-button` e `app-icon` reales; el
 * resto de hijos queda como elementos sin comportamiento (NO_ERRORS_SCHEMA),
 * que basta para medir los botones de la página.
 */
describe('TableSessionPageComponent accesibilidad (QUI-1053)', () => {
  let fixture: ComponentFixture<TableSessionPageComponent>;

  const item = (id: number, delivered: boolean): TableSessionOrderItem => ({
    id,
    product_id: id,
    product_variant_id: null,
    variant_label: null,
    product_name: `Plato ${id}`,
    quantity: 1,
    unit_price: '10000',
    total_price: '10000',
    inventory_consumed_at_fire: true,
    is_takeaway: false,
    delivered_at: delivered ? '2026-09-23T12:05:00Z' : null,
    delivered_by_user_id: delivered ? 4 : null,
    cancelled_at: null,
    cancellation_reason: null,
    cancellation_type: null,
    item_type: 'prepared',
    kitchen_ticket_items: [
      { id: id + 100, status: delivered ? 'delivered' : 'ready', kitchen_ticket_id: 50 },
    ],
  });

  const session = (items: TableSessionOrderItem[]): TableSession => ({
    id: 7,
    store_id: 1,
    table_id: 2,
    order_id: 30,
    opened_by: 4,
    opened_at: '2026-09-23T12:00:00Z',
    closed_at: null,
    guest_count: 2,
    table: { id: 2, name: 'Mesa 2', zone: null, status: 'occupied' },
    order: {
      id: 30,
      state: 'pending',
      grand_total: '20000',
      subtotal_amount: '20000',
      tax_amount: '0',
      discount_amount: '0',
      order_items: items,
    },
  });

  beforeEach(async () => {
    const api = jasmine.createSpyObj('TablesService', ['getFinancialSplit', 'getFloorMap']);
    api.getFinancialSplit.and.returnValue(of(null));
    api.getFloorMap.and.returnValue(of([]));
    Object.defineProperty(api, 'floorTables', { value: signal([]) });

    await TestBed.configureTestingModule({
      imports: [TableSessionPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PosPreCuentaPrintService, useValue: jasmine.createSpyObj('PosPreCuentaPrintService', ['print']) },
        { provide: KitchenTicketPrintService, useValue: { isPhysicalKitchen: () => false } },
        { provide: TablesService, useValue: api },
        { provide: KitchenTicketsService, useValue: jasmine.createSpyObj('KitchenTicketsService', ['markDelivered']) },
        { provide: KdsSseService, useValue: { tickets: signal([]), connect: () => {}, refreshSnapshot: () => Promise.resolve([]) } },
        { provide: AdminTablesSseService, useValue: { lastEvent: signal(null), connect: () => {}, disconnect: () => {} } },
        { provide: StoreSettingsFacade, useValue: { settings: signal(null) } },
        { provide: AuthFacade, useValue: { isHospitality: () => false, userPermissions: () => [], printsVatBreakdown: () => false } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']) },
        { provide: DialogService, useValue: jasmine.createSpyObj('DialogService', ['confirm', 'prompt']) },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '7' } } } },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    })
      .overrideComponent(TableSessionPageComponent, {
        set: {
          imports: [CommonModule, CurrencyPipe, ButtonComponent, IconComponent],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    // Sin ngOnInit: la sesión se inyecta directa, sin cargas ni SSE. Va en el
    // prototipo porque Angular registra el hook al compilar, no por instancia.
    spyOn(TableSessionPageComponent.prototype, 'ngOnInit');
    fixture = TestBed.createComponent(TableSessionPageComponent);
  });

  const render = async (items: TableSessionOrderItem[]) => {
    fixture.componentInstance.session.set(session(items));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const buttons = (selector: string): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`${selector} button`));

  const accessibleName = (btn: HTMLButtonElement): string =>
    (btn.getAttribute('aria-label') ?? btn.textContent ?? '').trim();

  it('la papelera deshabilitada de un ítem entregado nombra al plato y el motivo en el <button>', async () => {
    await render([item(1, true)]);

    const [trash] = buttons('app-button.item-remove-btn');
    expect(trash).toBeDefined();
    expect(trash.disabled).toBeTrue();
    expect(trash.getAttribute('aria-label')).toBe(
      'Eliminar Plato 1: Ya fue entregado al cliente. No se puede cancelar.',
    );
  });

  it('la papelera de un ítem pendiente sigue nombrando al plato', async () => {
    await render([item(2, false)]);

    const [trash] = buttons('app-button.item-remove-btn');
    expect(trash).toBeDefined();
    expect(trash.getAttribute('aria-label')).toBe('Eliminar Plato 2 de la cuenta');
  });

  it('"Más acciones" de la barra móvil tiene nombre en el <button>', async () => {
    await render([item(1, true)]);

    const [more] = buttons('app-button.session-cta__more');
    expect(more).toBeDefined();
    expect(more.getAttribute('aria-label')).toBe('Más acciones');
    expect(more.getAttribute('title')).toBe('Más acciones');
  });

  it('ningún botón de app-button queda sin nombre con ítems entregados y pendientes', async () => {
    await render([item(1, true), item(2, true), item(3, false)]);

    const all = buttons('app-button');
    expect(all.length).toBeGreaterThan(0);
    const sinNombre = all.filter((btn) => accessibleName(btn) === '').map((btn) => btn.outerHTML.slice(0, 160));
    expect(sinNombre).toEqual([]);
  });
});
