import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { startWith } from 'rxjs/operators';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';

import * as InvoicingActions from '../../state/actions/invoicing.actions';
import { selectDianEventRegistering } from '../../state/selectors/invoicing.selectors';
import {
  dianEventOperationOptions,
  dianEventRegistrationOptions,
  dianEventUnsupportedReason,
} from '../../utils/dian-events.util';

/**
 * REGISTRAR UN EVENTO RADIAN SOBRE UNA FACTURA ACEPTADA.
 *
 * `POST /store/invoicing/:id/events` existía en el backend completo —firma, CUDE,
 * transmisión, persistencia— y NO TENÍA UN SOLO CLIENTE. El panel listaba los
 * eventos y no dejaba crear ninguno: la factura como título valor era, desde la
 * UI, un objeto de sólo lectura. Este modal es ese cliente.
 *
 * ## Tres decisiones que no son de estilo
 *
 * **1. Los eventos que el panel no puede registrar se muestran DESHABILITADOS,
 * con su motivo, en vez de esconderse.** Un comerciante que busca «Endoso en
 * propiedad» y no lo encuentra concluye que Vendix no lo tiene; leyendo «exige
 * los datos de la negociación» sabe que existe y qué falta. Ver
 * `DIAN_EVENT_UNSUPPORTED_IN_PANEL` en `utils/dian-events.util.ts`.
 *
 * **2. El tipo de operación se pregunta SÓLO cuando hay más de uno.** Con uno
 * solo el backend lo infiere (`assertOperationCode`) y un selector de una opción
 * es ruido. Con varios la elección es jurídica —endoso con o sin
 * responsabilidad, pago parcial o total— y el backend la EXIGE: adivinarla
 * registraría un acto distinto del que el comerciante quiso, y ese acto ya no se
 * deshace.
 *
 * **3. El modal NO se cierra salvo que RADIAN acepte.** El POST responde 200
 * aunque RADIAN rechace —el backend persiste la fila con `status: 'rejected'` y
 * la devuelve sin lanzar—, así que cerrar sobre el 200 dejaría al usuario
 * convencido de haber registrado un acuse que no existe. Se cierra sobre
 * `status === 'accepted'` y sobre nada más.
 */
