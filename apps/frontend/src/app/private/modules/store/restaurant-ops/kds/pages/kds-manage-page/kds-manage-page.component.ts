import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import {
  KdsDisplayService,
  KDS_TICKET_SIZES,
  KdsStationsService,
} from '../../services';
import type { KdsTicketSize } from '../../services';
import type {
  KdsConsumptionHistoryRow,
  KdsConsumptionSummary,
  KdsSession,
  KdsStation,
} from '../../interfaces';
import { KDS_COLUMNS, KdsColumn } from '../../interfaces/kitchen-ticket.interface';

/**
 * Gestión de estaciones de KDS y sus turnos — QUI-651.
 *
 * Espejo funcional del módulo de cajas, y a propósito: la estación de cocina es
 * a los insumos lo que la caja es al dinero. Cubre las cuatro cosas que faltaban
 * y no existían en ninguna pantalla:
 *
 *   1. Crear / editar estaciones y marcar la de por defecto.
 *   2. Historial de turnos, con QUIÉN los abrió y cerró.
 *   3. Detalle de un turno con su historial de movimientos — una fila por insumo
 *      POR PEDIDO, que es lo que permite ver en qué pedido salió cada insumo.
 *   4. Resumen del turno, agregado por insumo.
 *
 * El par historial/resumen es el mismo que caja tiene entre movimientos y
 * summary: 20 pedidos que consumieron pollo son 20 líneas en el historial y una
 * sola en el resumen.
 */
