import { Injectable, signal, computed } from '@angular/core';
import { toLocalDateString } from '../../../../../shared/utils/date.util';

// ============================================================================
// INTERFACES
// ============================================================================

export interface WizardCustomer {
  id: number;
  first_name: string;
  last_name: string;
  phone?: string;
  email?: string;
  document_number?: string;
}

export interface WizardItem {
  product_id: number;
  product_name: string;
  product_sku?: string;
  product_image_url?: string;
  product_variant_id?: number;
  variant_name?: string;
  location_id?: number;
  location_name?: string;
  ordered_quantity: number;
  dispatched_quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  lot_serial?: string;
  stock_available?: number;
}

export interface WizardDetails {
  emission_date: string;
  agreed_delivery_date?: string;
  dispatch_location_id?: number;
  dispatch_location_name?: string;
  notes?: string;
  internal_notes?: string;
  currency: string;
}

export interface WizardTotals {
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
}

export type WizardCreateAction = 'draft' | 'confirm' | 'invoice';

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class DispatchNoteWizardService {
  static readonly STEP_LABELS = ['Cliente', 'Productos', 'Detalles', 'Revision'];
  static readonly TOTAL_STEPS = 4;

  // --- State signals ---
  readonly currentStep = signal<number>(0);
  readonly customer = signal<WizardCustomer | null>(null);
  readonly items = signal<WizardItem[]>([]);
  readonly details = signal<WizardDetails>({
    emission_date: toLocalDateString(),
    currency: 'COP',
  });
  readonly createAction = signal<WizardCreateAction>('draft');

  // --- Computed: totals ---
  readonly totals = computed<WizardTotals>(() => {
    const currentItems = this.items();
    let subtotal = 0;
    let discount = 0;
    let tax = 0;

    for (const item of currentItems) {
      const lineSubtotal = item.unit_price * item.dispatched_quantity;
      subtotal += lineSubtotal;
      discount += item.discount_amount * item.dispatched_quantity;
      tax += item.tax_amount * item.dispatched_quantity;
    }

    const grandTotal = subtotal - discount + tax;

    return { subtotal, discount, tax, grandTotal };
  });

  // --- Computed: step validation ---
  readonly canProceed = computed<boolean>(() => {
    const step = this.currentStep();

    switch (step) {
      case 0:
        return this.customer() !== null;
      case 1:
        return this.items().length > 0 && this.items().every(i => i.dispatched_quantity > 0);
      case 2:
        return !!this.details().emission_date;
      case 3:
        return true;
      default:
        return false;
    }
  });

  // --- Steps navigation ---
  readonly stepsConfig = computed(() =>
    DispatchNoteWizardService.STEP_LABELS.map((label, i) => ({
      label,
      completed: i < this.currentStep(),
    })),
  );

  // --- Navigation methods ---
  nextStep(): void {
    const current = this.currentStep();
    if (current < DispatchNoteWizardService.TOTAL_STEPS - 1 && this.canProceed()) {
      this.currentStep.set(current + 1);
    }
  }

  previousStep(): void {
    const current = this.currentStep();
    if (current > 0) {
      this.currentStep.set(current - 1);
    }
  }

  goToStep(step: number): void {
    if (step >= 0 && step < DispatchNoteWizardService.TOTAL_STEPS) {
      this.currentStep.set(step);
    }
  }

  // --- Customer methods ---
  setCustomer(customer: WizardCustomer): void {
    this.customer.set(customer);
  }

  clearCustomer(): void {
    this.customer.set(null);
  }

  // --- Items methods ---
  addItem(item: WizardItem): void {
    const current = this.items();
    const existingIndex = current.findIndex(
      i => i.product_id === item.product_id && i.product_variant_id === item.product_variant_id,
    );

    if (existingIndex >= 0) {
      // Increment quantity if already exists
      const updated = [...current];
      updated[existingIndex] = {
        ...updated[existingIndex],
        ordered_quantity: updated[existingIndex].ordered_quantity + item.ordered_quantity,
        dispatched_quantity: updated[existingIndex].dispatched_quantity + item.dispatched_quantity,
      };
      this.items.set(updated);
    } else {
      this.items.set([...current, item]);
    }
  }

  removeItem(productId: number, variantId?: number): void {
    this.items.set(
      this.items().filter(
        i => !(i.product_id === productId && i.product_variant_id === variantId),
      ),
    );
  }

  updateItem(productId: number, variantId: number | undefined, changes: Partial<WizardItem>): void {
    const updated = this.items().map(item => {
      if (item.product_id === productId && item.product_variant_id === variantId) {
        return { ...item, ...changes };
      }
      return item;
    });
    this.items.set(updated);
  }

  // --- Details methods ---
  setDetails(details: Partial<WizardDetails>): void {
    this.details.set({ ...this.details(), ...details });
  }

  setCreateAction(action: WizardCreateAction): void {
    this.createAction.set(action);
  }

  // --- Reset ---
  reset(): void {
    this.currentStep.set(0);
    this.customer.set(null);
    this.items.set([]);
    this.createAction.set('draft');
    this.details.set({
      emission_date: toLocalDateString(),
      currency: 'COP',
    });
  }
}