@Component({
  selector: 'vendix-dian-event-register-modal',
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
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="onClose()"
      title="Registrar evento RADIAN"
      [subtitle]="subtitle()"
      size="md"
    >
      <!--
        NINGÚN ACENTO GRAVE DENTRO DE ESTE LITERAL: uno solo cierra el template
        string de TypeScript y produce una cascada de errores falsos.

        Sin p-4 propio: app-modal ya envuelve el cuerpo en px-4 py-3 md:px-5
        md:py-4 y el footer en px-4 py-3. Repetir el padding acá dejaba el
        formulario metido hacia adentro y el aire descuadrado contra el resto
        de los modales del panel.
      -->
      <form [formGroup]="form" class="space-y-4">
        <app-selector
          label="Evento"
          formControlName="eventCode"
          [options]="eventOptions()"
          [searchable]="true"
          [required]="true"
          placeholder="Selecciona el acto a registrar"
          helpText="Res. 000085/2022, numeral 14.2.1."
        ></app-selector>

        @if (unsupportedReason(); as reason) {
          <div
            class="flex items-start gap-2.5 p-3 rounded-lg border border-warning/30 bg-warning-light"
          >
            <app-icon
              name="alert-triangle"
              [size]="16"
              class="text-warning shrink-0 mt-0.5"
            />
            <div class="min-w-0">
              <p class="text-xs font-semibold text-warning">
                Este evento todavía no se registra desde el panel
              </p>
              <p class="text-xs text-text-secondary mt-0.5">{{ reason }}</p>
            </div>
          </div>
        }

        <!-- Sólo aparece cuando el evento admite más de un tipo de operación.
             Si aparece, es obligatorio: el backend rechaza el POST sin él. -->
        @if (operationOptions().length > 0) {
          <app-selector
            label="Tipo de operación"
            formControlName="operationCode"
            [options]="operationOptions()"
            [searchable]="true"
            [required]="true"
            placeholder="Selecciona el tipo de operación"
            helpText="Numeral 14.1.2. Determina el acto exacto que queda inscrito."
          ></app-selector>
        }

        <app-textarea
          label="Observaciones"
          formControlName="description"
          [rows]="3"
          placeholder="Opcional. Viaja a RADIAN dentro del evento."
        ></app-textarea>

        <!--
          Esto NO es una nota al pie: es el único hecho irreversible del modal.
          Va como aviso con jerarquía propia porque un párrafo gris del tamaño
          del texto de ayuda se lee como relleno legal y nadie lo mira.
        -->
        <div
          class="flex items-start gap-2.5 p-3 rounded-lg border border-amber-300/40 bg-amber-50/60 dark:bg-amber-500/10"
        >
          <app-icon
            name="zap"
            [size]="16"
            class="text-amber-600 shrink-0 mt-0.5"
          />
          <div class="min-w-0">
            <p class="text-xs font-semibold text-amber-700 dark:text-amber-400">
              El envío es inmediato y no se deshace
            </p>
            <p class="text-xs text-text-secondary mt-0.5">
              El evento se firma y se transmite al recibirlo, y gasta un
              consecutivo propio aunque RADIAN lo rechace. Revisa el acto antes
              de enviarlo.
            </p>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="ghost" (clicked)="onClose()">Cancelar</app-button>
        <app-button
          variant="primary"
          [loading]="registering()"
          [disabled]="!canSubmit()"
          (clicked)="onSubmit()"
          >Registrar evento</app-button
        >
      </div>
    </app-modal>
  `,
})
export class DianEventRegisterModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(Store);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly invoiceId = input.required<number>();
  readonly invoiceNumber = input<string>('');

  readonly registering = this.store.selectSignal(selectDianEventRegistering);

  readonly form = this.fb.group({
    eventCode: ['', Validators.required],
    operationCode: [''],
    description: [''],
  });

  /**
   * Los valores del formulario, PUENTEADOS A SIGNALS.
   *
   * `form.value` y `form.status` son propiedades planas, no signals: leerlos
   * dentro de un `computed` lo evalúa una sola vez con el estado inicial y no
   * vuelve a recomputar nunca. Con `canSubmit` eso deja el botón «Registrar»
   * apagado para siempre — el formulario nace inválido por el `required`.
   */
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.value)),
    { initialValue: this.form.value },
  );
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  private readonly eventCode = computed(
    () => this.formValue().eventCode?.trim() ?? '',
  );

  readonly subtitle = computed(() => {
    const number = this.invoiceNumber();
    return number ? `Factura ${number}` : 'Factura aceptada por la DIAN';
  });

  /**
   * Catálogo completo. Los que el panel no soporta viajan `disabled` con el
   * motivo en `description`, que el modo `searchable` sí pinta.
   */
  readonly eventOptions = computed<SelectorOption[]>(() =>
    dianEventRegistrationOptions().map((option) => ({
      value: option.value,
      label: option.label,
      disabled: option.unsupportedReason !== null,
      description: option.unsupportedReason ?? undefined,
    })),
  );

  readonly operationOptions = computed<SelectorOption[]>(() =>
    dianEventOperationOptions(this.eventCode()).map((option) => ({
      value: option.value,
      label: option.label,
    })),
  );

  readonly unsupportedReason = computed<string | null>(() => {
    const code = this.eventCode();
    return code ? dianEventUnsupportedReason(code) : null;
  });

  /**
   * El botón se apaga por TRES motivos distintos y todos son reales: formulario
   * incompleto, evento fuera del alcance del panel, o un tipo de operación
   * exigido y no elegido. El tercero no lo cubre `Validators` porque el control
   * es condicional: se valida acá contra la longitud de las opciones vigentes.
   */
  readonly canSubmit = computed(() => {
    if (this.registering() || this.formStatus() !== 'VALID') {
      return false;
    }
    const code = this.eventCode();
    if (!code || dianEventUnsupportedReason(code) !== null) {
      return false;
    }
    if (this.operationOptions().length > 0) {
      return Boolean(this.formValue().operationCode?.trim());
    }
    return true;
  });

  constructor() {
    // Cambiar de evento invalida el tipo de operación elegido: los códigos de
    // operación son propios de cada evento (`371` sólo existe bajo `037`), y
    // arrastrar el anterior mandaría al backend una combinación que rechaza.
    this.form.controls.eventCode.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.form.controls.operationCode.setValue('', {
        emitEvent: false,
      }));

    this.actions$
      .pipe(
        ofType(InvoicingActions.registerDianEventSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ invoiceId, event }) => {
        // Sólo se cierra sobre un evento ACEPTADO por RADIAN, y sólo si es de
        // esta factura: el effect ya cantó el veredicto por toast, y un rechazo
        // deja el formulario donde estaba para corregir sin volver a teclearlo.
        if (invoiceId === this.invoiceId() && event?.status === 'accepted') {
          this.reset();
          this.isOpen.set(false);
        }
      });
  }

  onSubmit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const value = this.formValue();
    const operationCode = value.operationCode?.trim();
    const description = value.description?.trim();

    this.store.dispatch(
      InvoicingActions.registerDianEvent({
        invoiceId: this.invoiceId(),
        event: {
          event_code: this.eventCode(),
          // Se omiten en vez de mandarse vacíos: el backend valida
          // `operation_code` contra la lista permitida y un `''` sería un
          // «tipo de operación no válido» en lugar de «no lo indicaste».
          ...(operationCode ? { operation_code: operationCode } : {}),
          ...(description ? { description } : {}),
        },
      }),
    );
  }

  onClose(): void {
    this.reset();
    this.isOpen.set(false);
  }

  private reset(): void {
    this.form.reset({ eventCode: '', operationCode: '', description: '' });
  }
}