@Component({
  selector: 'app-kds-manage-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    StickyHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    SpinnerComponent,
    ToggleComponent,
  ],
  templateUrl: './kds-manage-page.component.html',
  styleUrl: './kds-manage-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KdsManagePageComponent implements OnInit {
  private readonly stationsService = inject(KdsStationsService);
  private readonly toastService = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly stations = this.stationsService.stations;
  readonly isLoading = this.stationsService.isLoading;

  readonly sessions = signal<KdsSession[]>([]);
  readonly loadingSessions = signal(false);

  /** Turno cuyo detalle está abierto. */
  readonly detailSession = signal<KdsSession | null>(null);
  readonly detailHistory = signal<KdsConsumptionHistoryRow[]>([]);
  readonly detailSummary = signal<KdsConsumptionSummary | null>(null);
  readonly loadingDetail = signal(false);

  readonly isFormOpen = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly isSaving = signal(false);

  /**
   * Confirmaciones pendientes del CRUD completo. Guardan la estación para
   * mostrar su nombre en el modal antes de mutar — nunca se muta sin pasar
   * por acá en desactivar/borrar.
   */
  readonly pendingDeactivate = signal<KdsStation | null>(null);
  readonly pendingActivate = signal<KdsStation | null>(null);
  readonly pendingDelete = signal<KdsStation | null>(null);
  /** Mutación de confirmación en curso: deshabilita los botones del modal. */
  readonly confirmBusy = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    code: ['', [Validators.required, Validators.maxLength(50)]],
    description: [''],
    is_default: [false],
  });

  readonly activeCount = computed(
    () => this.stations().filter((s) => s.is_active).length,
  );
  readonly openSessionsCount = computed(
    () => this.sessions().filter((s) => s.status === 'open').length,
  );

  readonly formTitle = computed(() =>
    this.editingId() == null ? 'Nueva estación' : 'Editar estación',
  );

  // ------------------------------------------------- vista del tablero
  /**
   * QA display: qué estados se ven en el tablero y a qué tamaño los tickets.
   * Es preferencia del DISPOSITIVO (`KdsDisplayService` + localStorage) y se
   * aplica al instante, sin guardar: el tablero lee los mismos signals.
   */
  readonly display = inject(KdsDisplayService);
  readonly displayColumns = KDS_COLUMNS;
  readonly ticketSizes = KDS_TICKET_SIZES;

  displayTitle(column: KdsColumn): string {
    switch (column) {
      case 'pending':
        return 'Pendientes';
      case 'in_preparation':
        return 'En preparación';
      case 'ready':
        return 'Listos';
      case 'delivered':
        return 'Entregados';
      case 'cancelled':
        return 'Cancelados';
    }
  }

  toggleDisplayColumn(column: KdsColumn): void {
    const ok = this.display.toggleColumn(column);
    if (!ok) {
      this.toastService.warning('El tablero necesita al menos una columna visible');
      return;
    }
    this.toastService.success(
      this.display.isColumnVisible(column)
        ? `Columna "${this.displayTitle(column)}" visible`
        : `Columna "${this.displayTitle(column)}" oculta`,
    );
  }

  setTicketSize(size: KdsTicketSize): void {
    this.display.setTicketSize(size);
  }

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.stationsService
      .loadStations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: (e) => this.fail(e, 'No se pudieron cargar las estaciones') });
    this.loadSessions();
  }

  private loadSessions(): void {
    this.loadingSessions.set(true);
    // Sin filtro de estación: la vista de gestión quiere el historial de TODAS,
    // a diferencia del tablero, que es de una sola.
    this.stationsService
      .listSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.sessions.set(rows);
          this.loadingSessions.set(false);
        },
        error: (e) => {
          this.loadingSessions.set(false);
          this.fail(e, 'No se pudo cargar el historial de turnos');
        },
      });
  }

  // ------------------------------------------------------------ estaciones

  openCreate(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', code: '', description: '', is_default: false });
    this.isFormOpen.set(true);
  }

  openEdit(station: KdsStation): void {
    this.editingId.set(station.id);
    this.form.reset({
      name: station.name,
      code: station.code,
      description: station.description ?? '',
      is_default: station.is_default,
    });
    this.isFormOpen.set(true);
  }

  closeForm(): void {
    this.isFormOpen.set(false);
    this.isSaving.set(false);
  }

  save(): void {
    if (this.form.invalid) {
      this.toastService.error('Completa nombre y código');
      return;
    }
    const dto = this.form.getRawValue();
    const id = this.editingId();
    this.isSaving.set(true);

    const obs =
      id == null
        ? this.stationsService.createStation(dto)
        : this.stationsService.updateStation(id, dto);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.isFormOpen.set(false);
        this.toastService.success(
          id == null ? 'Estación creada' : 'Estación actualizada',
        );
        this.reload();
      },
      error: (e) => {
        this.isSaving.set(false);
        // Los códigos de este dominio son accionables y el mensaje del backend ya
        // los explica: KDS_DUP_CODE, KDS_DEFAULT_PROTECTED,
        // KDS_DEFAULT_MUST_BE_ACTIVE. Se muestra tal cual.
        this.fail(e, 'No se pudo guardar la estación');
      },
    });
  }

  /**
   * Promueve una estación a por defecto. El backend degrada la anterior en la
   * misma transacción — el índice único parcial no admite dos.
   */
  makeDefault(station: KdsStation): void {
    if (station.is_default) return;
    this.stationsService
      .updateStation(station.id, { is_default: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(`"${station.name}" es la estación por defecto`);
          this.reload();
        },
        error: (e) => this.fail(e, 'No se pudo marcar por defecto'),
      });
  }

  /**
   * ¿Se puede borrar FÍSICAMENTE? Solo sin historial (0 turnos, 0 platos
   * ruteados y 0 tickets) y sin ser la de por defecto. Con historial el botón Borrar no
   * aparece y se ofrece Desactivar; el backend re-valida con
   * `KDS_HAS_HISTORY`. Sin `_count` (lista sin conteos) se asume sin
   * historial y el backend decide — su 409 accionable llega al toast.
   */
  canHardDelete(station: KdsStation): boolean {
    if (station.is_default) return false;
    const sessions = station._count?.sessions ?? 0;
    const products = station._count?.products ?? 0;
    const tickets = station._count?.tickets ?? 0;
    return sessions === 0 && products === 0 && tickets === 0;
  }

  deactivate(station: KdsStation, after?: () => void): void {
    this.stationsService
      .deactivateStation(station.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(`"${station.name}" desactivada`);
          this.reload();
          after?.();
        },
        // El backend rechaza desactivar la de por defecto o una con turno
        // abierto, y su mensaje dice cuál de las dos
        // (`KDS_DEFAULT_PROTECTED` / `KDS_HAS_OPEN_SESSION`).
        error: (e) => {
          this.fail(e, 'No se pudo desactivar');
          after?.();
        },
      });
  }

  askDeactivate(station: KdsStation): void {
    this.pendingDeactivate.set(station);
  }

  cancelDeactivate(): void {
    if (this.confirmBusy()) return;
    this.pendingDeactivate.set(null);
  }

  confirmDeactivate(): void {
    const station = this.pendingDeactivate();
    if (station == null || this.confirmBusy()) return;
    this.confirmBusy.set(true);
    this.deactivate(station, () => {
      this.confirmBusy.set(false);
      this.pendingDeactivate.set(null);
    });
  }

  /**
   * Reactiva una inactiva. El backend puede aún no exponer
   * `POST /store/kds/:id/activate` (corre en paralelo): su 404 llega al
   * toast como mensaje accionable hasta que exista.
   */
  activate(station: KdsStation, after?: () => void): void {
    this.stationsService
      .activateStation(station.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(`"${station.name}" activada`);
          this.reload();
          after?.();
        },
        error: (e) => {
          this.fail(e, 'No se pudo activar');
          after?.();
        },
      });
  }

  askActivate(station: KdsStation): void {
    this.pendingActivate.set(station);
  }

  cancelActivate(): void {
    if (this.confirmBusy()) return;
    this.pendingActivate.set(null);
  }

  confirmActivate(): void {
    const station = this.pendingActivate();
    if (station == null || this.confirmBusy()) return;
    this.confirmBusy.set(true);
    this.activate(station, () => {
      this.confirmBusy.set(false);
      this.pendingActivate.set(null);
    });
  }

  askDelete(station: KdsStation): void {
    // Doble guarda en el cliente además del @if del botón: con historial
    // o siendo default, el borrado físico ni se intenta.
    if (!this.canHardDelete(station)) {
      this.toastService.warning(
        'Solo se puede borrar una estación sin turnos ni platos',
      );
      return;
    }
    this.pendingDelete.set(station);
  }

  cancelDelete(): void {
    if (this.confirmBusy()) return;
    this.pendingDelete.set(null);
  }

  confirmDelete(): void {
    const station = this.pendingDelete();
    if (station == null || this.confirmBusy()) return;
    this.confirmBusy.set(true);
    this.stationsService
      .deleteStationHard(station.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.confirmBusy.set(false);
          this.pendingDelete.set(null);
          this.toastService.success(`"${station.name}" borrada`);
          this.reload();
        },
        // 404 si ya no existe · 409 `KDS_DEFAULT_PROTECTED` /
        // `KDS_HAS_OPEN_SESSION` / `KDS_HAS_HISTORY`: el mensaje del backend
        // ya explica cuál y se muestra tal cual.
        error: (e) => {
          this.confirmBusy.set(false);
          this.pendingDelete.set(null);
          this.fail(e, 'No se pudo borrar');
        },
      });
  }

  // ---------------------------------------------------------------- turnos

  openDetail(session: KdsSession): void {
    this.detailSession.set(session);
    this.detailHistory.set([]);
    this.detailSummary.set(null);
    this.loadingDetail.set(true);

    this.stationsService
      .getConsumptionHistory(session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.detailHistory.set(rows),
        error: (e) => this.fail(e, 'No se pudo cargar el historial'),
      });

    // El resumen de un turno CERRADO ya está congelado en `summary`: se lee de
    // ahí en vez de recalcular, porque el snapshot es la verdad del turno y
    // recalcular podría dar otro número si los datos cambiaron después.
    if (session.status === 'closed' && session.summary) {
      this.detailSummary.set(session.summary);
      this.loadingDetail.set(false);
      return;
    }

    this.stationsService
      .getConsumptionSummary(session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.detailSummary.set(s);
          this.loadingDetail.set(false);
        },
        error: (e) => {
          this.loadingDetail.set(false);
          this.fail(e, 'No se pudo cargar el resumen');
        },
      });
  }

  closeDetail(): void {
    this.detailSession.set(null);
  }

  closeSession(session: KdsSession): void {
    this.stationsService
      .closeSession(session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Turno cerrado');
          this.closeDetail();
          this.loadSessions();
        },
        error: (e) => this.fail(e, 'No se pudo cerrar el turno'),
      });
  }

  operatorName(u?: { first_name: string; last_name: string } | null): string {
    if (!u) return '—';
    return `${u.first_name} ${u.last_name}`.trim() || '—';
  }

  trackStation(_i: number, s: KdsStation): number {
    return s.id;
  }

  trackSession(_i: number, s: KdsSession): number {
    return s.id;
  }

  trackHistory(_i: number, r: KdsConsumptionHistoryRow): number {
    return r.transaction_id;
  }

  private fail(err: unknown, fallback: string): void {
    this.toastService.error(typeof err === 'string' ? err : fallback);
  }
}
