import { Injectable, signal, computed } from '@angular/core';
import { Order, OrderItem, Product } from '../../orders/interfaces/order.interface';
import {
  CreateDispatchFromOrderNewRouteDto,
  CreateDispatchFromOrderRouteAssignmentDto,
  DispatchNoteDirection,
  DispatchNoteSubtype,
  DispatchNoteReason,
  DISPATCH_SUBTYPE_BY_DIRECTION,
  DISPATCH_REASON_BY_SUBTYPE,
} from '../interfaces/dispatch-note.interface';

// ============================================================================
// INTERFACES — order-first wizard (ref 2026-06-25)
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
  order_item_id: number;
  product_id: number;
  product_name: string;
  product_sku?: string;
  product_image_url?: string;
  product_variant_id?: number;
  variant_name?: string;
  requires_serial_numbers: boolean;
  unit_price: number;
  ordered_quantity: number;
  pending_quantity: number;
  dispatched_quantity: number;
  tax_amount: number;
  discount_amount: number;
  location_id?: number;
}

export interface WizardDetails {
  agreed_delivery_date?: string;
  dispatch_location_id?: number;
  dispatch_location_name?: string;
  notes?: string;
  internal_notes?: string;
  currency: string;
}

export type WizardRouteMode = 'none' | 'existing' | 'new';
export type WizardTerminalAction = 'draft' | 'confirm_route' | 'deliver';

export interface WizardTotals {
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
}

// ============================================================================
// SERVICE
// ============================================================================

/**
 * Bidirectional remisión wizard service (ref plan Remisiones Bidireccionales).
 *
 * Outbound steps (6): Tipo → Orden → Items → Detalles → Ruta → Revisión.
 * Inbound steps  (5): Tipo → Orden → Items → Detalles → Revisión.
 *
 * `@Injectable()` (not providedIn:'root') so each modal mount gets a
 * fresh instance.
 */
@Injectable()
export class DispatchNoteWizardService {
  // --- Bidirectional state (step 0) ---
  readonly direction = signal<DispatchNoteDirection>('outbound');
  readonly subtype = signal<DispatchNoteSubtype>('customer_delivery');
  readonly reason = signal<DispatchNoteReason | null>(null);

  readonly currentStep = signal<number>(0);
  readonly selectedOrder = signal<Order | null>(null);
  readonly customer = signal<WizardCustomer | null>(null);
  readonly items = signal<WizardItem[]>([]);
  readonly details = signal<WizardDetails>({ currency: 'COP' });

  readonly routeMode = signal<WizardRouteMode>('none');
  readonly selectedRouteId = signal<number | null>(null);
  readonly newRouteDraft = signal<CreateDispatchFromOrderNewRouteDto | null>(null);

  readonly terminalAction = signal<WizardTerminalAction>('draft');

  // --- Step labels derived from direction ---
  readonly stepLabels = computed<string[]>(() => {
    if (this.direction() === 'inbound') {
      return ['Tipo', 'Orden', 'Items', 'Detalles', 'Revisión'];
    }
    return ['Tipo', 'Orden', 'Items', 'Detalles', 'Ruta', 'Revisión'];
  });

  readonly totalSteps = computed<number>(() => this.stepLabels().length);

  readonly lastStepIndex = computed<number>(() => this.totalSteps() - 1);

