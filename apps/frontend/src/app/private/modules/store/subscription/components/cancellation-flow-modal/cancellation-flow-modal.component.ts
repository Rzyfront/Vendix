import {
  Component,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  effect,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  TextareaComponent,
  ToggleComponent,
} from '../../../../../../shared/components/index';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

/**
 * Razones estructuradas que persistimos en `subscription_events.payload.reason`.
 * Para "other" enviamos `other:<texto libre>` para conservar el feedback.
 */
export type CancellationReasonCode =
  | 'price'
  | 'missing_features'
  | 'low_usage'
  | 'switched'
  | 'other';

export interface CancellationConfirmedPayload {
  /** Razón semántica final (ej: "price", "missing_features", "other:texto libre") */
  reason: string;
  /** true = cancelar inmediatamente; false = al final del ciclo */
  immediate: boolean;
  /** true si el usuario vió y rechazó la oferta de retención */
  retentionOffered: boolean;
  /** Feedback adicional capturado en el paso 2 (ej: feature requests, herramienta sustituta) */
  retentionFeedback?: string;
}

const CANCEL_CONFIRMATION_TEXT = 'Quiero cancelar mi plan';
const FEEDBACK_MAX = 500;

interface ReasonOption {
  code: CancellationReasonCode;
  label: string;
  icon: string;
}

const REASON_OPTIONS: ReasonOption[] = [
  { code: 'price', label: 'El precio es muy alto', icon: 'circle-dollar-sign' },
  {
    code: 'missing_features',
    label: 'Faltan funcionalidades que necesito',
    icon: 'puzzle',
  },
  {
    code: 'low_usage',
    label: 'No estoy usando lo suficiente',
    icon: 'bar-chart-3',
  },
  { code: 'switched', label: 'Encontré una alternativa', icon: 'arrow-right-left' },
  { code: 'other', label: 'Otro', icon: 'message-circle' },
];

@Component({
  selector: 'app-cancellation-flow-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    TextareaComponent,
    ToggleComponent,
  ],
  templateUrl: './cancellation-flow-modal.component.html',
  styleUrl: './cancellation-flow-modal.component.scss',
})
export class CancellationFlowModalComponent {
  private router = inject(Router);

  // ─── Inputs / Outputs ──────────────────────────────────────────────────────

  readonly isOpen = model<boolean>(false);

  /** Nombre del plan actual (para mostrar en el wizard) */
  readonly planName = input<string>('Mi plan');

  /** Fecha de fin del periodo actual (ISO string) */
  readonly currentPeriodEnd = input<string | Date | null | undefined>(null);

  /** Loading flag (deshabilita el botón final mientras se procesa la cancelación) */
  readonly loading = input<boolean>(false);

  readonly confirmed = output<CancellationConfirmedPayload>();
  readonly closed = output<void>();

  // ─── Wizard state ──────────────────────────────────────────────────────────

  readonly step = signal<1 | 2 | 3>(1);

  readonly reasons = REASON_OPTIONS;
  readonly selectedReason = signal<CancellationReasonCode | null>(null);

