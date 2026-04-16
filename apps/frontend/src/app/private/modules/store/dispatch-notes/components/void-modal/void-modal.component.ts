import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  OnInit,
  OnDestroy,
} from '@angular/core';

import {
  ReactiveFormsModule,
  FormGroup,
  FormBuilder,
  Validators,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import {
  ModalComponent,
  ButtonComponent,
  TextareaComponent,
  IconComponent,
} from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DispatchNote } from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-void-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    TextareaComponent,
    IconComponent
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Anular Remision"
      size="md"
      >
      <!-- Header icon -->
      <div slot="header" class="flex items-center justify-center w-10 h-10 rounded-full bg-red-100">
        <app-icon name="alert-triangle" [size]="20" class="text-red-600"></app-icon>
      </div>
    
      <!-- Body -->
      <div class="space-y-5">
        <!-- Warning Banner -->
        <div class="rounded-xl bg-red-50 border border-red-200 p-4">
          <div class="flex gap-3">
            <app-icon name="alert-triangle" [size]="20" class="text-red-600 flex-shrink-0 mt-0.5"></app-icon>
            <div class="space-y-1">
              <p class="text-[var(--fs-sm)] font-[var(--fw-medium)] text-red-800">
                Esta accion no se puede deshacer.
              </p>
              <p class="text-[var(--fs-sm)] text-red-700">
                Se liberaran las reservas de inventario asociadas a esta remision.
              </p>
              @if (dispatchNote().status === 'confirmed') {
                <p
                  class="text-[var(--fs-sm)] text-red-700"
                  >
                  El stock reservado sera liberado y quedara disponible nuevamente.
                </p>
              }
            </div>
          </div>
        </div>
    
        <!-- Summary Card -->
        <div class="rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">Remision</span>
            <span class="text-[var(--fs-base)] font-[var(--fw-semibold)] text-[var(--color-text-primary)]">
              {{ dispatchNote().dispatch_number }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">Cliente</span>
            <span class="text-[var(--fs-sm)] text-[var(--color-text-primary)]">
              {{ dispatchNote().customer_name }}
            </span>
          </div>
          <div class="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
            <span class="text-[var(--fs-sm)] font-[var(--fw-medium)] text-[var(--color-text-secondary)]">Total</span>
            <span class="text-[var(--fs-base)] font-[var(--fw-semibold)] text-[var(--color-text-primary)]">
              {{ formatCurrency(dispatchNote().grand_total) }}
            </span>
          </div>
        </div>
    
        <!-- Form -->
        <form [formGroup]="form" class="space-y-4">
          <div>
            <app-textarea
              label="Motivo de anulacion"
              formControlName="void_reason"
              placeholder="Describe el motivo por el cual se anula esta remision..."
              [rows]="4"
              [required]="true"
              [control]="form.get('void_reason')"
            ></app-textarea>
            <p class="mt-1.5 text-[var(--fs-xs)]"
               [class]="reasonLength() >= 10
                 ? 'text-emerald-600'
                 : 'text-[var(--color-text-secondary)]'"
              >
              {{ reasonLength() }}/10 caracteres minimo
            </p>
          </div>
    
          <!-- Confirmation Checkbox -->
          <label
            class="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] cursor-pointer select-none hover:bg-[var(--color-background)] transition-colors duration-150"
            >
            <input
              type="checkbox"
              class="mt-0.5 h-5 w-5 rounded border-gray-300 text-red-600 focus:ring-red-500 cursor-pointer flex-shrink-0"
              [checked]="confirmChecked()"
              (change)="confirmChecked.set(!confirmChecked())"
              />
            <span class="text-[var(--fs-sm)] text-[var(--color-text-primary)]">
              Confirmo que deseo anular esta remision de forma permanente
            </span>
          </label>
        </form>
      </div>
    
      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="danger"
            iconName="x-circle"
            [disabled]="!canVoid()"
            (clicked)="onVoid()"
            >
            Anular Remision
          </app-button>
        </div>
      </div>
    </app-modal>
    `,
})
export class VoidModalComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly dispatchNote = input.required<DispatchNote>();
  readonly voided = output<{ void_reason: string }>();

  readonly confirmChecked = signal(false);
  readonly reasonLength = signal(0);

  form: FormGroup = this.fb.group({
    void_reason: ['', [Validators.required, Validators.minLength(10)]],
  });

  readonly canVoid = computed(() => {
    return this.reasonLength() >= 10 && this.confirmChecked();
  });

  ngOnInit(): void {
    this.form.get('void_reason')!.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe((val: string) => {
        this.reasonLength.set((val || '').length);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  formatCurrency(value: any): string {
    return this.currencyService.format(Number(value) || 0);
  }

  onVoid(): void {
    if (!this.canVoid()) return;
    const { void_reason } = this.form.value;
    this.voided.emit({ void_reason: void_reason.trim() });
  }

  onClose(): void {
    this.form.reset({ void_reason: '' });
    this.confirmChecked.set(false);
    this.isOpenChange.emit(false);
  }
}
