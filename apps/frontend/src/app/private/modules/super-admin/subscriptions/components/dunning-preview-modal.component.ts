import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  BadgeComponent,
  ToastService,
} from '../../../../../shared/components';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { SubscriptionAdminService } from '../services/subscription-admin.service';
import {
  DunningPreviewResponse,
  DunningPreviewTargetState,
} from '../interfaces/subscription-admin.interface';

/**
 * Side-effect preview modal shown before a super-admin force-transitions a
 * dunning subscription. Hits
 * `POST /superadmin/subscriptions/dunning/:id/preview-transition` to compute
 * which emails would fire, which features are gained/lost, which invoices and
 * commissions are affected, and surfaces Spanish-language warnings.
 *
 * The operator must explicitly tick the "He revisado los efectos" checkbox
 * before the confirm button is enabled. On confirm the modal emits
 * `confirmed` with the target state — the parent component is responsible
 * for actually firing the force-transition endpoint.
 */
@Component({
  selector: 'app-dunning-preview-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    BadgeComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="
        'Transición ' + (preview()?.current_state ?? '?') + ' → ' + targetState()
      "
      size="lg"
      (closed)="onClose()"
    >
      @if (loading()) {
        <div class="py-12 text-center text-sm text-text-secondary">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-3">Calculando impacto…</p>
        </div>
      } @else if (errored()) {
        <div class="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          No se pudo calcular el preview. Inténtalo de nuevo o revisa los logs.
        </div>
      } @else if (preview(); as p) {
        @if (!p.legal) {
          <div class="rounded-lg border border-red-300 bg-red-50 p-4 mb-4">
            <div class="flex items-start gap-2">
              <app-icon name="alert-circle" [size]="20" class="text-red-600 mt-0.5"></app-icon>
              <div>
                <h4 class="font-semibold text-red-700">Transición no permitida</h4>
                <ul class="mt-2 list-disc pl-5 text-sm text-red-700 space-y-1">
                  @for (w of p.warnings; track w) {
                    <li>{{ w }}</li>
                  }
                </ul>
              </div>
            </div>
          </div>
        } @else {
          <div class="space-y-4">
            <!-- Emails -->
            <section>
              <h4 class="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                <app-icon name="mail" [size]="16"></app-icon>
                Emails que se enviarán ({{ p.side_effects.emails_to_send.length }})
              </h4>
              @if (p.side_effects.emails_to_send.length === 0) {
                <p class="text-xs text-text-secondary pl-6">No se enviarán emails para esta transición.</p>
              } @else {
                <ul class="space-y-1 pl-6">
                  @for (e of p.side_effects.emails_to_send; track e.key) {
                    <li class="text-xs text-text-secondary">
                      <span class="font-mono text-text-primary">{{ e.key }}</span>
                      → <span class="text-text-primary">{{ e.to }}</span>
                      <div class="text-text-secondary">"{{ e.subject }}"</div>
                    </li>
                  }
                </ul>
              }
            </section>

            <!-- Features lost -->
            @if (p.side_effects.features_lost.length > 0) {
              <section>
                <h4 class="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                  <app-icon name="x-circle" [size]="16" class="text-red-500"></app-icon>
                  Features que se pierden
                </h4>
                <div class="flex flex-wrap gap-1.5 pl-6">
                  @for (f of p.side_effects.features_lost; track f) {
                    <app-badge variant="error">{{ f }}</app-badge>
                  }
                </div>
              </section>
            }

            <!-- Features gained -->
            @if (p.side_effects.features_gained.length > 0) {
              <section>
                <h4 class="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                  <app-icon name="check-circle" [size]="16" class="text-green-600"></app-icon>
                  Features que se habilitan
                </h4>
                <div class="flex flex-wrap gap-1.5 pl-6">
                  @for (f of p.side_effects.features_gained; track f) {
                    <app-badge variant="success">{{ f }}</app-badge>
                  }
                </div>
              </section>
            }

            <!-- Invoices -->
            @if (p.side_effects.invoices_affected.length > 0) {
              <section>
                <h4 class="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                  <app-icon name="file-text" [size]="16"></app-icon>
                  Facturas afectadas ({{ p.side_effects.invoices_affected.length }})
                </h4>
                <div class="overflow-x-auto pl-6">
                  <table class="w-full text-xs">
                    <thead class="text-text-secondary">
                      <tr class="border-b border-border">
                        <th class="text-left py-1.5">N°</th>
                        <th class="text-left py-1.5">Estado</th>
                        <th class="text-right py-1.5">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (inv of p.side_effects.invoices_affected; track inv.id) {
                        <tr class="border-b border-border/50">
                          <td class="py-1.5 font-mono">{{ inv.invoice_number }}</td>
                          <td class="py-1.5">{{ inv.state }}</td>
                          <td class="py-1.5 text-right">{{ inv.total | currency }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            <!-- Commissions -->
            @if (p.side_effects.commissions_affected.length > 0) {
              <section>
                <h4 class="text-sm font-semibold text-text-primary mb-2 flex items-center gap-2">
                  <app-icon name="users" [size]="16"></app-icon>
                  Comisiones de partner afectadas
                  ({{ p.side_effects.commissions_affected.length }})
                </h4>
                <div class="overflow-x-auto pl-6">
                  <table class="w-full text-xs">
                    <thead class="text-text-secondary">
                      <tr class="border-b border-border">
                        <th class="text-left py-1.5">ID</th>
                        <th class="text-left py-1.5">Partner Org</th>
                        <th class="text-left py-1.5">Estado</th>
                        <th class="text-right py-1.5">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of p.side_effects.commissions_affected; track c.id) {
                        <tr class="border-b border-border/50">
                          <td class="py-1.5 font-mono">#{{ c.id }}</td>
                          <td class="py-1.5">#{{ c.partner_org_id }}</td>
                          <td class="py-1.5">{{ c.state }}</td>
                          <td class="py-1.5 text-right">{{ c.amount | currency }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            <!-- Warnings callout -->
            @if (p.warnings.length > 0) {
              <section class="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div class="flex items-start gap-2">
                  <app-icon name="alert-triangle" [size]="18" class="text-amber-600 mt-0.5"></app-icon>
                  <div class="flex-1">
                    <h4 class="text-sm font-semibold text-amber-800">Advertencias</h4>
                    <ul class="mt-1.5 list-disc pl-5 text-xs text-amber-800 space-y-1">
                      @for (w of p.warnings; track w) {
                        <li>{{ w }}</li>
                      }
                    </ul>
                  </div>
                </div>
              </section>
            }

            <!-- Acknowledgement -->
            <label class="flex items-start gap-2 mt-2 cursor-pointer select-none">
              <input
                type="checkbox"
                class="mt-1 h-4 w-4"
                [checked]="acknowledged()"
                (change)="acknowledged.set(!acknowledged())"
              />
              <span class="text-sm text-text-primary">
                He revisado los efectos de esta transición.
              </span>
            </label>
          </div>
        }
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="onClose()">
          Cancelar
        </app-button>
        @if (preview()?.legal) {
          <app-button
            variant="primary"
            [disabled]="!acknowledged() || submitting()"
            (clicked)="confirm()"
          >
            {{ submitting() ? 'Procesando…' : 'Confirmar transición' }}
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class DunningPreviewModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly subscriptionId = input<string | null>(null);
  readonly targetState = input<DunningPreviewTargetState>('cancelled');

  readonly closed = output<void>();
  readonly confirmed = output<DunningPreviewTargetState>();

  private destroyRef = inject(DestroyRef);
  private adminService = inject(SubscriptionAdminService);
  private toast = inject(ToastService);

  readonly loading = signal(false);
  readonly errored = signal(false);
  readonly submitting = signal(false);
  readonly acknowledged = signal(false);
  readonly preview = signal<DunningPreviewResponse | null>(null);

  readonly hasSideEffects = computed(() => {
    const p = this.preview();
    if (!p || !p.legal) return false;
    return (
      p.side_effects.emails_to_send.length > 0 ||
      p.side_effects.features_lost.length > 0 ||
      p.side_effects.features_gained.length > 0 ||
      p.side_effects.invoices_affected.length > 0 ||
      p.side_effects.commissions_affected.length > 0
    );
  });

  constructor() {
    // Re-fetch the preview every time the modal opens for a (subscription, target) pair.
    effect(() => {
      const open = this.isOpen();
      const id = this.subscriptionId();
      const target = this.targetState();
      if (open && id) {
        this.fetchPreview(id, target);
      } else if (!open) {
        // Reset state when closed
        this.preview.set(null);
        this.acknowledged.set(false);
        this.errored.set(false);
      }
    });
  }

  private fetchPreview(
    subscriptionId: string,
    target: DunningPreviewTargetState,
  ): void {
    this.loading.set(true);
    this.errored.set(false);
    this.preview.set(null);
    this.acknowledged.set(false);
    this.adminService
      .previewDunningTransition(subscriptionId, target)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            this.preview.set(res.data);
          } else {
            this.errored.set(true);
          }
          this.loading.set(false);
        },
        error: () => {
          this.errored.set(true);
          this.loading.set(false);
        },
      });
  }

  confirm(): void {
    if (!this.acknowledged() || this.submitting()) return;
    const p = this.preview();
    if (!p || !p.legal) return;
    this.submitting.set(true);
    this.confirmed.emit(this.targetState());
    // Parent owns the actual mutation; reset submitting after a short tick so
    // the UI reflects the in-flight state until the modal is closed by parent.
    setTimeout(() => this.submitting.set(false), 250);
  }

  onClose(): void {
    this.closed.emit();
  }
}
