import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PopCartItem {
    product: any; // Type to be refined
    quantity: number;
    unit_cost: number;
    discount: number;
    tax_rate: number;
    subtotal: number;
    tax_amount: number;
    total: number;
    batch_info?: {
        batch_number: string;
        expiry_date?: string;
    };
}

export interface PopCartSummary {
    subtotal: number;
    taxAmount: number;
    discountAmount: number;
    total: number;
    itemCount: number;
}

export interface PopCartState {
    items: PopCartItem[];
    summary: PopCartSummary;
    supplierId: number | null;
    locationId: number | null;
}

const INITIAL_STATE: PopCartState = {
    items: [],
    summary: {
        subtotal: 0,
        taxAmount: 0,
        discountAmount: 0,
        total: 0,
        itemCount: 0,
    },
    supplierId: null,
    locationId: null,
};

@Injectable({
    providedIn: 'root',
})
export class PopCartService {
    private _cartState = new BehaviorSubject<PopCartState>(INITIAL_STATE);
    public cartState$ = this._cartState.asObservable();

    constructor() { }

    get currentState(): PopCartState {
        return this._cartState.getValue();
    }

    setSupplier(supplierId: number | null) {
        // If supplier changes and we have items, we might need to warn user or clear cart
        // For now, just update state
        this.updateState({ supplierId });
    }

    setLocation(locationId: number | null) {
        this.updateState({ locationId });
    }

    addItem(product: any, quantity: number = 1) {
        const currentItems = [...this.currentState.items];
        const existingItemIndex = currentItems.findIndex(
            (item) => item.product.id === product.id
        );

        if (existingItemIndex > -1) {
            const existingItem = currentItems[existingItemIndex];
            const newQuantity = existingItem.quantity + quantity;
            this.updateItemQuantity(existingItemIndex, newQuantity);
        } else {
            const newItem: PopCartItem = {
                product,
                quantity,
                unit_cost: product.cost || 0, // Fallback to 0 if no cost
                discount: 0,
                tax_rate: 0, // Default tax rate
                subtotal: 0,
                tax_amount: 0,
                total: 0,
            };
            // Calculate totals for new item
            this.recalculateItemTotals(newItem);
            currentItems.push(newItem);
            this.updateState({ items: currentItems });
        }
    }

    removeItem(index: number) {
        const currentItems = [...this.currentState.items];
        currentItems.splice(index, 1);
        this.updateState({ items: currentItems });
    }

    updateItemQuantity(index: number, quantity: number) {
        const currentItems = [...this.currentState.items];
        if (currentItems[index]) {
            currentItems[index].quantity = quantity;
            this.recalculateItemTotals(currentItems[index]);
            this.updateState({ items: currentItems });
        }
    }

    updateItemCost(index: number, cost: number) {
        const currentItems = [...this.currentState.items];
        if (currentItems[index]) {
            currentItems[index].unit_cost = cost;
            this.recalculateItemTotals(currentItems[index]);
            this.updateState({ items: currentItems });
        }
    }

    updateItemBatchInfo(index: number, batchInfo: { batch_number: string; expiry_date?: string }) {
        const currentItems = [...this.currentState.items];
        if (currentItems[index]) {
            currentItems[index].batch_info = batchInfo;
            this.updateState({ items: currentItems });
        }
    }

    clearCart() {
        this.updateState({
            items: [],
            summary: INITIAL_STATE.summary,
        });
    }

    private recalculateItemTotals(item: PopCartItem) {
        const baseTotal = item.quantity * item.unit_cost;
        const discountAmount = (baseTotal * item.discount) / 100;
        const taxableAmount = baseTotal - discountAmount;
        const taxAmount = (taxableAmount * item.tax_rate) / 100;

        item.subtotal = baseTotal;
        item.tax_amount = taxAmount;
        item.total = taxableAmount + taxAmount;
    }

    private calculateSummary(items: PopCartItem[]): PopCartSummary {
        return items.reduce(
            (acc, item) => {
                acc.subtotal += item.subtotal;
                acc.taxAmount += item.tax_amount;
                acc.discountAmount += (item.subtotal * item.discount) / 100;
                acc.total += item.total;
                acc.itemCount += item.quantity;
                return acc;
            },
            {
                subtotal: 0,
                taxAmount: 0,
                discountAmount: 0,
                total: 0,
                itemCount: 0,
            }
        );
    }

    private updateState(partialState: Partial<PopCartState>) {
        const currentState = this.currentState;
        const newState = { ...currentState, ...partialState };

        // Always recalculate summary if items changed
        if (partialState.items) {
            newState.summary = this.calculateSummary(newState.items);
        }

        this._cartState.next(newState);
    }
}
