import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../shared/components';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';
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
    CommonModule,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nueva Remision"
      size="xl-mid"
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
            @case (0) { Selecciona el cliente para la remision }
            @case (1) { Agrega los productos a despachar }
            @case (2) { Configura fechas, ubicacion y notas }
            @case (3) { Revisa y confirma la remision }
          }
        </p>
      </div>

      <!-- Step Content -->
      <div class="p-4 max-h-[65vh] overflow-y-auto">
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
            <app-button variant="outline" (clicked)="wizardService.previousStep()">
              <app-icon name="arrow-left" [size]="16"></app-icon>
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
              <app-icon name="arrow-right" [size]="16"></app-icon>
            </app-button>
          } @else if (!isCreated()) {
            <app-button
              variant="primary"
              (clicked)="onCreate()"
              [disabled]="!wizardService.canProceed() || isSubmitting()"
              [loading]="isSubmitting()"
            >
              Crear Remision
            </app-button>
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

    this.dispatchNotesService.create(dto).subscribe({
      next: (note) => {
        this.isSubmitting.set(false);
        this.isCreated.set(true);
        this.createdNote.set(note);
        this.toast.success('Remision creada exitosamente');
        this.created.emit(note);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.toast.error(err?.message || 'Error al crear la remision');
      },
    });
  }

  onClose(): void {
    this.wizardService.reset();
    this.isCreated.set(false);
    this.createdNote.set(null);
    this.isOpenChange.emit(false);
  }

  onCreateAnother(): void {
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
