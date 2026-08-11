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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';

import { InvoiceResolution } from '../../../interfaces/invoice.interface';
import {
  createResolution,
  createResolutionFailure,
  createResolutionSuccess,
  updateResolution,
  updateResolutionFailure,
  updateResolutionSuccess,
} from '../../../state/actions/invoicing.actions';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import {
  DianResolutionFormComponent,
  configurationTypeFor,
  isFiscalDocumentType,
  type DianConfigurationType,
  type DianResolutionFormValue,
  type FiscalDocumentType,
  type FiscalReadinessResolution,
} from '../../../../../../../shared/components/dian';

/**
 * Fila editable, venga de donde venga.
 *
 * `GET {rail}/resolutions` devuelve `InvoiceResolution` (con la ClTec cruda) y
 * el agregado de estado fiscal devuelve `FiscalReadinessResolution` (que sólo
 * reporta `technical_key_set`). Las dos superficies abren ESTE modal, así que
 * el modal normaliza en vez de obligar a cada host a traducir — una traducción
 * por host es una oportunidad más de perder el `document_type` por el camino.
 */
export type EditableResolution = InvoiceResolution | FiscalReadinessResolution;

/**
 * Modal de alta/edición de resolución de numeración.
 *
 * ## Qué hace y qué NO hace
 *
 * NO tiene formulario propio: envuelve `DianResolutionFormComponent`, el
 * formulario COMPARTIDO con la consola de super admin. Antes sí lo tenía, y ese
 * formulario no conocía `document_type`: toda resolución creada desde aquí se
 * guardaba como factura electrónica de venta. Como el generador de consecutivos
 * busca la fila POR tipo de documento, registrar el rango del documento soporte
 * secuestraba la numeración de FEV — la siguiente factura de venta salía con un
 * consecutivo que la DIAN no autorizó para ella, y el número gastado no se
 * recupera.
 *
 * Lo que sí es suyo: la PERSISTENCIA. El formulario compartido emite el payload
 * y no llama al backend, porque cada consola persiste distinto. Este módulo usa
 * NgRx, así que aquí se despachan `createResolution` / `updateResolution` y se
 * escucha el par éxito/fallo para cerrar o mostrar el error del backend tal
 * como lo redactó.
 */
