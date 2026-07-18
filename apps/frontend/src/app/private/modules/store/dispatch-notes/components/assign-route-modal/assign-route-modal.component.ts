import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components';

import { PlanillasRutasService } from '../../../planillas-rutas/services/planillas-rutas.service';
import {
  CreateStopDto,
  DispatchRoute,
} from '../../../planillas-rutas/interfaces/planilla.interface';
import { DispatchNote } from '../../interfaces/dispatch-note.interface';

/**
 * Assign-route modal for orphan remisiones (no active dispatch route).
 *
 * Two modes, driven by a segmented toggle:
 *   - `existing`: pick a `draft`/`dispatched` planilla (via
 *     `PlanillasRutasService.listRoutes()`) and append this remisión as a
 *     stop with `addStops(routeId, { stops: [{ dispatch_note_id }] })`. On
 *     success emits `assigned` so the parent (list/detail) can refresh.
 *   - `new`: navigate to the planillas module pre-seeding this remisión id via
 *     the `prefillNotes` query param (comma-separated ids contract with the
 *     planillas-rutas wizard), then close.
 *
 * Zoneless + signals: all template-observed state is signal-based; the route
 * fetch is triggered by an effect keyed on `isOpen()` + `mode()`.
 */
type AssignMode = 'existing' | 'new';

@Component({
  selector: 'app-assign-route-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  templateUrl: './assign-route-modal.component.html',
})
export class AssignRouteModalComponent {
  private readonly planillasService = inject(PlanillasRutasService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs / outputs ────────────────────────────────
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly dispatchNote = input.required<DispatchNote>();
  readonly assigned = output<void>();

  // ── Local state ─────────────────────────────────────
  readonly mode = signal<AssignMode>('existing');
  readonly routes = signal<DispatchRoute[]>([]);
  readonly loadingRoutes = signal(false);
  readonly selectedRouteId = signal<number | null>(null);
  readonly submitting = signal(false);

  readonly modeOptions: Array<{ value: AssignMode; label: string; icon: string; description: string }> = [
    { value: 'existing', label: 'Planilla existente', icon: 'truck', description: 'Asignar a una planilla en borrador o despachada.' },
    { value: 'new', label: 'Nueva planilla', icon: 'plus-circle', description: 'Crear una planilla nueva con esta remisión.' },
  ];

  // ── Delivery address (normalized) ───────────────────
  /**
   * Normaliza `customer_address` (string u objeto Address) a líneas legibles,
   * replicando el patrón de `dispatch-note-detail` para evitar renderizar
   * `[object Object]` cuando el backend envía la dirección estructurada.
   */
  readonly addressLines = computed<string[]>(() => {
    const a = this.dispatchNote().customer_address as
      | string
      | {
          address_line1?: string;
          address_line2?: string;
          city?: string;
          state_province?: string;
          postal_code?: string;
          country_code?: string;
        }
      | null
      | undefined;
    if (!a) return [];
    if (typeof a === 'string') {
      const trimmed = a.trim();
      return trimmed ? [trimmed] : [];
    }
    const street = [a.address_line1, a.address_line2].filter(Boolean).join(', ');
    const locality = [a.city, a.state_province, a.postal_code].filter(Boolean).join(', ');
    const country = a.country_code || '';
    return [street, locality, country].filter((l) => !!l && l.trim().length > 0);
  });

  readonly hasAddress = computed<boolean>(() => this.addressLines().length > 0);

  readonly confirmLabel = computed<string>(() =>
    this.mode() === 'new' ? 'Crear planilla' : 'Asignar a planilla',
  );

  readonly confirmDisabled = computed<boolean>(() => {
    if (this.submitting()) return true;
    if (this.mode() === 'existing') return this.selectedRouteId() == null;
    return false;
  });

  constructor() {
    // Load assignable planillas whenever the modal is open in "existing" mode.
    // `fetchRoutes` writes only signals that this effect does not read, so
    // there is no feedback loop.
    effect(() => {
      const open = this.isOpen();
      const mode = this.mode();
      if (open && mode === 'existing') {
        this.fetchRoutes();
      }
    });
  }

  /**
   * Carga las planillas asignables (solo `draft`/`dispatched`). Escribe únicamente
   * los signals `loadingRoutes`/`routes`, que el effect disparador NO lee, por lo
   * que no genera bucle de detección de cambios.
   */
  private fetchRoutes(): void {
    this.loadingRoutes.set(true);
    this.planillasService
      .listRoutes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (routes) => {
          this.routes.set(
            (routes ?? []).filter(
              (r) => r.status === 'draft' || r.status === 'dispatched',
            ),
          );
          this.loadingRoutes.set(false);
        },
        error: (err: Error) => {
          this.loadingRoutes.set(false);
          this.toast.error(err?.message || 'No se pudieron cargar las planillas.');
        },
      });
  }

  setMode(mode: AssignMode): void {
    this.mode.set(mode);
  }

  pickRoute(id: number): void {
    this.selectedRouteId.set(id);
  }

  onConfirm(): void {
    if (this.mode() === 'new') {
      this.goToNewRoute();
      return;
    }

    const routeId = this.selectedRouteId();
    if (routeId == null) return;
    const note = this.dispatchNote();

    this.submitting.set(true);
    // `stop_sequence` is optional server-side (auto-appended to the tail); the
    // frontend `CreateStopDto` types it as required, so we assert the partial.
    const stops = [{ dispatch_note_id: note.id }] as CreateStopDto[];
    this.planillasService
      .addStops(routeId, { stops })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.toast.success('Remisión asignada a la planilla.');
          this.assigned.emit();
          this.close();
        },
        error: (err: Error) => {
          this.submitting.set(false);
          this.toast.error(err?.message || 'No se pudo asignar la remisión a la planilla.');
        },
      });
  }

  private goToNewRoute(): void {
    const note = this.dispatchNote();
    this.close();
    // CONTRATO con planillas-rutas: `prefillNotes` = ids separados por coma.
    this.router.navigate(['/admin/orders/planillas'], {
      queryParams: { prefillNotes: String(note.id) },
    });
  }

  onModalCancel(): void {
    this.close();
  }

  close(): void {
    this.selectedRouteId.set(null);
    this.isOpenChange.emit(false);
  }
}
