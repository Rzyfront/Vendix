import { Component, DestroyRef, computed, forwardRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';

import { DOCUMENT_TYPES, findDocumentType } from '../../constants/document-types';
import { InputComponent } from '../input/input.component';
import { SelectorComponent, SelectorOption, SelectorSize } from '../selector/selector.component';

/**
 * Valor compuesto tipo+número que este CVA lee/escribe como un solo control.
 * `documentType` es uno de los códigos de `DOCUMENT_TYPES` (o `''` sin elegir).
 */
export interface DocumentIdentityValue {
  documentType: string;
  documentNumber: string;
}

export const EMPTY_DOCUMENT_IDENTITY: DocumentIdentityValue = {
  documentType: '',
  documentNumber: '',
};

/**
 * Par tipo de documento + número de documento, como un único `ControlValueAccessor`.
 *
 * Este par se reimplementa de forma independiente —y con validaciones
 * divergentes— en cuatro pantallas: `pos-customer-selector`,
 * `pos-customer-modal`, `customer-modal` e `invoice-data` (público, todavía
 * con `ngModel`). Aquí el catálogo de tipos (`DOCUMENT_TYPES`), el placeholder
 * y el `maxLength` por tipo salen de `findDocumentType()` y de ningún otro
 * lado.
 *
 * MIGRACIÓN PARCIAL — a hoy sólo `pos-customer-selector` consume este CVA; es
 * la pantalla del carril de facturación bajo demanda y por eso fue la primera.
 * Las otras tres siguen con su copia y su propio catálogo, así que la
 * divergencia que este componente existe para cerrar sigue viva mientras no se
 * migren. No se hicieron en el mismo cambio para no mezclar un refactor de
 * cuatro pantallas con el carril fiscal; quien las toque después debe
 * reemplazar su `<app-selector>` + `<app-input>` por este control, no añadir
 * un quinto catálogo.
 *
 * No valida el FORMATO del número (regex/longitud): eso queda a criterio de
 * cada consumidor (algunos son tolerantes a propósito, como el resolver de
 * clientes del POS; otros —facturación— sí lo bloquean). Este control solo
 * evita que cuatro pantallas repitan el mismo `<app-selector>` + `<app-input>`
 * con nombres de opciones distintos.
 *
 * `:host { display: contents }` para que, dentro de un grid de 2 columnas del
 * consumidor (p. ej. `.form-row`), el selector y el número caigan cada uno en
 * su propia columna sin que este componente cuente como una tercera caja.
 *
 * El `<ng-content>` se proyecta junto al número (no al selector) para que un
 * consumidor pueda agregar su propio hint de formato debajo, como ya hacía
 * `pos-customer-selector` con `documentFormatHint()`.
 */
@Component({
  selector: 'app-document-identity-fields',
  standalone: true,
  imports: [ReactiveFormsModule, SelectorComponent, InputComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DocumentIdentityFieldsComponent),
      multi: true,
    },
  ],
  template: `
    <app-selector
      [formControl]="typeControl"
      [label]="typeLabel()"
      [options]="documentTypeOptions"
      [size]="size()"
      [placeholder]="typePlaceholder()"
      [required]="required()"
      (blur)="onBlur()"
    ></app-selector>
    <div class="document-identity-number-field">
      <app-input
        [formControl]="numberControl"
        [label]="numberLabel()"
        [placeholder]="numberPlaceholder()"
        [maxlength]="numberMaxLength()"
        type="text"
        [size]="size()"
        [required]="required()"
        (inputBlur)="onBlur()"
      ></app-input>
      <ng-content></ng-content>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .document-identity-number-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
    `,
  ],
})
export class DocumentIdentityFieldsComponent implements ControlValueAccessor {
  private readonly destroyRef = inject(DestroyRef);

  readonly typeLabel = input('Tipo Doc.');
  readonly numberLabel = input('Número');
  readonly typePlaceholder = input('Seleccionar');
  readonly size = input<SelectorSize>('md');
  readonly required = input(false);

  /** Catálogo único — mismo `DOCUMENT_TYPES` que usan reportes y validadores backend. */
  readonly documentTypeOptions: SelectorOption[] = DOCUMENT_TYPES.map((opt) => ({
    value: opt.code,
    label: opt.label,
  }));

  readonly typeControl = new FormControl<string>('', { nonNullable: true });
  readonly numberControl = new FormControl<string>('', { nonNullable: true });

  /**
   * Bridge Zoneless: `typeControl.value` es una propiedad plana, no una señal
   * (vendix-zoneless-signals). El placeholder/maxLength del número dependen del
   * tipo elegido, así que sin este bridge quedarían congelados en el valor
   * inicial ('') la primera vez que el consumidor cambia de tipo.
   *
   * Es una señal escribible y NO un `toSignal(valueChanges)` a propósito:
   * `writeValue` escribe con `emitEvent: false` —obligatorio para no
   * retroalimentar al formulario padre—, así que `valueChanges` no emite en un
   * `patchValue` del consumidor. Con `toSignal` el placeholder se quedaría en
   * el del tipo anterior cada vez que el valor entra por el formulario en vez
   * de por el usuario (editar un cliente ya guardado, precargar el documento
   * del comprador). Se actualiza en los dos caminos.
   */
  private readonly typeValue = signal(this.typeControl.value);

  readonly numberPlaceholder = computed(() => findDocumentType(this.typeValue())?.placeholder ?? '');
  readonly numberMaxLength = computed(() => findDocumentType(this.typeValue())?.maxLength ?? null);

  private onChange: (value: DocumentIdentityValue) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    this.typeControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.typeValue.set(value);
        this.emit();
      });
    this.numberControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.emit());
  }

  writeValue(value: DocumentIdentityValue | null): void {
    const documentType = value?.documentType ?? '';
    this.typeControl.setValue(documentType, { emitEvent: false });
    this.numberControl.setValue(value?.documentNumber ?? '', { emitEvent: false });
    this.typeValue.set(documentType);
  }

  registerOnChange(fn: (value: DocumentIdentityValue) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    const opts = { emitEvent: false };
    if (isDisabled) {
      this.typeControl.disable(opts);
      this.numberControl.disable(opts);
    } else {
      this.typeControl.enable(opts);
      this.numberControl.enable(opts);
    }
  }

  onBlur(): void {
    this.onTouched();
  }

  private emit(): void {
    this.onChange({
      documentType: this.typeControl.value,
      documentNumber: this.numberControl.value,
    });
  }
}
