import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';

import { JournalEntry } from '../../../interfaces/accounting.interface';
import { postEntry, voidEntry, loadEntry } from '../../../state/actions/accounting.actions';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'vendix-journal-entry-detail',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="'Entry ' + (entry?.entry_number || '')"
      size="lg"
    >
      @if (entry) {
        <div class="p-4 space-y-4">
          <!-- Header Info -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-gray-500">Número</p>
              <p class="text-sm font-medium">{{ entry.entry_number }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Fecha</p>
              <p class="text-sm font-medium">{{ entry.entry_date | date:'mediumDate' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Tipo</p>
              <p class="text-sm font-medium capitalize">{{ entry.entry_type }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Estado</p>
              <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                    [class]="getStatusClasses(entry.status)">
                {{ getStatusLabel(entry.status) }}
              </span>
            </div>
          </div>

          @if (entry.description) {
            <div>
              <p class="text-xs text-gray-500">Descripción</p>
              <p class="text-sm">{{ entry.description }}</p>
            </div>
          }

          <!-- Lines Table -->
          <div class="mt-4">
            <h4 class="text-sm font-semibold text-text-primary mb-2">Líneas del Asiento</h4>

            <div class="border border-border rounded-lg overflow-hidden">
              <!-- Header -->
              <div class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2 bg-gray-50
                          text-xs font-semibold text-gray-500 uppercase">
                <div class="col-span-2">Código</div>
                <div class="col-span-4">Cuenta</div>
                <div class="col-span-2">Descripción</div>
                <div class="col-span-2 text-right">Débito</div>
                <div class="col-span-2 text-right">Crédito</div>
              </div>

              <!-- Lines -->
              @if (entry.lines?.length) {
                <div class="divide-y divide-border">
                  @for (line of entry.lines; track line.id) {
                    <!-- Mobile -->
                    <div class="md:hidden p-3">
                      <div class="flex justify-between items-start">
                        <div>
                          <p class="text-sm font-medium">{{ line.account?.code }} - {{ line.account?.name }}</p>
                          @if (line.description) {
                            <p class="text-xs text-gray-500 mt-0.5">{{ line.description }}</p>
                          }
                        </div>
                        <div class="text-right">
                          @if (line.debit_amount > 0) {
                            <p class="text-sm font-mono text-blue-600">D: {{ line.debit_amount | number:'1.2-2' }}</p>
                          }
                          @if (line.credit_amount > 0) {
                            <p class="text-sm font-mono text-green-600">C: {{ line.credit_amount | number:'1.2-2' }}</p>
                          }
                        </div>
                      </div>
                    </div>
                    <!-- Desktop -->
                    <div class="hidden md:grid md:grid-cols-12 gap-2 px-4 py-2 items-center">
                      <div class="col-span-2 text-sm font-mono text-gray-600">{{ line.account?.code }}</div>
                      <div class="col-span-4 text-sm">{{ line.account?.name }}</div>
                      <div class="col-span-2 text-sm text-gray-500">{{ line.description || '-' }}</div>
                      <div class="col-span-2 text-right text-sm font-mono">
                        {{ line.debit_amount > 0 ? (line.debit_amount | number:'1.2-2') : '-' }}
                      </div>
                      <div class="col-span-2 text-right text-sm font-mono">
                        {{ line.credit_amount > 0 ? (line.credit_amount | number:'1.2-2') : '-' }}
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Totals -->
              <div class="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 border-t border-border">
                <div class="col-span-8 text-sm font-semibold">Totales</div>
                <div class="col-span-2 text-right text-sm font-mono font-bold">
                  {{ entry.total_debit | number:'1.2-2' }}
                </div>
                <div class="col-span-2 text-right text-sm font-mono font-bold">
                  {{ entry.total_credit | number:'1.2-2' }}
                </div>
              </div>
            </div>
          </div>
        </div>
      }

      <div slot="footer">
        <div class="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <div class="flex items-center gap-2">
            @if (entry?.status === 'draft') {
              <app-button variant="primary" (clicked)="onPost()">
                <app-icon name="check" [size]="14"></app-icon>
                Contabilizar
              </app-button>
            }
            @if (entry?.status === 'posted') {
              <app-button variant="outline" (clicked)="onVoid()">
                <app-icon name="x" [size]="14"></app-icon>
                Anular Asiento
              </app-button>
            }
          </div>
          <app-button variant="outline" (clicked)="onClose()">Cerrar</app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class JournalEntryDetailComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Input() entry: JournalEntry | null = null;

  private store = inject(Store);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['entry'] && this.entry?.id && this.isOpen) {
      // Load full entry with lines
      this.store.dispatch(loadEntry({ id: this.entry.id }));
    }
  }

  onPost(): void {
    if (this.entry) {
      this.store.dispatch(postEntry({ id: this.entry.id }));
      this.onClose();
    }
  }

  onVoid(): void {
    if (this.entry && confirm('¿Estás seguro de que deseas anular este asiento? Esta acción no se puede deshacer.')) {
      this.store.dispatch(voidEntry({ id: this.entry.id }));
      this.onClose();
    }
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      posted: 'Contabilizado',
      voided: 'Anulado',
    };
    return labels[status] || status;
  }

  getStatusClasses(status: string): string {
    const classes: Record<string, string> = {
      draft: 'bg-amber-50 text-amber-700',
      posted: 'bg-emerald-50 text-emerald-700',
      voided: 'bg-red-50 text-red-700',
    };
    return classes[status] || 'bg-gray-100 text-gray-600';
  }
}
