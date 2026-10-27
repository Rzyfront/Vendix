import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  AlertBannerComponent,
  BadgeComponent,
  BadgeVariant,
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { NightAuditView } from '../../interfaces/night-audit.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

const STATUS_LABELS: Record<NightAuditView['status'], { label: string; variant: BadgeVariant }> = {
  open: { label: 'Abierto', variant: 'warning' },
  closed: { label: 'Cerrado', variant: 'success' },
  reopened: { label: 'Reabierto', variant: 'info' },
};

/**
 * Hospitality Suite — "Cierre del día" (H7.1). The night auditor reviews the
 * business day (nights charged, no-shows, pending arrivals and the
 * discrepancy) and closes it: the nights are posted, pending arrivals become
 * no-show and the date is frozen until a manager reopens it with a reason.
 */
@Component({
  selector: 'app-hospitality-night-audit-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    BadgeComponent,
    AlertBannerComponent,
    SpinnerComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Cierre del día"
        subtitle="Auditoría nocturna: noches cargadas, no-shows y descuadre"
        icon="moon"
        variant="glass"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats title="Noches cargadas" [value]="nightsLabel()" iconName="bed-double" [loading]="loading()" />
        <app-stats title="Ingreso alojamiento" [value]="revenueLabel()" iconName="dollar-sign" [loading]="loading()" />
        <app-stats title="No-shows" [value]="summary()?.no_shows?.length ?? 0" iconName="user-x" [loading]="loading()" />
        <app-stats title="Descuadre" [value]="summary()?.discrepancies?.length ?? 0" iconName="alert-triangle" [loading]="loading()" />
      </div>

      <div class="space-y-3 p-2 md:p-4">
        <app-card [responsive]="true">
          <div class="flex flex-wrap items-end gap-2">
            <app-input label="Día de negocio" type="date" [formControl]="date" data-testid="audit-date" />
            <app-button variant="outline" size="sm" [loading]="loading()" (clicked)="load(date.value)" data-testid="audit-search">
              <app-icon slot="icon" name="search" [size]="14" />
              Consultar
            </app-button>
            @if (audit(); as a) {
              <app-badge [variant]="statusBadge().variant" data-testid="audit-status">{{ statusBadge().label }}</app-badge>
            }
          </div>

          @if (audit(); as a) {
            @if (a.status === 'closed') {
              <p class="mt-2 text-sm text-text-secondary" data-testid="audit-closed-note">
                Cerrado {{ a.closed_by ? 'por ' + a.closed_by : '' }} el {{ formatDateTime(a.closed_at) }} —
                no se pueden cargar ni anular noches de esta fecha sin reabrir el día.
              </p>
            } @else if (a.status === 'reopened') {
              <p class="mt-2 text-sm text-text-secondary" data-testid="audit-reopened-note">
                Reabierto {{ a.reopened_by ? 'por ' + a.reopened_by : '' }} el {{ formatDateTime(a.reopened_at) }}:
                «{{ a.reopen_reason }}».
              </p>
            }
          }
        </app-card>

        @if (loading() && !audit()) {
          <div class="flex flex-col items-center gap-2 py-8">
            <app-spinner size="md" />
            <p class="text-sm text-text-secondary">Cargando el día…</p>
          </div>
        } @else if (summary(); as s) {
          @if (s.discrepancies.length > 0) {
            <app-alert-banner variant="warning" icon="alert-triangle" heading="Descuadre" data-testid="audit-discrepancies">
              <ul class="list-disc pl-5 text-sm">
                @for (d of s.discrepancies; track $index) {
                  <li>
                    {{ d.reservation_number }} · {{ d.room }} · {{ currency.format(d.rate_amount, 0) }} —
                    {{ d.reason === 'voided' ? 'noche anulada' : 'noche sin cargar' }}
                  </li>
                }
              </ul>
            </app-alert-banner>
          }

          <div class="grid gap-3 md:grid-cols-2">
            <app-card [responsive]="true">
              <h3 class="mb-2 text-sm font-semibold">Llegadas pendientes ({{ s.pending_arrivals.length }})</h3>
              @for (r of s.pending_arrivals; track r.id) {
                <p class="text-sm" data-testid="audit-pending-row">{{ r.reservation_number }} · {{ r.guest_name }}</p>
              } @empty {
                <p class="text-sm text-text-secondary">Sin llegadas pendientes.</p>
              }
            </app-card>
            <app-card [responsive]="true">
              <h3 class="mb-2 text-sm font-semibold">No-shows ({{ s.no_shows.length }})</h3>
              @for (r of s.no_shows; track r.id) {
                <p class="text-sm" data-testid="audit-no-show-row">{{ r.reservation_number }} · {{ r.guest_name }}</p>
              } @empty {
                <p class="text-sm text-text-secondary">Sin no-shows.</p>
              }
            </app-card>
          </div>

          <app-card [responsive]="true">
            @if (audit()?.status === 'closed') {
              @if (canReopen()) {
                <app-button variant="outline" [loading]="busy()" (clicked)="reopen()" data-testid="audit-reopen">
                  <app-icon slot="icon" name="unlock" [size]="14" />
                  Reabrir día
                </app-button>
              } @else {
                <p class="text-sm text-text-secondary">Solo un usuario con permiso puede reabrir el día.</p>
              }
            } @else {
              <label class="mb-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-primary"
                  [checked]="markNoShows()"
                  (change)="markNoShows.set($any($event.target).checked)"
                  data-testid="audit-mark-no-shows"
                />
                Marcar como no-show las llegadas pendientes
              </label>
              <app-button variant="primary" [loading]="busy()" (clicked)="close()" data-testid="audit-close">
                <app-icon slot="icon" name="moon" [size]="14" />
                Cerrar día
              </app-button>
            }
          </app-card>
        }
      </div>
    </div>
  `,
})
export class HospitalityNightAuditPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly authFacade = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);
  readonly currency = inject(CurrencyFormatService);

  readonly date = new FormControl('', { nonNullable: true });
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly markNoShows = signal(true);
  readonly audit = signal<NightAuditView | null>(null);
  readonly canReopen = signal(this.authFacade.hasPermission('store:lodging:night_audit:reopen'));

  readonly summary = computed(() => this.audit()?.summary ?? null);
  readonly statusBadge = computed(() => STATUS_LABELS[this.audit()?.status ?? 'open']);
  readonly nightsLabel = computed(() => {
    const s = this.summary();
    return s ? `${s.nights_posted} / ${s.rooms_occupied}` : '0';
  });
  readonly revenueLabel = computed(() => this.currency.format(this.summary()?.room_revenue ?? 0, 0));

  ngOnInit(): void {
    // Without a date the API answers with the store's current business day.
    this.load();
  }

  load(date?: string): void {
    this.loading.set(true);
    this.reservationsService
      .nightAudit(date || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (audit) => this.show(audit),
        error: (message: unknown) => {
          this.loading.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo cargar el día');
        },
      });
  }

  async close(): Promise<void> {
    const audit = this.audit();
    if (!audit) return;
    const pending = audit.summary.pending_arrivals.length;
    const ok = await this.dialogService.confirm({
      title: `Cerrar el día ${audit.business_date}`,
      message:
        'Se cargan las noches de los huéspedes en casa' +
        (this.markNoShows() && pending > 0 ? ` y ${pending} llegada(s) pendiente(s) pasan a no-show` : '') +
        '. Después no se podrán cargar ni anular noches de esta fecha sin reabrir el día.',
      confirmText: 'Cerrar día',
    });
    if (!ok) return;
    this.busy.set(true);
    this.reservationsService
      .closeNightAudit(audit.business_date, this.markNoShows())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.show(result);
          this.toastService.success(`Día ${result.business_date} cerrado`);
        },
        error: (message: unknown) => this.fail(message, 'No se pudo cerrar el día'),
      });
  }

  async reopen(): Promise<void> {
    const audit = this.audit();
    if (!audit) return;
    const reason = (
      await this.dialogService.prompt({
        title: `Reabrir el día ${audit.business_date}`,
        message: 'Escribe el motivo de la reapertura.',
        placeholder: 'Ej.: faltó cargar un minibar',
        confirmText: 'Reabrir',
      })
    )?.trim();
    if (!reason) return;
    if (reason.length < 3) {
      this.toastService.error('Escribe el motivo de la reapertura');
      return;
    }
    this.busy.set(true);
    this.reservationsService
      .reopenNightAudit(audit.business_date, reason)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.show(result);
          this.toastService.success(`Día ${result.business_date} reabierto`);
        },
        error: (message: unknown) => this.fail(message, 'No se pudo reabrir el día'),
      });
  }

  formatDateTime(value: string | null): string {
    return value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  private show(audit: NightAuditView): void {
    this.audit.set(audit);
    this.date.setValue(audit.business_date, { emitEvent: false });
    this.loading.set(false);
  }

  private fail(message: unknown, fallback: string): void {
    this.busy.set(false);
    this.toastService.error(typeof message === 'string' ? message : fallback);
  }
}
