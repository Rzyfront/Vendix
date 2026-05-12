import {
  Component,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

/**
 * RNC-24 — Reusable modal that lets a customer in dunning request human
 * support. Pure signals + reactive form. Calls
 * `POST /store/subscriptions/support-request` via the service.
 *
 * Skills: vendix-frontend-modal, vendix-zoneless-signals,
 * vendix-subscription-gate, vendix-frontend-state.
 */
const REASON_OPTIONS: SelectorOption[] = [
  { value: 'payment_issue', label: 'Tengo problemas con mi pago' },
  { value: 'card_declined', label: 'Mi tarjeta fue rechazada' },
  { value: 'plan_question', label: 'Tengo dudas sobre mi plan' },
  { value: 'invoice_dispute', label: 'No estoy de acuerdo con una factura' },
  { value: 'other', label: 'Otro motivo' },
];

const MESSAGE_MAX = 1000;

@Component({
  selector: 'app-support-request-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [size]="'md'"
      [title]="'Contactar soporte'"
      [subtitle]="'Cuéntanos qué pasa y nuestro equipo te contactará pronto'"
    >
      <!-- Body — single root node per branch so content projection works
           with @if/@else (Angular 20). -->
      @if (success()) {
        <div class="flex flex-col items-center text-center gap-4 py-6 px-4">
          <div class="p-4 bg-green-100 rounded-full">
            <app-icon
              name="check-circle"
              [size]="36"
              class="text-green-600"
            ></app-icon>
          </div>
          <h3 class="text-lg font-bold text-text-primary">
            ¡Solicitud enviada!
          </h3>
          <p class="text-sm text-text-secondary max-w-sm">
            Tu solicitud fue enviada al equipo de soporte. Te contactaremos
            pronto al correo registrado en tu cuenta.
          </p>
        </div>
      } @else {
        <form [formGroup]="form" class="flex flex-col gap-4 p-4">
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
            <app-icon
              name="info"
              [size]="16"
              class="text-amber-700 mt-0.5 shrink-0"
            ></app-icon>
            <p class="text-xs text-amber-900">
              Tu mensaje llegará al equipo de Vendix junto con el estado de
              tu suscripción para resolver más rápido.
            </p>
          </div>

          <app-selector
            label="Motivo"
            [options]="reasonOptions"
            [formControl]="reasonControl"
            placeholder="Selecciona un motivo"
            [required]="true"
          ></app-selector>

          <app-textarea
            label="Mensaje (opcional)"
            placeholder="Describe tu situación con el mayor detalle posible…"
            [rows]="5"
            [formControl]="messageControl"
          ></app-textarea>
          <p class="text-[10px] text-text-secondary -mt-3 text-right">
            {{ messageLength() }} / {{ messageMax }}
          </p>

          <app-textarea
            label="Correo de contacto alternativo (opcional)"
            placeholder="otro@correo.com"
            [rows]="1"
            [formControl]="contactEmailControl"
          ></app-textarea>
        </form>
      }

      <!-- Footer — projected separately so each branch keeps a single root
           node (avoid NG8011 with @if + slot=footer). -->
      <div
        slot="footer"
        class="flex flex-col sm:flex-row sm:justify-end gap-2 p-4 border-t border-border w-full"
      >
        @if (success()) {
          <app-button variant="primary" (clicked)="close()">
            Entendido
          </app-button>
        } @else {
          <app-button
            variant="ghost"
            [disabled]="submitting()"
            (clicked)="close()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            [disabled]="!canSubmit()"
            [loading]="submitting()"
            (clicked)="submit()"
          >
            Enviar solicitud
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class SupportRequestModalComponent {
  private readonly subscriptionService = inject(StoreSubscriptionService);
  private readonly toast = inject(ToastService);

  // ─── Inputs / Outputs ────────────────────────────────────────────────────
  readonly isOpen = model<boolean>(false);
  readonly submitted = output<{ ticketId: number }>();

  // ─── Form ────────────────────────────────────────────────────────────────
  readonly reasonOptions = REASON_OPTIONS;
  readonly messageMax = MESSAGE_MAX;

  readonly reasonControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly messageControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.maxLength(MESSAGE_MAX)],
  });
  readonly contactEmailControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.email, Validators.maxLength(120)],
  });

  readonly form = new FormGroup({
    reason: this.reasonControl,
    message: this.messageControl,
    contact_email: this.contactEmailControl,
  });

  // ─── State ───────────────────────────────────────────────────────────────
  readonly submitting = signal(false);
  readonly success = signal(false);

  private readonly reasonValue = toSignal(this.reasonControl.valueChanges, {
    initialValue: this.reasonControl.value,
  });
  private readonly messageValue = toSignal(this.messageControl.valueChanges, {
    initialValue: this.messageControl.value,
  });
  readonly messageLength = computed(() => (this.messageValue() ?? '').length);

  readonly canSubmit = computed(
    () => !!this.reasonValue() && !this.submitting(),
  );

  constructor() {
    // Reset state every time the modal opens.
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
      }
    });
  }

  submit(): void {
    if (!this.canSubmit()) return;
    if (this.contactEmailControl.invalid) {
      this.toast.error('El correo de contacto no es válido');
      return;
    }

    const reason = this.reasonControl.value;
    const reasonLabel =
      this.reasonOptions.find((o) => o.value === reason)?.label ?? reason;
    const messageBody = this.messageControl.value.trim();
    const contactEmail = this.contactEmailControl.value.trim();

    this.submitting.set(true);
    this.subscriptionService
      .requestSupport({
        reason: reasonLabel,
        message: messageBody || reasonLabel,
        contact_email: contactEmail || undefined,
      })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          if (res?.success && res.data?.ticketId) {
            this.success.set(true);
            this.submitted.emit({ ticketId: res.data.ticketId });
          } else {
            this.toast.error(
              'No se pudo enviar la solicitud. Intenta de nuevo.',
            );
          }
        },
        error: (err) => {
          this.submitting.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  close(): void {
    this.isOpen.set(false);
  }

  private resetState(): void {
    this.success.set(false);
    this.submitting.set(false);
    this.form.reset({
      reason: '',
      message: '',
      contact_email: '',
    });
  }
}
