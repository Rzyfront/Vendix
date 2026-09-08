import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';

/**
 * Asks for the courier name ("domiciliario") before a direct full delivery.
 * Used ONLY by the rapid-dispatch path ("Entrega completa"): the operator
 * types the free-text name, confirms, and the parent passes it to
 * `POST /store/dispatch-notes/:id/deliver { courier_name }`.
 *
 * Zoneless-clean: signal input + signal outputs only. Form validity is NOT
 * read inside a `computed()` (plain property, never re-evaluates) — it is
 * bridged via `toSignal(statusChanges)` per `vendix-zoneless-signals`.
 */
@Component({
  selector: 'app-courier-name-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    IconComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      (closed)="onClose()"
      title="¿Quién lleva el despacho?"
      subtitle="Se guardará en la remisión y aparecerá en el tiquete"
      size="sm"
    >
      <div slot="header" class="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-100">
        <app-icon name="truck" [size]="20" class="text-emerald-600"></app-icon>
      </div>

      <form [formGroup]="form" (ngSubmit)="onConfirm()" class="space-y-4">
        <app-input
          label="Nombre del domiciliario"
          formControlName="courier_name"
          placeholder="Ej. Juan Pérez"
          [control]="form.get('courier_name')"
          [maxlength]="255"
          [error]="courierError()"
        ></app-input>
      </form>

      <div slot="footer">
        <div class="flex items-center justify-end gap-3">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            [disabled]="!canConfirm()"
            (clicked)="onConfirm()"
          >
            Confirmar entrega
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class CourierNameModalComponent {
  private fb = inject(FormBuilder);

  /** Controls modal visibility from the parent. */
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  /** Emitted with the trimmed courier name when the operator confirms. */
  readonly confirmed = output<string>();
  /** Emitted when the operator dismisses the modal (cancel = abort). */
  readonly closed = output<void>();

  readonly form = this.fb.group({
    courier_name: ['', [Validators.required, Validators.maxLength(255)]],
  });

  /**
   * Zoneless bridge: `form.status` is a plain property, so a `computed()`
   * reading it would freeze on the initial value. This signal re-emits on
   * every validity change instead.
   */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly canConfirm = computed(() => this.formStatus() === 'VALID');

  /** Plain method (not computed): reads control state fresh on each CD run. */
  courierError(): string | undefined {
    const control = this.form.get('courier_name');
    if (!control || !(control.touched || control.dirty)) return undefined;
    if (control.hasError('required')) return 'El nombre del domiciliario es obligatorio';
    if (control.hasError('maxlength')) return 'Máximo 255 caracteres';
    return undefined;
  }

  onConfirm(): void {
    const name = (this.form.value.courier_name || '').trim();
    if (!name || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.confirmed.emit(name);
    this.form.reset();
  }

  onClose(): void {
    this.form.reset();
    this.isOpenChange.emit(false);
    this.closed.emit();
  }
}
