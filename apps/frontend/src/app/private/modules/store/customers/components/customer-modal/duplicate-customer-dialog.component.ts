import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
} from '../../../../../../shared/components';
import { getDocumentTypeLabel } from '../../../../../../shared/constants/document-types';
import { customerDisplayName } from '../../../../../../shared/utils/customer-display-name.util';
import { ExistingCustomerSummary } from '../../models/customer.model';

/**
 * Diálogo «Este cliente ya existe»: se muestra cuando crear un cliente choca
 * con un documento ya registrado. Es presentacional: el padre ejecuta la
 * acción elegida (editar el existente, agregar la dirección como ubicación
 * o cancelar y dejar el formulario como estaba).
 */
@Component({
  selector: 'app-duplicate-customer-dialog',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, InputComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      (cancel)="cancelled.emit()"
      size="md"
      title="Este cliente ya existe"
    >
      @if (existing(); as c) {
        <div class="space-y-4">
          <p class="text-sm text-text-primary">
            Ya hay un cliente registrado con este documento. No se creará un
            cliente duplicado.
          </p>
          <div class="rounded-xl border border-border bg-surface p-3">
            <p class="text-sm font-semibold text-text-primary">{{ name() }}</p>
            @if (documentLine()) {
              <p class="text-xs text-text-secondary">{{ documentLine() }}</p>
            }
          </div>

          <div class="space-y-1">
            <app-input
              label="Nombre de la sede (opcional)"
              placeholder="Ej: Sede Norte"
              [maxlength]="120"
              [disabled]="!hasAddress()"
              [(ngModel)]="siteName"
            ></app-input>
            @if (!hasAddress()) {
              <p class="text-xs text-text-secondary">
                Completa la dirección para agregarla como ubicación
              </p>
            }
          </div>
        </div>
      }
      <div slot="footer" class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <app-button variant="ghost" [disabled]="loading()" (clicked)="cancelled.emit()">
          Cancelar
        </app-button>
        <app-button variant="outline" [disabled]="loading()" (clicked)="editExisting.emit()">
          Editar cliente existente
        </app-button>
        <app-button
          variant="primary"
          [disabled]="!hasAddress() || loading()"
          [loading]="loading()"
          (clicked)="addLocation.emit(siteName().trim())"
        >
          Agregar como nueva ubicación
        </app-button>
      </div>
    </app-modal>
  `,
})
export class DuplicateCustomerDialogComponent {
  readonly isOpen = input(false);
  readonly existing = input<ExistingCustomerSummary | null>(null);
  /** Hay una dirección válida capturada en el formulario. */
  readonly hasAddress = input(false);
  readonly loading = input(false);

  readonly editExisting = output<void>();
  /** Emite el nombre de sede escrito (puede ser cadena vacía). */
  readonly addLocation = output<string>();
  readonly cancelled = output<void>();

  readonly siteName = signal('');

  readonly name = computed(() =>
    customerDisplayName(this.existing(), 'Cliente existente'),
  );

  readonly documentLine = computed(() => {
    const c = this.existing();
    if (!c?.document_number) return '';
    const type = c.document_type ? getDocumentTypeLabel(c.document_type) : '';
    return `${type ? type + ' ' : ''}${c.document_number}`;
  });

  onOpenChange(open: boolean): void {
    if (!open) this.cancelled.emit();
  }
}