  readonly totals = computed<WizardTotals>(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    for (const item of this.items()) {
      subtotal += item.unit_price * item.dispatched_quantity;
      discount += item.discount_amount * item.dispatched_quantity;
      tax += item.tax_amount * item.dispatched_quantity;
    }
    return { subtotal, discount, tax, grandTotal: subtotal - discount + tax };
  });

  readonly canProceed = computed<boolean>(() => {
    const step = this.currentStep();
    switch (step) {
      case 0: {
        // Tipo — direction/subtype always have valid defaults; subtype
        // validity is enforced by setSubtype().
        return true;
      }
      case 1: {
        // Orden
        const order = this.selectedOrder();
        return !!order && (order.order_items?.length ?? 0) > 0;
      }
      case 2: {
        // Items
        const its = this.items();
        return its.length > 0 && its.every(
          (i) => i.dispatched_quantity > 0 && i.dispatched_quantity <= i.pending_quantity,
        );
      }
      case 3:
        // Detalles
        return !!this.details().dispatch_location_id;
      case 4: {
        // Ruta (outbound only) — inbound has Revisión at index 4
        if (this.direction() === 'inbound') return true;
        const mode = this.routeMode();
        if (mode === 'none') return true;
        if (mode === 'existing') return !!this.selectedRouteId();
        if (mode === 'new') {
          const draft = this.newRouteDraft();
          return !!draft && !!draft.driver_user_id && !!draft.planned_date;
        }
        return false;
      }
      case 5:
        // Revisión (outbound only)
        return true;
      default:
        return false;
    }
  });

  readonly stepsConfig = computed(() =>
    this.stepLabels().map((label, i) => ({
      label,
      completed: i < this.currentStep(),
    })),
  );

  readonly hasSerializedItems = computed<boolean>(() =>
    this.items().some((i) => i.requires_serial_numbers),
  );

  // --- Bidirectional setters (step 0) ---

  setDirection(d: DispatchNoteDirection): void {
    this.direction.set(d);
    // Reset subtype to the first valid one for the new direction, and
    // clear reason since it may not be valid for the new subtype.
    const validSubtypes = DISPATCH_SUBTYPE_BY_DIRECTION[d];
    if (!validSubtypes.includes(this.subtype())) {
      this.subtype.set(validSubtypes[0]);
    }
    this.reason.set(null);
  }

  setSubtype(s: DispatchNoteSubtype): void {
    // Validate that s is valid for the current direction.
    const valid = DISPATCH_SUBTYPE_BY_DIRECTION[this.direction()];
    if (!valid.includes(s)) return;
    this.subtype.set(s);
    // Clear reason if the new subtype has no reason catalog or the
    // current reason is not in the new subtype's catalog.
    const reasons = DISPATCH_REASON_BY_SUBTYPE[s];
    if (!reasons || (this.reason() && !reasons.includes(this.reason()!))) {
      this.reason.set(null);
    }
  }

  setReason(r: DispatchNoteReason | null): void {
    if (r === null) {
      this.reason.set(null);
      return;
    }
    // Validate that r is valid for the current subtype.
    const reasons = DISPATCH_REASON_BY_SUBTYPE[this.subtype()];
    if (!reasons || !reasons.includes(r)) return;
    this.reason.set(r);
  }

  // --- Free item picker (future inbound / standalone flows) ---

  addItem(item: WizardItem): void {
    this.items.update((current) => [...current, item]);
  }

  removeItem(index: number): void {
    this.items.update((current) => current.filter((_, i) => i !== index));
  }

  // --- Navigation ---
  nextStep(): void {
    const c = this.currentStep();
    if (c < this.lastStepIndex() && this.canProceed()) {
      this.currentStep.set(c + 1);
    }
  }
  previousStep(): void {
    const c = this.currentStep();
    if (c > 0) this.currentStep.set(c - 1);
  }
  goToStep(step: number): void {
    if (step >= 0 && step < this.totalSteps()) {
      this.currentStep.set(step);
    }
  }

  // --- Order selection (step 0) ---
  setSelectedOrder(
    order: Order,
    existingDispatchedByItem: Map<number, number> = new Map(),
  ): void {
    this.selectedOrder.set(order);

    const user = (order as any).users;
    if (user) {
      this.customer.set({
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        email: user.email,
        document_number: user.document_number,
      });
    } else if (order.customer_id) {
      this.customer.set({
        id: order.customer_id,
        first_name: '',
        last_name: `Cliente #${order.customer_id}`,
      });
    }

    const newItems: WizardItem[] = (order.order_items ?? []).map((oi: OrderItem) => {
      const product: Product | undefined = oi.products;
      const already = existingDispatchedByItem.get(oi.id) ?? 0;
      const pending = Math.max(0, oi.quantity - already);
      return {
        order_item_id: oi.id,
        product_id: oi.product_id,
        product_name: oi.product_name,
        product_sku: product?.sku,
        product_image_url: product?.image_url,
        product_variant_id: oi.product_variant_id,
        variant_name: oi.variant_attributes,
        requires_serial_numbers: !!product?.requires_serial_numbers,
        unit_price: oi.unit_price,
        ordered_quantity: oi.quantity,
        pending_quantity: pending,
        dispatched_quantity: 0,
        tax_amount: oi.tax_amount_item ?? 0,
        discount_amount: 0,
      };
    });
    this.items.set(newItems);

    this.details.update((d) => ({
      ...d,
      agreed_delivery_date: (order as any).agreed_delivery_date ?? d.agreed_delivery_date,
    }));

    this.routeMode.set('none');
    this.selectedRouteId.set(null);
    this.newRouteDraft.set(null);
  }

  clearSelectedOrder(): void {
    this.selectedOrder.set(null);
    this.customer.set(null);
    this.items.set([]);
  }

  updateItemQuantity(orderItemId: number, dispatchedQuantity: number): number {
    let clamped = dispatchedQuantity;
    this.items.update((current) =>
      current.map((item) => {
        if (item.order_item_id !== orderItemId) return item;
        const max = item.pending_quantity;
        clamped = Math.max(0, Math.min(max, dispatchedQuantity));
        return { ...item, dispatched_quantity: clamped };
      }),
    );
    return clamped;
  }

  setDetails(partial: Partial<WizardDetails>): void {
    this.details.update((d) => ({ ...d, ...partial }));
  }

  setRouteMode(mode: WizardRouteMode): void {
    this.routeMode.set(mode);
    if (mode === 'none') {
      this.selectedRouteId.set(null);
      this.newRouteDraft.set(null);
    } else if (mode === 'existing') {
      this.newRouteDraft.set(null);
    } else if (mode === 'new') {
      this.selectedRouteId.set(null);
    }
  }

  setSelectedRouteId(routeId: number | null): void {
    this.selectedRouteId.set(routeId);
  }

  setNewRouteDraft(draft: CreateDispatchFromOrderNewRouteDto | null): void {
    this.newRouteDraft.set(draft);
  }

  setTerminalAction(action: WizardTerminalAction): void {
    this.terminalAction.set(action);
  }

  buildRouteAssignment(): CreateDispatchFromOrderRouteAssignmentDto | undefined {
    const mode = this.routeMode();
    if (mode === 'none') return undefined;
    if (mode === 'existing') {
      const id = this.selectedRouteId();
      if (!id) return undefined;
      return { mode: 'existing', route_id: id };
    }
    const draft = this.newRouteDraft();
    if (!draft) return undefined;
    return { mode: 'new', new_route: draft };
  }

  reset(): void {
    this.currentStep.set(0);
    this.direction.set('outbound');
    this.subtype.set('customer_delivery');
    this.reason.set(null);
    this.selectedOrder.set(null);
    this.customer.set(null);
    this.items.set([]);
    this.details.set({ currency: 'COP' });
    this.routeMode.set('none');
    this.selectedRouteId.set(null);
    this.newRouteDraft.set(null);
    this.terminalAction.set('draft');
  }
}