@Component({
  selector: 'vendix-resolution-create',
  standalone: true,
  imports: [ModalComponent, DianResolutionFormComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="isEditing() ? 'Editar resolución' : 'Nueva resolución'"
      [subtitle]="modalSubtitle()"
      size="md"
    >
      <div class="p-4">
        <!-- El formulario se reconstruye por resolución: su siembra corre una
             sola vez por fila y un modal reutilizado mostraría los datos de la
             resolución anterior. -->
        @if (isOpen()) {
          <app-dian-resolution-form
            [configurationType]="configurationType()"
            [resolution]="formResolution()"
            [documentType]="documentType()"
            [saving]="submitting()"
            [errorText]="errorText()"
            scannerScope="store"
            (save)="onSave($event)"
            (cancel)="onClose()"
          ></app-dian-resolution-form>
        }
      </div>
    </app-modal>
  `,
})
export class ResolutionCreateComponent {
  readonly isOpen = input<boolean>(false);
  readonly resolution = input<EditableResolution | null>(null);

  /**
   * Habilitación a la que pertenece una resolución NUEVA. En edición manda el
   * `document_type` de la fila: mover una resolución de eje la sacaría de la
   * habilitación que la autorizó.
   */
  readonly configurationTypeInput = input<DianConfigurationType>('invoicing', {
    alias: 'configurationType',
  });

  /** Preselección del documento dentro del eje, para el alta. */
  readonly documentType = input<FiscalDocumentType | null>(null);

  readonly isOpenChange = output<boolean>();
  /** Se guardó algo. El host recarga lo que tenga que recargar. */
  readonly saved = output<void>();

  private readonly store = inject(Store);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  readonly submitting = signal(false);
  /** Error del backend, ya redactado. Se muestra crudo dentro del formulario. */
  readonly errorText = signal<string | null>(null);

  readonly isEditing = computed(() => this.resolution() !== null);

  /**
   * La fila normalizada al tipo que entiende el formulario compartido.
   *
   * `technical_key_set` se deriva de la presencia del valor cuando la fila viene
   * de `GET resolutions` (que sí devuelve la ClTec) y se respeta tal cual cuando
   * viene del agregado (que sólo reporta su presencia). De él depende que editar
   * una factura de venta sin retocar la clave NO dispare `TECHNICAL_KEY_REQUIRED`
   * y obligue a reteclear un secreto que el servidor nunca devuelve.
   */
  readonly formResolution = computed<FiscalReadinessResolution | null>(() => {
    const row = this.resolution();
    if (!row) return null;

    const legacy = row as Partial<InvoiceResolution>;
    const aggregate = row as Partial<FiscalReadinessResolution>;

    return {
      id: row.id,
      document_type: this.documentTypeOf(row),
      prefix: row.prefix ?? null,
      range_from: row.range_from,
      range_to: row.range_to,
      current_number: row.current_number,
      valid_from: String(row.valid_from),
      valid_to: String(row.valid_to),
      is_active: row.is_active,
      technical_key_set:
        aggregate.technical_key_set ?? Boolean(legacy.technical_key),
      resolution_number: row.resolution_number ?? null,
      resolution_date: row.resolution_date ? String(row.resolution_date) : null,
    };
  });

  /** Eje efectivo: el de la fila en edición, el del input en alta. */
  readonly configurationType = computed<DianConfigurationType>(() => {
    const row = this.resolution();
    if (!row) return this.configurationTypeInput();
    return configurationTypeFor(this.documentTypeOf(row));
  });

  readonly modalSubtitle = computed(() =>
    this.isEditing()
      ? 'Los campos cambian según el documento que numera'
      : 'Elige primero qué documento numera este rango',
  );

  constructor() {
    // Abrir en limpio: un error del intento anterior sobre un formulario nuevo
    // acusa a datos que ya no están en pantalla.
    effect(() => {
      if (this.isOpen()) {
        this.errorText.set(null);
        this.submitting.set(false);
      }
    });

    this.actions$
      .pipe(
        ofType(createResolutionSuccess, updateResolutionSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.submitting.set(false);
        this.errorText.set(null);
        this.saved.emit();
        this.isOpenChange.emit(false);
      });

    this.actions$
      .pipe(
        ofType(createResolutionFailure, updateResolutionFailure),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ error }) => {
        this.submitting.set(false);
        // El modal NO se cierra: cerrar sobre un fallo tira lo tecleado y deja
        // al usuario adivinando qué campo rechazó el backend.
        this.errorText.set(
          error || 'No se pudo guardar la resolución. Revisa los datos.',
        );
      });
  }

  /**
   * Persiste el payload YA validado contra el contrato por el formulario.
   *
   * `technical_key` viaja sólo si el formulario la incluyó: en edición, un campo
   * vacío significa «deja la que está», y mandar `''` la destruiría sin que
   * nadie lo pidiera.
   */
  onSave(value: DianResolutionFormValue): void {
    this.submitting.set(true);
    this.errorText.set(null);

    const payload = {
      resolution_number: value.resolution_number,
      resolution_date: value.resolution_date,
      prefix: value.prefix,
      range_from: value.range_from,
      range_to: value.range_to,
      valid_from: value.valid_from,
      valid_to: value.valid_to,
      document_type: value.document_type,
      is_active: value.is_active,
      ...(value.technical_key ? { technical_key: value.technical_key } : {}),
    };

    const row = this.resolution();
    if (row) {
      this.store.dispatch(updateResolution({ id: row.id, resolution: payload }));
      return;
    }
    this.store.dispatch(createResolution({ resolution: payload }));
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  /** Tipo de la fila, con el mismo defecto que aplica el backend cuando falta. */
  private documentTypeOf(row: EditableResolution): FiscalDocumentType {
    const raw = (row as Partial<FiscalReadinessResolution>).document_type;
    return isFiscalDocumentType(raw) ? raw : 'sales_invoice';
  }
}
