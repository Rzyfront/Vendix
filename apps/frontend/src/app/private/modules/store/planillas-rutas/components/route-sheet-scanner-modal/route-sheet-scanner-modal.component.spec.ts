import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';

import { RouteSheetScannerModalComponent } from './route-sheet-scanner-modal.component';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  ConfirmRouteSheetDto,
  RouteSheetMatchedStop,
} from '../../interfaces/planilla.interface';

/**
 * Carga de planilla con IA: la ENTREGA (entregada / rechazada / liberada /
 * pendiente) va separada del COBRO, el cobro nunca se asume total, una orden
 * prepagada no se cobra y rechazar o liberar exige motivo.
 */
describe('RouteSheetScannerModalComponent — entrega separada del cobro', () => {
  let component: RouteSheetScannerModalComponent;
  let service: jasmine.SpyObj<PlanillasRutasService>;
  let toast: jasmine.SpyObj<ToastService>;

  const match = (overrides: Partial<RouteSheetMatchedStop> & {
    delivered?: boolean;
    collected?: number | null;
    prepaid?: boolean;
    pending?: number;
  }): RouteSheetMatchedStop => ({
    extracted: {
      stop_sequence: overrides.stop_id ?? 1,
      remision_number: 'REM-1',
      delivered: overrides.delivered ?? true,
      collected_amount: overrides.collected === undefined ? null : overrides.collected,
      payment_method: null,
      notes: null,
    },
    stop_id: overrides.stop_id ?? 1,
    stop_sequence: overrides.stop_id ?? 1,
    remision_number: 'REM-1',
    match_method: 'remision',
    current: {
      status: 'pending',
      result: null,
      grand_total: 200,
      collected_amount: 0,
      is_prepaid: overrides.prepaid ?? false,
      pending_amount: overrides.pending ?? (overrides.prepaid ? 0 : 200),
    },
    suggested_result: null,
    suggested_outcome: overrides.suggested_outcome,
  });

  const load = (...rows: RouteSheetMatchedStop[]) => {
    component.editableStops.set(rows.map((r) => (component as any).toEditable(r)));
  };

  const selectOutcome = (index: number, value: string) =>
    component.updateOutcome(index, { target: { value } } as unknown as Event);

  const confirmAndCapture = (): ConfirmRouteSheetDto => {
    component.selectedFile.set(new File(['x'], 'planilla.jpg', { type: 'image/jpeg' }));
    component.aiAck.set(true);
    component.onConfirm();
    expect(service.confirmScan).toHaveBeenCalledTimes(1);
    return service.confirmScan.calls.mostRecent().args[2];
  };

  beforeEach(() => {
    service = jasmine.createSpyObj<PlanillasRutasService>('PlanillasRutasService', [
      'confirmScan',
      'scanSheet',
      'resumeScan',
      'matchStops',
    ]);
    service.confirmScan.and.returnValue(
      of({ route_id: 7, planilla_pdf_key: 'k', settled: [], skipped: [], errors: [], route: {} as any }),
    );
    service.resumeScan.and.returnValue(null as any);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'warning', 'info']);

    TestBed.configureTestingModule({
      imports: [RouteSheetScannerModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PlanillasRutasService, useValue: service },
        { provide: ToastService, useValue: toast },
        { provide: CurrencyFormatService, useValue: { format: (v: number) => String(v) } },
      ],
    });
    const fixture = TestBed.createComponent(RouteSheetScannerModalComponent);
    fixture.componentRef.setInput('routeId', 7);
    component = fixture.componentInstance;
  });

  it('la IA no marcó entrega → queda PENDIENTE (nunca rechazada) y no viaja en el confirm', () => {
    load(match({ stop_id: 1, delivered: false }), match({ stop_id: 2, collected: 200 }));

    const [notDelivered] = component.editableStops();
    expect(notDelivered.outcome).toBe('pending');

    const dto = confirmAndCapture();
    expect(dto.stops.map((s) => s.stop_id)).toEqual([2]);
  });

  it('entregada: el cobro por defecto es lo que leyó la IA o 0, nunca el total', () => {
    load(match({ stop_id: 1, collected: null }), match({ stop_id: 2, collected: 120 }));

    const [noAmount, readAmount] = component.editableStops();
    expect(noAmount.outcome).toBe('delivered');
    expect(noAmount.collected_amount).toBe(0);
    expect(readAmount.collected_amount).toBe(120);
    // Sin cobro completo no se puede confirmar una entrega contra entrega.
    expect(component.canConfirm()).toBeFalse();

    component.updateCollected(0, 200);
    component.updateCollected(1, 200);
    expect(component.canConfirm()).toBeTrue();
    const dto = confirmAndCapture();
    expect(dto.stops[0]).toEqual(
      jasmine.objectContaining({ stop_id: 1, result: 'delivered', collected_amount: 200 }),
    );
  });

  it('prepagada: no se cobra — se envía 0 sin método aunque la IA leyera un monto', () => {
    load(match({ stop_id: 3, collected: 200, prepaid: true }));

    const [row] = component.editableStops();
    expect(row.is_prepaid).toBeTrue();
    expect(row.collected_amount).toBe(0);
    expect(component.isCollectable(row)).toBeFalse();
    expect(component.isUndercollected(row)).toBeFalse();

    const dto = confirmAndCapture();
    expect(dto.stops[0]).toEqual(
      jasmine.objectContaining({ stop_id: 3, result: 'delivered', collected_amount: 0 }),
    );
    expect(dto.stops[0].payment_method).toBeUndefined();
  });

  it('rechazar o liberar exige motivo; el cobro se limpia y el motivo viaja', () => {
    load(match({ stop_id: 1, collected: 200 }), match({ stop_id: 2, collected: 200 }));

    selectOutcome(0, 'rejected');
    selectOutcome(1, 'released');
    expect(component.editableStops()[0].collected_amount).toBe(0);
    expect(component.hasMissingReason()).toBeTrue();
    expect(component.canConfirm()).toBeFalse();

    component.onConfirm();
    expect(service.confirmScan).not.toHaveBeenCalled();

    component.updateReason(0, 'Local cerrado');
    component.updateReason(1, 'Reprogramada');
    expect(component.canConfirm()).toBeTrue();

    const dto = confirmAndCapture();
    expect(dto.stops).toEqual([
      jasmine.objectContaining({
        stop_id: 1,
        result: 'rejected',
        reason: 'Local cerrado',
        collected_amount: 0,
      }),
      jasmine.objectContaining({
        stop_id: 2,
        result: 'released',
        reason: 'Reprogramada',
        collected_amount: 0,
      }),
    ]);
  });
  it('dos filas a la misma parada: bloquea el confirm hasta descartar una', () => {
    load(match({ stop_id: 1, collected: 200 }), match({ stop_id: 1, collected: 200 }));

    expect(component.duplicatedStopIds().has(1)).toBeTrue();
    expect(component.isDuplicatedRow(0)).toBeTrue();
    expect(component.canConfirm()).toBeFalse();

    component.selectedFile.set(new File(['x'], 'planilla.jpg', { type: 'image/jpeg' }));
    component.aiAck.set(true);
    component.onConfirm();
    expect(service.confirmScan).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();

    component.toggleDiscard(1);
    expect(component.duplicatedStopIds().size).toBe(0);
    expect(component.canConfirm()).toBeTrue();
    const dto = confirmAndCapture();
    expect(dto.stops.map((s) => s.stop_id)).toEqual([1]);
  });

  it('fila pendiente o ya liquidada a la misma parada: no se envía, así que no muestra aviso', () => {
    load(
      match({ stop_id: 1, collected: 200 }),
      match({ stop_id: 1, collected: 200 }),
      match({ stop_id: 1, delivered: false }),
      match({ stop_id: 1, collected: 200 }),
    );
    component.editableStops.update((rows) =>
      rows.map((r, i) => (i === 3 ? { ...r, already_settled: true } : r)),
    );

    expect(component.editableStops()[2].outcome).toBe('pending');
    expect(component.duplicatedStopIds().has(1)).toBeTrue();
    expect(component.isDuplicatedRow(0)).toBeTrue();
    expect(component.isDuplicatedRow(1)).toBeTrue();
    expect(component.isDuplicatedRow(2)).toBeFalse();
    expect(component.isDuplicatedRow(3)).toBeFalse();

    component.toggleDiscard(1);
    expect(component.duplicatedStopIds().size).toBe(0);
    expect(component.isDuplicatedRow(2)).toBeFalse();
    expect(component.isDuplicatedRow(3)).toBeFalse();
  });
});
