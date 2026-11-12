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
            Ya hay un cliente registrado con {{ matchText() }}. No se creará un
            cliente duplicado.
          </p>
          <div class="rounded-xl border border-border bg-surface p-3 space-y-1">
            <p class="text-sm font-semibold text-text-primary">{{ name() }}</p>
            @if (documentLine()) {
              <p class="text-xs text-text-secondary">{{ documentLine() }}</p>
            }
            @if (c.email) {
              <p class="text-xs text-text-secondary">{{ c.email }}</p>
            }
            <div class="flex flex-wrap gap-1 pt-1">
              @for (f of c.matched_by ?? []; track f) {
                <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Coincide por {{ fieldLabel(f) }}
                </span>
              }
            </div>
          </div>
          @if (c.other_matches?.length) {
            <div class="rounded-xl border border-warning/40 bg-warning/5 p-3">
              <p class="text-xs font-semibold text-text-primary">También coincide:</p>
              <ul class="mt-1 space-y-0.5">
                @for (o of c.other_matches; track o.id) {
                  <li class="text-xs text-text-secondary">
                    {{ o.display_name }} — por {{ fieldsLabel(o.matched_by) }}
                  </li>
                }
              </ul>
            </div>
          }

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

  readonly matchText = computed(() => {
    const f = this.existing()?.matched_by ?? ['document'];
    if (f.includes('document') && f.includes('email')) {
      return 'esta identificación y este correo';
    }
    return f.includes('email') ? 'este correo' : 'esta identificación';
  });

  fieldLabel(f: string): string {
    return f === 'email' ? 'correo' : 'identificación';
  }

  fieldsLabel(fields: string[]): string {
    return fields.map((f) => this.fieldLabel(f)).join(' y ');
  }

  onOpenChange(open: boolean): void {
    if (!open) this.cancelled.emit();
  }
}
