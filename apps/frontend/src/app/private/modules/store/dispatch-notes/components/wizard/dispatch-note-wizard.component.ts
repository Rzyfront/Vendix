import {
  Component,
  HostListener,
  inject,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { switchMap, of } from 'rxjs';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../shared/components';
import {
  DispatchNoteWizardService,
  type WizardCreateAction,
} from '../../services/dispatch-note-wizard.service';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNotePrintService } from '../../services/dispatch-note-print.service';
import type {
  DispatchNote,
  CreateDispatchNoteDto,
  CreateDispatchNoteItemDto,
} from '../../interfaces/dispatch-note.interface';

import { CustomerStepComponent } from './customer-step.component';
import { ProductsStepComponent } from './products-step.component';
import { DetailsStepComponent } from './details-step.component';
import { ReviewStepComponent } from './review-step.component';

@Component({
  selector: 'app-dispatch-note-wizard',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    StepsLineComponent,
    CustomerStepComponent,
    ProductsStepComponent,
    DetailsStepComponent,
    ReviewStepComponent,
  ],
  providers: [DispatchNoteWizardService],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nueva Remision"
      size="lg"
      [showCloseButton]="true"
    >
      <!-- Steps Header -->
      <div class="px-4 py-2 border-b border-[var(--color-border)]">
        <app-steps-line
          [steps]="wizardService.stepsConfig()"
          [currentStep]="wizardService.currentStep()"
          [clickable]="true"
          (stepClicked)="onStepClicked($event)"
          size="md"
        ></app-steps-line>
        <!-- Step hint line -->
        <p class="text-xs text-[var(--color-text-muted)] mt-1.5 mb-0.5">
          @switch (wizardService.currentStep()) {
            @case (0) {
              Selecciona el cliente para la remision
            }
            @case (1) {
              Agrega los productos a despachar
            }
            @case (2) {
              Configura fechas, ubicacion y notas
            }
            @case (3) {
              Revisa y confirma la remision
            }
          }
        </p>
      </div>

      <!-- Step Content -->
      <div class="p-4 max-h-[50vh] overflow-y-auto">
        @switch (wizardService.currentStep()) {
          @case (0) {
            <app-dispatch-wizard-customer-step />
          }
          @case (1) {
            <app-dispatch-wizard-products-step />
          }
          @case (2) {
            <app-dispatch-wizard-details-step />
          }
          @case (3) {
            <app-dispatch-wizard-review-step
              [created]="isCreated()"
              [createdNote]="createdNote()"
              [completedAction]="wizardService.createAction()"
              (goToStep)="wizardService.goToStep($event)"
              (viewDetail)="onViewDetail($event)"
              (createAnother)="onCreateAnother()"
              (printNote)="onPrint($event)"
            />
          }
        }
      </div>

      <!-- Footer Navigation -->
      <div slot="footer">
        <div
          class="flex items-center justify-between px-4 py-2.5
                 bg-[var(--color-surface-elevated)] border-t border-[var(--color-border)]"
        >
          <!-- Left: Back button -->
          @if (wizardService.currentStep() > 0 && !isCreated()) {
            <app-button
              variant="outline"
              (clicked)="wizardService.previousStep()"
            >
              <app-icon name="arrow-left" [size]="16" slot="icon"></app-icon>
              Anterior
            </app-button>
          } @else {
            <div></div>
          }

          <!-- Right: Next/Create button -->
          @if (wizardService.currentStep() < 3 && !isCreated()) {
            <app-button
              variant="primary"
              (clicked)="wizardService.nextStep()"
              [disabled]="!wizardService.canProceed()"
            >
              Siguiente
              <app-icon name="arrow-right" [size]="16" slot="icon"></app-icon>
            </app-button>
          } @else if (!isCreated()) {
            <div class="relative flex items-center">
              <app-button
                variant="primary"
                (clicked)="onCreate()"
                [disabled]="!wizardService.canProceed() || isSubmitting()"
                [loading]="isSubmitting()"
                [showTextWhileLoading]="true"
                customClasses="!rounded-r-none"
              >
                {{ createActionLabel() }}
              </app-button>
              <button
                type="button"
                data-action-menu
                class="h-10 sm:h-11 px-2 bg-[var(--color-primary)] text-[var(--color-text-on-primary)]
                       rounded-r-xl border-l border-white/20
                       hover:bg-[var(--color-primary)]/80 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center"
                [disabled]="isSubmitting()"
                (click)="toggleActionMenu($event)"
              >
                <app-icon name="chevron-down" [size]="14"></app-icon>
              </button>

              @if (showActionMenu()) {
                <div
                  data-action-menu
                  class="absolute bottom-full right-0 mb-1.5 w-52 rounded-xl border border-[var(--color-border)]
                         bg-[var(--color-surface)] shadow-lg z-10 py-1 overflow-hidden"
                >
                  <button
                    type="button"
                    class="w-full text-left px-3.5 py-2.5 text-sm transition-colors flex items-center gap-2"
                    [class]="
                      wizardService.createAction() === 'draft'
                        ? 'bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]'
                        : 'hover:bg-[var(--color-background)] text-[var(--color-text-primary)]'
                    "
                    (click)="selectAction('draft')"
                  >
                    <app-icon name="file-text" [size]="15"></app-icon>
                    Crear (Borrador)
                  </button>
                  <button
                    type="button"
                    class="w-full text-left px-3.5 py-2.5 text-sm transition-colors flex items-center gap-2"
                    [class]="
                      wizardService.createAction() === 'confirm'
                        ? 'bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]'
                        : 'hover:bg-[var(--color-background)] text-[var(--color-text-primary)]'
                    "
                    (click)="selectAction('confirm')"
                  >
                    <app-icon name="check-circle" [size]="15"></app-icon>
                    Crear y Confirmar
                  </button>
                  <button
                    type="button"
                    class="w-full text-left px-3.5 py-2.5 text-sm transition-colors flex items-center gap-2"
                    [class]="
                      wizardService.createAction() === 'invoice'
                        ? 'bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]'
                        : 'hover:bg-[var(--color-background)] text-[var(--color-text-primary)]'
                    "
                    (click)="selectAction('invoice')"
                  >
                    <app-icon name="file-check" [size]="15"></app-icon>
                    Crear y Facturar
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class DispatchNoteWizardComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly dispatchNotesService = inject(DispatchNotesService);
  private readonly toast = inject(ToastService);
  private readonly printService = inject(DispatchNotePrintService);

  // Inputs
  readonly isOpen = input<boolean>(false);

  // Outputs
  readonly isOpenChange = output<boolean>();
  readonly created = output<DispatchNote>();

  // Local state
  readonly isSubmitting = signal(false);
  readonly isCreated = signal(false);
  readonly createdNote = signal<DispatchNote | null>(null);
  readonly showActionMenu = signal(false);
  readonly createActionLabel = computed(() => {
    switch (this.wizardService.createAction()) {
      case 'confirm':
        return 'Crear y Confirmar';
      case 'invoice':
        return 'Crear y Facturar';
      default:
        return 'Crear Remision';
    }
  });

  onStepClicked(index: number): void {
    // Only allow going back, not forward
    if (index <= this.wizardService.currentStep()) {
      this.wizardService.goToStep(index);
    }
  }

  onCreate(): void {
    this.isSubmitting.set(true);

    const customer = this.wizardService.customer();
    const items = this.wizardService.items();
    const details = this.wizardService.details();

    if (!customer) {
      this.toast.error('Debes seleccionar un cliente');
      this.isSubmitting.set(false);
      return;
    }

    if (items.length === 0) {
      this.toast.error('Debes agregar al menos un producto');
      this.isSubmitting.set(false);
      return;
    }

    const dtoItems: CreateDispatchNoteItemDto[] = items.map((item) => ({
      product_id: item.product_id,
      product_variant_id: item.product_variant_id || undefined,
      location_id: item.location_id || undefined,
      ordered_quantity: item.ordered_quantity,
      dispatched_quantity: item.dispatched_quantity,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount,
      tax_amount: item.tax_amount,
      lot_serial: item.lot_serial || undefined,
    }));

    const dto: CreateDispatchNoteDto = {
      customer_id: customer.id,
      dispatch_location_id: details.dispatch_location_id || undefined,
      emission_date: details.emission_date || undefined,
      agreed_delivery_date: details.agreed_delivery_date || undefined,
      notes: details.notes || undefined,
      internal_notes: details.internal_notes || undefined,
      currency: details.currency || undefined,
      items: dtoItems,
    };

    const action = this.wizardService.createAction();

    const create$ = this.dispatchNotesService.create(dto);

    if (action === 'draft') {
      // draft: solo crear
      create$.subscribe({
        next: (note) => this._onCreateSuccess(note, 'draft'),
        error: (err) => this._onCreateError(err),
      });
    } else if (action === 'confirm') {
      // confirm: crear -> confirmar
      create$
        .pipe(
          switchMap((note) =>
            this.dispatchNotesService
              .confirm(note.id)
              .pipe(
                switchMap((confirmed) =>
                  of({ note: confirmed, partial: 'confirm' as const }),
                ),
              ),
          ),
        )
        .subscribe({
          next: ({ note, partial }) => this._onCreateSuccess(note, partial),
          error: (err) => this._onCreateError(err, 'confirm'),
        });
    } else {
      // invoice: crear -> confirmar -> entregar -> facturar
      create$
        .pipe(
          switchMap((note) =>
            this.dispatchNotesService.confirm(note.id).pipe(
              switchMap((confirmed) =>
                this.dispatchNotesService.deliver(confirmed.id).pipe(
                  switchMap((delivered) =>
                    this.dispatchNotesService.invoice(delivered.id).pipe(
                      switchMap((invoiced) =>
                        of({
                          note: invoiced,
                          partial: 'invoice' as const,
                        }),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
        .subscribe({
          next: ({ note, partial }) => this._onCreateSuccess(note, partial),
          error: (err) => this._onCreateError(err, 'invoice'),
        });
    }
  }

  private _onCreateSuccess(
    note: DispatchNote,
    action: WizardCreateAction | 'confirm' | 'invoice',
  ): void {
    this.isSubmitting.set(false);
    this.isCreated.set(true);
    this.createdNote.set(note);
    this.created.emit(note);

    const messages: Record<string, string> = {
      draft: 'Remision creada exitosamente',
      confirm: 'Remision creada y confirmada',
      invoice: 'Remision facturada',
    };
    this.toast.success(messages[action] ?? 'Remision creada exitosamente');
  }

  private _onCreateError(err: unknown, reachedAction?: string): void {
    this.isSubmitting.set(false);
    const messages: Record<string, string> = {
      confirm: 'Remision creada, pero falló la confirmacion',
      invoice: 'Remision creada y confirmada, pero falló la entrega',
    };
    const msg = reachedAction
      ? messages[reachedAction]
      : (err as Error)?.message || 'Error al crear la remision';
    this.toast.error(msg);
  }

  toggleActionMenu(event: Event): void {
    event.stopPropagation();
    this.showActionMenu.update((v) => !v);
  }

  selectAction(action: WizardCreateAction): void {
    this.wizardService.setCreateAction(action);
    this.showActionMenu.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    const button = target.closest('[data-action-menu]');
    if (!button) {
      this.showActionMenu.set(false);
    }
  }

  onClose(): void {
    this.showActionMenu.set(false);
    this.wizardService.reset();
    this.isCreated.set(false);
    this.createdNote.set(null);
    this.isOpenChange.emit(false);
  }

  onCreateAnother(): void {
    this.showActionMenu.set(false);
    this.wizardService.reset();
    this.isCreated.set(false);
    this.createdNote.set(null);
  }

  onViewDetail(id: number): void {
    this.onClose();
    // Navigation will be handled by the parent component
  }

  onPrint(note: DispatchNote): void {
    this.printService.printDispatchNote(note);
  }
}
