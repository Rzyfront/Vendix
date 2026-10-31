import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../shared/components';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  ChargeCartToSessionResult,
  PosServiceSession,
  PosServiceStationIntegrationService,
} from '../services/pos-service-station-integration.service';
import type { CartItem } from '../models/cart.model';
import { PosServiceSessionPickerComponent } from './pos-service-session-picker.component';

export interface StationChargedEvent {
  session: PosServiceSession;
  result: ChargeCartToSessionResult;
}

/**
 * "Cargar a estación" — gemelo del modal de mesas (`pos-open-table-modal`).
 * Lista las atenciones activas de las estaciones de servicio y carga el
 * carrito del POS a la cuenta (orden borrador SVC-{id}) de la elegida, en
 * lugar de cobrarlo ahora. El padre limpia el carrito al recibir `charged`.
 */
@Component({
  selector: 'app-pos-charge-station-modal',
  standalone: true,
  imports: [
    ButtonComponent,
    ModalComponent,
    IconComponent,
    CurrencyPipe,
    PosServiceSessionPickerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [showCloseButton]="true"
      title="Cargar a estación"
      subtitle="Agrega el carrito a la cuenta abierta de una estación ocupada"
    >
      <div
        slot="header"
        class="w-10 h-10 rounded-[var(--radius-lg)] bg-primary/10 flex items-center justify-center flex-shrink-0"
      >
        <app-icon name="warehouse" [size]="20" class="text-primary"></app-icon>
      </div>

      <div class="space-y-4">
          <app-pos-service-session-picker
            [sessions]="sessions()"
            [loading]="loading()"
            [(selectedId)]="selectedId"
          ></app-pos-service-session-picker>

          @if (mapping().blocked.length > 0) {
            <div class="blocked-box">
              <div class="flex items-center gap-1.5 font-semibold">
                <app-icon name="circle-alert" [size]="14"></app-icon>
                Estas líneas no se pueden cargar a una estación:
              </div>
              <ul class="mt-1 list-disc pl-5">
                @for (b of mapping().blocked; track $index) {
                  <li>{{ b.name }}: {{ b.reason }}</li>
                }
              </ul>
              <div class="mt-1">Quítalas del carrito o cóbralas por separado.</div>
            </div>
          }

          @if (selectedSession(); as sel) {
            <div class="summary-box">
              <div class="summary-row">
                <span>Total actual · {{ sel.station_name }}</span>
                <span>{{ currentTotal() | currency }}</span>
              </div>
              <div class="summary-row">
                <span>+ Este carrito (con impuestos)</span>
                <span>{{ mapping().amount | currency }}</span>
              </div>
              <div class="summary-row total">
                <span>= Nuevo total</span>
                <span>{{ newTotal() | currency }}</span>
              </div>
            </div>
          }
        </div>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onConfirm()"
          [disabled]="!canConfirm() || submitting()"
        >
          <app-icon name="warehouse" [size]="16" slot="icon"></app-icon>
          @if (submitting()) {
            Cargando...
          } @else {
            Cargar a la cuenta
          }
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .summary-box {
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--color-muted);
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
      }
      .summary-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: var(--color-text-secondary);
      }
      .summary-row.total {
        color: var(--color-text-primary);
        font-weight: 700;
        font-size: 15px;
        border-top: 1px solid var(--color-border);
        padding-top: 6px;
      }
      .blocked-box {
        font-size: 12px;
        color: var(--color-error);
        border: 1px solid rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.06);
        border-radius: 10px;
        padding: 10px 12px;
      }
    `,
  ],
})
export class PosChargeStationModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly integration = inject(PosServiceStationIntegrationService);
  private readonly toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly cartItems = input<CartItem[]>([]);
  readonly isOpenChange = output<boolean>();
  readonly charged = output<StationChargedEvent>();

  readonly sessions = signal<PosServiceSession[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly selectedId = signal<number | null>(null);

  readonly mapping = computed(() =>
    this.integration.mapCartToLines(this.cartItems()),
  );

  readonly selectedSession = computed<PosServiceSession | null>(() => {
    const id = this.selectedId();
    if (id == null) return null;
    return this.sessions().find((s) => s.id === id) ?? null;
  });

  readonly currentTotal = computed(
    () => Number(this.selectedSession()?.order?.grand_total ?? 0) || 0,
  );
  readonly newTotal = computed(
    () => Math.round((this.currentTotal() + this.mapping().amount) * 100) / 100,
  );

  readonly canConfirm = computed(
    () =>
      this.selectedSession() != null &&
      this.mapping().lines.length > 0 &&
      this.mapping().blocked.length === 0,
  );

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.sessions.set([]);
          this.selectedId.set(null);
          this.loadSessions();
        });
      }
    });
  }

  private loadSessions(): void {
    this.loading.set(true);
    this.integration
      .listActiveSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.sessions.set(rows ?? []);
          if ((rows ?? []).length === 1) this.selectedId.set(rows[0].id);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  onModalChange(open: boolean): void {
    if (!open) this.isOpenChange.emit(false);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onConfirm(): void {
    const session = this.selectedSession();
    const { lines, blocked } = this.mapping();
    if (!session || lines.length === 0) return;
    if (blocked.length > 0) {
      this.toastService.warning(
        `No se puede cargar: ${blocked.map((b) => b.name).join(', ')}`,
      );
      return;
    }

    this.submitting.set(true);
    this.integration
      .chargeCartToSession(session.id, lines)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.charged.emit({ session, result });
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(
            err instanceof Error ? err.message : extractApiErrorMessage(err),
          );
          this.loadSessions();
        },
      });
  }
}
