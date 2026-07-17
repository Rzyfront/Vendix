import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { AppNotification } from '../../../../../../../core/store/notifications/notifications.actions';
import { environment } from '../../../../../../../../environments/environment';

/**
 * QR-mesa `require_staff` approval modal (Step 10).
 *
 * Triggered by the notification effects whenever a `qr_table_scan`
 * notification arrives on the bell: the `StaffScanApprovalService`
 * mounts this component onto `document.body` and binds the
 * notification payload as input.
 *
 * Action contract:
 *  - "Aprobar" calls `POST /ecommerce/tables/:token/confirm` using the
 *    `public_token` baked into the notification's `data` row (Step 4b
 *    guarantees the field is always present). The backend opens the
 *    session, attributes `opened_by=<mesero>`, and broadcasts
 *    `session_opened` — the comensal syncs via Step 4c frontend.
 *  - "Cerrar" dismisses the modal without API call (the diner can
 *    re-scan; the assigned mesero's bell row stays so they can re-open
 *    manually from the bell history).
 *
 * Only ONE modal at a time: the service replaces the payload on each
 * `qr_table_scan`, so a fresh scan steals focus from the previous one.
 *
 * Zoneless + signals: the modal reads its own `loading()` computed,
 * which is bridged from an internal `internalLoading` signal so the
 * template stays signal-based.
 */
@Component({
  selector: 'app-staff-scan-approval-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  templateUrl: './staff-scan-approval-modal.component.html',
  styleUrl: './staff-scan-approval-modal.component.scss',
})
export class StaffScanApprovalModalComponent {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(ToastService);

  /** Notification payload — bound by the host service when mounting. */
  readonly notification = input.required<AppNotification>();

  /** Open/close driven by the service signal (one-way binding from parent). */
  readonly isOpen = input<boolean>(true);

  /** Internal busy flag — bridged into a `loading()` computed for the template. */
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.internalLoading());

  readonly title = computed(() => this.notification().title || 'Mesa escaneada');

  readonly tableName = computed(() => {
    const data = this.notification().data ?? {};
    return (
      (typeof data['table_name'] === 'string' && data['table_name']) ||
      (data['table_id'] != null ? `Mesa ${data['table_id']}` : null) ||
      'la mesa'
    );
  });

  readonly body = computed(() => {
    return (
      this.notification().body ||
      'Un cliente escaneó el QR y solicita que confirmes el inicio de la sesión.'
    );
  });

  readonly publicToken = computed<string | null>(() => {
    const token = this.notification().data?.['public_token'];
    return typeof token === 'string' && token.length > 0 ? token : null;
  });

  readonly canApprove = computed(
    () => !!this.publicToken() && !this.loading(),
  );

  constructor() {
    // Auto-close on stale notification (parent replaced payload): when the
    // notification id changes mid-flight, abandon any in-progress request by
    // resetting internal loading. The service is responsible for closing
    // the modal via [isOpen] binding; we just stop our spinner.
    effect(() => {
      this.notification();
      this.internalLoading.set(false);
    });
  }

  /**
   * POST /ecommerce/tables/:token/confirm — opens the session and
   * attributes it to the calling mesero. Errors surface a toast; the
   * modal stays open so the operator can retry without dismissing.
   */
  async onApprove(): Promise<void> {
    const token = this.publicToken();
    if (!token || this.internalLoading()) return;

    this.internalLoading.set(true);
    const url = `${environment.apiUrl}/ecommerce/tables/${encodeURIComponent(token)}/confirm`;
    try {
      await firstValueFrom(this.http.post<{ success: boolean; data: unknown }>(url, {}));
      this.toastService.success('Sesión abierta para la mesa');
      // Emit a custom event the host service can listen to; the parent
      // closes the modal by toggling isOpen=false on the next signal
      // write. As a safety net we also fire it directly via the
      // `closed` event the service wires on its own.
      this.dispatchClose();
    } catch (err) {
      const message = this.extractErrorMessage(err);
      this.toastService.error(message);
      this.internalLoading.set(false);
    }
  }

  onCancel(): void {
    if (this.internalLoading()) return;
    this.dispatchClose();
  }

  /**
   * Notify the host service that this modal wants to close. We dispatch
   * a CustomEvent on `document` because the service is the only one that
   * owns the signal — this component has no reference to it (avoids a
   * circular DI).
   */
  private dispatchClose(): void {
    if (typeof document !== 'undefined') {
      document.dispatchEvent(
        new CustomEvent('staff-scan-approval:close', {
          bubbles: false,
        }),
      );
    }
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { message?: string; error?: string } | null;
      return (
        body?.message ||
        body?.error ||
        err.message ||
        'No se pudo confirmar la apertura de la mesa'
      );
    }
    if (err instanceof Error) return err.message;
    return 'No se pudo confirmar la apertura de la mesa';
  }
}
