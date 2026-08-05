import { Component, DestroyRef, computed, inject, input, output, signal, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
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
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  DianResolutionScanResult,
  RESOLUTION_SCAN_FIELD_LABELS,
} from '../../../../../../../shared/components/dian-resolution-scanner/interfaces/resolution-scan-result.interface';

@Component({
  selector: 'vendix-resolution-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="isEditing() ? 'Editar Resolución' : 'Nueva Resolución'"
      size="md"
    >
      <div class="p-4">
        <form [formGroup]="resolutionForm" (ngSubmit)="onSubmit()" class="space-y-4">

          @if (unverifiedFields().length > 0) {
            <!-- La IA precargó estos campos pero no pudo verificarlos (o los leyó
                 con baja confianza). Se listan porque la resolución autoriza
                 numeración legal: un dígito mal leído se descubre cuando la DIAN
                 rechaza la primera factura. -->
            <div
              class="rounded-lg border border-warning-300 bg-warning-light px-3 py-2 text-xs text-text-primary"
              role="note"
            >
              <p class="font-semibold mb-1">
                Verifica estos campos precargados por IA
              </p>
              <ul class="list-disc pl-5 space-y-0.5">
                @for (key of unverifiedFields(); track key) {
                  <li>{{ scanFieldLabel(key) }}</li>
                }
              </ul>
            </div>
          }

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Número de Resolución"
              formControlName="resolution_number"
              [control]="resolutionForm.get('resolution_number')"
              placeholder="Ej: 18764000001"
              [required]="true"
            ></app-input>

            <app-input
              label="Prefijo"
              formControlName="prefix"
              [control]="resolutionForm.get('prefix')"
              placeholder="Ej: FE"
              [required]="true"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Rango Desde"
              type="number"
              formControlName="range_from"
              [control]="resolutionForm.get('range_from')"
              [required]="true"
              min="1"
            ></app-input>

            <app-input
              label="Rango Hasta"
              type="number"
              formControlName="range_to"
              [control]="resolutionForm.get('range_to')"
              [required]="true"
              min="1"
            ></app-input>
          </div>

          <app-input
            label="Fecha de Resolución"
            type="date"
            formControlName="resolution_date"
            [control]="resolutionForm.get('resolution_date')"
            [required]="true"
          ></app-input>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Válida Desde"
              type="date"
              formControlName="valid_from"
              [control]="resolutionForm.get('valid_from')"
              [required]="true"
            ></app-input>

            <app-input
              label="Válida Hasta"
              type="date"
              formControlName="valid_to"
              [control]="resolutionForm.get('valid_to')"
              [required]="true"
            ></app-input>
          </div>

          <app-input
            label="Clave Técnica"
            formControlName="technical_key"
            [control]="resolutionForm.get('technical_key')"
            placeholder="Clave técnica DIAN (opcional)"
          ></app-input>

        </form>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-[var(--color-surface-secondary)] rounded-b-xl border-t border-border">
          <app-button
            variant="outline"
            (clicked)="onClose()">
            Cancelar
          </app-button>

          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="resolutionForm.invalid || submitting()"
            [loading]="submitting()">
            {{ isEditing() ? 'Actualizar' : 'Crear' }} Resolución
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class ResolutionCreateComponent {
  readonly isOpen = input<boolean>(false);
  readonly resolution = input<InvoiceResolution | null>(null);
  /**
   * Resultado de un escaneo IA con el que precargar el formulario. Entra como
   * input (y no como una llamada del padre) porque el padre no tiene acceso al
   * FormGroup: así el modal sigue siendo el único dueño de su formulario.
   */
  readonly prefill = input<DianResolutionScanResult | null>(null);
  readonly isOpenChange = output<boolean>();

  readonly submitting = signal(false);
  /** Campos que el escáner marcó para confirmación manual. */
  readonly unverifiedFields = computed(
    () => this.prefill()?.requires_manual_confirmation ?? [],
  );
  resolutionForm: FormGroup;

  private fb = inject(FormBuilder);
  private store = inject(Store);
  private actions$ = inject(Actions);
  private destroyRef = inject(DestroyRef);

  readonly isEditing = () => !!this.resolution();

  constructor() {
    this.resolutionForm = this.fb.group({
      resolution_number: ['', [Validators.required]],
      prefix: ['', [Validators.required]],
      range_from: [null, [Validators.required, Validators.min(1)]],
      range_to: [null, [Validators.required, Validators.min(1)]],
      resolution_date: ['', [Validators.required]],
      valid_from: ['', [Validators.required]],
      valid_to: ['', [Validators.required]],
      technical_key: [''],
    });

    effect(() => {
      const res = this.resolution();
      if (res) {
        this.resolutionForm.patchValue({
          resolution_number: res.resolution_number,
          prefix: res.prefix,
          range_from: res.range_from,
          range_to: res.range_to,
          resolution_date: res.resolution_date?.split('T')[0] || '',
          valid_from: res.valid_from?.split('T')[0] || '',
          valid_to: res.valid_to?.split('T')[0] || '',
          technical_key: res.technical_key || '',
        });
      } else {
        this.resolutionForm.reset();
      }
    });

    // Declarado DESPUÉS del efecto de `resolution` a propósito: cuando el padre
    // abre el modal en modo creación y precarga en el mismo flush, el reset de
    // arriba corre primero y este patch queda encima. Al revés, el reset borraría
    // lo escaneado.
    effect(() => {
      const scan = this.prefill();
      if (!scan) return;

      // Solo se copia lo que tiene valor: un campo que la IA no leyó se queda
      // vacío para que el usuario lo escriba, en vez de recibir un cero o una
      // fecha inventada.
      const patch: Record<string, string | number> = {};
      if (scan.resolution_number.value) {
        patch['resolution_number'] = scan.resolution_number.value;
      }
      if (scan.prefix.value) patch['prefix'] = scan.prefix.value;
      if (scan.range_from.value !== null) {
        patch['range_from'] = scan.range_from.value;
      }
      if (scan.range_to.value !== null) patch['range_to'] = scan.range_to.value;
      if (scan.resolution_date.value) {
        patch['resolution_date'] = scan.resolution_date.value;
      }
      if (scan.valid_from.value) patch['valid_from'] = scan.valid_from.value;
      if (scan.valid_to.value) patch['valid_to'] = scan.valid_to.value;
      if (scan.technical_key.value) {
        patch['technical_key'] = scan.technical_key.value;
      }

      this.resolutionForm.patchValue(patch);
      this.resolutionForm.markAllAsTouched();
    });

    this.actions$
      .pipe(
        ofType(createResolutionSuccess, updateResolutionSuccess),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.submitting.set(false);
        this.resolutionForm.reset();
        this.isOpenChange.emit(false);
      });

    this.actions$
      .pipe(
        ofType(createResolutionFailure, updateResolutionFailure),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.submitting.set(false);
      });
  }

  onSubmit(): void {
    if (this.resolutionForm.invalid) {
      this.resolutionForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const formValue = this.resolutionForm.value;

    const payload = {
      resolution_number: formValue.resolution_number,
      prefix: formValue.prefix,
      range_from: Number(formValue.range_from),
      range_to: Number(formValue.range_to),
      resolution_date: formValue.resolution_date,
      valid_from: formValue.valid_from,
      valid_to: formValue.valid_to,
      technical_key: formValue.technical_key || undefined,
    };

    const res = this.resolution();
    if (this.isEditing() && res) {
      this.store.dispatch(updateResolution({
        id: res.id,
        resolution: payload,
      }));
    } else {
      this.store.dispatch(createResolution({
        resolution: payload,
      }));
    }
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  /** Etiqueta legible de un campo señalado por el escáner. */
  scanFieldLabel(key: string): string {
    return (
      (RESOLUTION_SCAN_FIELD_LABELS as Record<string, string>)[key] ?? key
    );
  }
}
