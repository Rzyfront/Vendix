import { Component, effect, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../../../../shared/components/tooltip/tooltip.component';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';

/**
 * Local mirror of `ReservationsSettings`. Kept separate from the
 * `core/models/store-settings.interface.ts` declaration so this
 * component stays self-contained — the parent's `settingsChange`
 * handler already coerces the shape.
 */
export interface ReservationsSettings {
  /**
   * When true (default), customers reschedule a booking with a single
   * click — the booking moves to the new slot immediately and the
   * admin gets an in-app broadcast. When false, the customer's
   * reschedule becomes a PENDING REQUEST routed through
   * `booking_reschedule_requests` and the booking stays at its current
   * slot until an admin approves or rejects it.
   */
  allow_direct_reschedule: boolean;
}

/**
 * Una de las dos caras de la política de reagendamiento. El copy sale del
 * comportamiento real de `ReservationsService.reschedule` (backend): ON toma
 * `reschedule_direct_path()`, OFF crea una fila en
 * `booking_reschedule_requests` con status `pending`.
 */
interface ReschedulePolicyFace {
  /** Valor de `allow_direct_reschedule` que activa esta cara. */
  readonly active: boolean;
  readonly icon: 'zap' | 'shield-check';
  readonly title: string;
  /** Qué ocurre, en una frase, desde la perspectiva del cliente. */
  readonly effect: string;
  /** Lo que se gana. */
  readonly gain: string;
  /** Lo que se paga por elegir esta cara. */
  readonly cost: string;
}

const RESCHEDULE_POLICY_FACES: ReadonlyArray<ReschedulePolicyFace> = [
  {
    active: true,
    icon: 'zap',
    title: 'Activo — reagenda directa',
    effect:
      'El cliente elige otro horario disponible y su reserva se mueve al instante, sin esperar a nadie.',
    gain: 'Cero fricción para el cliente y cero trabajo manual para tu equipo.',
    cost: 'Pierdes control de la agenda: un cliente puede liberar un horario pico y tomar otro que preferirías reservar.',
  },
  {
    active: false,
    icon: 'shield-check',
    title: 'Inactivo — requiere aprobación',
    effect:
      'La reserva NO se mueve. Queda una solicitud pendiente y el horario original se conserva hasta que alguien la apruebe.',
    gain: 'Controlas la agenda: ningún cambio entra sin que tu equipo lo revise.',
    cost: 'Alguien tiene que atender la cola. Una solicitud sin responder deja al cliente esperando y con la cita vieja en pie.',
  },
];

/**
 * ReservationsSettingsForm
 *
 * Standalone card for the 'Reservas' policy. Renders the toggle
 * `¿Permitir reagendamiento directo?` plus the indicative material that
 * explains both faces of the policy and what each one costs.
 *
 * Pattern: same as OperationsSettingsForm — receives the settings
 * object as a signal input, mirrors it into an internal FormGroup,
 * and emits the fresh value on `settingsChange` whenever the user
 * toggles the switch. The parent (GeneralSettingsComponent) is
 * responsible for plumbing the value into the persisted settings
 * payload.
 *
 * Mobile-first: iOS-style toggle, 44px+ touch target.
 */
@Component({
  selector: 'app-reservations-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    SettingToggleComponent,
    AlertBannerComponent,
    BadgeComponent,
    TooltipComponent,
    ExpandableCardComponent,
  ],
  templateUrl: './reservations-settings-form.component.html',
  styleUrls: ['./reservations-settings-form.component.scss'],
})
export class ReservationsSettingsForm {
  readonly settings = input.required<ReservationsSettings>();
  readonly settingsChange = output<ReservationsSettings>();

  readonly policyFaces = RESCHEDULE_POLICY_FACES;

  /**
   * Espejo en señal del valor del toggle. El FormControl no es una señal, así
   * que la comparativa de consecuencias no podría resaltar la cara vigente si
   * la leyera del formulario dentro de un `computed`. Se empuja desde el effect
   * de carga y desde `onFieldChange()`.
   */
  readonly allowDirectReschedule = signal(true);

  /** Panel colapsable con el paso a paso de cada ruta. */
  readonly flowHelpOpen = signal(false);

  /**
   * Internal FormGroup. We seed the toggle with the legacy default
   * (true) so the form is never "undefined" before the parent
   * dispatches the first settings payload. The effect below patches
   * the real value as soon as `settings()` emits.
   */
  form: FormGroup = new FormGroup({
    allow_direct_reschedule: new FormControl<boolean>(true, {
      nonNullable: true,
    }),
  });

  /** Typed accessor for the FormControl. */
  get allowDirectRescheduleControl(): FormControl<boolean> {
    return this.form.get('allow_direct_reschedule') as FormControl<boolean>;
  }

  constructor() {
    // Sync the FormGroup whenever the parent dispatches a new
    // settings payload. emitEvent: false so we don't bounce the
    // value back through settingsChange.
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
        this.allowDirectReschedule.set(
          this.allowDirectRescheduleControl.value === true,
        );
      }
    });
  }

  onFieldChange(): void {
    this.allowDirectReschedule.set(
      this.allowDirectRescheduleControl.value === true,
    );
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value as ReservationsSettings);
    }
  }
}