  // Paso 1: textarea para "other"
  readonly otherReasonControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.maxLength(FEEDBACK_MAX)],
  });
  readonly otherReasonText = toSignal(this.otherReasonControl.valueChanges, {
    initialValue: '',
  });

  // Paso 2: feedback opcional/obligatorio según razón
  readonly retentionFeedbackControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.maxLength(FEEDBACK_MAX)],
  });
  readonly retentionFeedbackText = toSignal(
    this.retentionFeedbackControl.valueChanges,
    { initialValue: '' },
  );

  // Paso 3: toggle (default = al final del ciclo)
  readonly cancelAtEndOfCycle = signal<boolean>(true);

  // Paso 3: checkbox no-refund (obligatorio)
  readonly acknowledgedNoRefund = signal<boolean>(false);

  // Paso 3: type-to-confirm
  readonly requiredCancelText = CANCEL_CONFIRMATION_TEXT;
  readonly cancelConfirmControl = new FormControl<string>('', {
    nonNullable: true,
  });
  readonly cancelConfirmText = toSignal(this.cancelConfirmControl.valueChanges, {
    initialValue: '',
  });

  readonly maxFeedback = FEEDBACK_MAX;

  // ─── Reset flow each time the modal opens ──────────────────────────────────

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
      }
    });
  }

  // ─── Computed ──────────────────────────────────────────────────────────────

  readonly periodEndLabel = computed(() => {
    const value = this.currentPeriodEnd();
    if (!value) return null;
    try {
      return formatDateOnlyUTC(value);
    } catch {
      return null;
    }
  });

  readonly canAdvanceStep1 = computed(() => {
    const reason = this.selectedReason();
    if (!reason) return false;
    if (reason === 'other') {
      const text = this.otherReasonText().trim();
      return text.length > 0 && text.length <= FEEDBACK_MAX;
    }
    return true;
  });

  readonly canConfirmCancel = computed(() => {
    const matches =
      this.cancelConfirmText().trim() === CANCEL_CONFIRMATION_TEXT;
    return matches && this.acknowledgedNoRefund();
  });

  /** Resumen de la razón seleccionada para mostrar en pasos posteriores */
  readonly selectedReasonLabel = computed(() => {
    const code = this.selectedReason();
    return this.reasons.find((r) => r.code === code)?.label ?? '';
  });

  /** Razón final que se persiste (incluye texto libre para "other") */
  readonly finalReasonString = computed(() => {
    const code = this.selectedReason();
    if (!code) return '';
    if (code === 'other') {
      const text = this.otherReasonText().trim().slice(0, FEEDBACK_MAX);
      return text ? `other:${text}` : 'other';
    }
    return code;
  });

  // ─── Step navigation ───────────────────────────────────────────────────────

  selectReason(code: CancellationReasonCode): void {
    this.selectedReason.set(code);
    if (code !== 'other') {
      this.otherReasonControl.setValue('');
    }
  }

  goToStep2(): void {
    if (!this.canAdvanceStep1()) return;
    // "other" no tiene oferta de retención: skip directo a paso 3.
    if (this.selectedReason() === 'other') {
      this.step.set(3);
      return;
    }
    this.step.set(2);
  }

  goToStep3(): void {
    this.step.set(3);
  }

  goBack(): void {
    if (this.step() === 3) {
      // Si saltamos paso 2 (other), volver a paso 1
      this.step.set(this.selectedReason() === 'other' ? 1 : 2);
      return;
    }
    if (this.step() === 2) {
      this.step.set(1);
    }
  }

  // ─── Retention CTAs (Step 2) ───────────────────────────────────────────────

  goToPlansAndClose(): void {
    this.close();
    this.router.navigate(['/admin/subscription/plans']);
  }

  keepPlan(): void {
    // Usuario decide quedarse — cerrar modal sin cancelar
    this.close();
  }

  // ─── Final confirm ─────────────────────────────────────────────────────────

  confirm(): void {
    if (!this.canConfirmCancel()) return;
    const reason = this.finalReasonString();
    if (!reason) return;

    const payload: CancellationConfirmedPayload = {
      reason,
      immediate: !this.cancelAtEndOfCycle(),
      retentionOffered: this.selectedReason() !== 'other',
      retentionFeedback: this.retentionFeedbackText().trim() || undefined,
    };

    // TODO(G10): integrar `retentionFeedback` con email-processor cuando la razón sea
    // 'missing_features' o 'switched' para notificar al equipo de producto.
    this.confirmed.emit(payload);
  }

  close(): void {
    this.isOpen.set(false);
    this.closed.emit();
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private resetState(): void {
    this.step.set(1);
    this.selectedReason.set(null);
    this.otherReasonControl.reset('');
    this.retentionFeedbackControl.reset('');
    this.cancelAtEndOfCycle.set(true);
    this.acknowledgedNoRefund.set(false);
    this.cancelConfirmControl.reset('');
  }

  toggleAcknowledge(): void {
    this.acknowledgedNoRefund.update((v) => !v);
  }
}
