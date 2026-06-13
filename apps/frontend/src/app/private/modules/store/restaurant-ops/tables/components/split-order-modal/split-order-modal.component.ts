import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
  ToggleComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/index';
import {
  SplitByItemsDto,
  SplitByAmountDto,
  SplitMode,
  TableSessionOrderItem,
} from '../../interfaces';

type TabId = 'items' | 'amount';

interface ItemGroupSelection {
  /** Mutable list of item ids chosen for sub-order i. */
  ids: number[];
}

/**
 * Modal that lets the user split an open check either by items
 * (one group per sub-order) or by amount (N equal / custom parts).
 *
 * Two tabs:
 *  - "Por items": N is fixed by the count of group boxes the user adds.
 *    Each item can be assigned to exactly one group.
 *  - "Por monto": N is a number input. Equal mode = auto-distribute;
 *    custom mode = user enters amounts that must sum to the order total.
 */
@Component({
  selector: 'app-split-order-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    ToggleComponent,
    CurrencyPipe,
  ],
  templateUrl: './split-order-modal.component.html',
  styleUrl: './split-order-modal.component.scss',
})
export class SplitOrderModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly loadingInput = input(false, { alias: 'loading' });
  readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());
  readonly orderId = input<number | null>(null);
  readonly items = input<TableSessionOrderItem[]>([]);
  readonly orderTotal = input<number>(0);

  readonly isOpenChange = output<boolean>();
  readonly splitByItems = output<SplitByItemsDto>();
  readonly splitByAmount = output<SplitByAmountDto>();

  readonly activeTab = signal<TabId>('items');
  readonly itemGroups = signal<ItemGroupSelection[]>([{ ids: [] }, { ids: [] }]);
  readonly splitMode = signal<SplitMode>('equal');
  readonly nSplits = signal<number>(2);
  readonly customAmounts = signal<number[]>([0, 0]);
  readonly itemsAssigned = computed(() => {
    const assigned = new Set<number>();
    for (const g of this.itemGroups()) {
      for (const id of g.ids) assigned.add(id);
    }
    return assigned;
  });

  readonly allItemsAssigned = computed(
    () => this.itemsAssigned().size === this.items().length,
  );

  readonly customSum = computed(() =>
    this.customAmounts().reduce((a, v) => a + (Number(v) || 0), 0),
  );

  readonly customSumMatches = computed(() => {
    const total = this.orderTotal();
    if (!total) return false;
    return Math.abs(this.customSum() - total) < 0.01;
  });

  readonly form: FormGroup<{
    n_splits: FormControl<number>;
  }>;
  readonly amountsFormArray: FormArray = this.fb.array([
    this.fb.control(0, { nonNullable: true }),
    this.fb.control(0, { nonNullable: true }),
  ]);

  constructor() {
    this.form = this.fb.group({
      n_splits: this.fb.control(2, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(2)],
      }),
    });
    this.amountsFormArray.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.customAmounts.set((v as number[]) ?? []));
    this.form.controls.n_splits.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this.onNSplitsChange(v ?? 2));
  }

  amountControlAt(i: number): FormControl {
    return this.amountsFormArray.at(i) as FormControl;
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  setTab(tab: TabId): void {
    this.activeTab.set(tab);
  }

  addGroup(): void {
    this.itemGroups.update((g) => [...g, { ids: [] }]);
  }

  removeGroup(index: number): void {
    if (this.itemGroups().length <= 2) return;
    this.itemGroups.update((g) => g.filter((_, i) => i !== index));
  }

  toggleItemInGroup(itemId: number, groupIndex: number): void {
    this.itemGroups.update((groups) => {
      const next = groups.map((g, i) => ({ ...g, ids: [...g.ids] }));
      const group = next[groupIndex];
      const idx = group.ids.indexOf(itemId);
      if (idx >= 0) {
        group.ids.splice(idx, 1);
      } else {
        for (const g of next) {
          const j = g.ids.indexOf(itemId);
          if (j >= 0) g.ids.splice(j, 1);
        }
        group.ids.push(itemId);
      }
      return next;
    });
  }

  isItemInGroup(itemId: number, groupIndex: number): boolean {
    return this.itemGroups()[groupIndex]?.ids.includes(itemId) ?? false;
  }

  isItemAssigned(itemId: number): boolean {
    return this.itemsAssigned().has(itemId);
  }

  getGroupTotal(groupIndex: number): number {
    const ids = this.itemGroups()[groupIndex]?.ids ?? [];
    return this.items()
      .filter((it) => ids.includes(it.id))
      .reduce((acc, it) => acc + Number(it.total_price ?? 0), 0);
  }

  setMode(mode: SplitMode): void {
    this.splitMode.set(mode);
    this.rebuildAmountsArray();
  }

  onNSplitsChange(value: number | string): void {
    const n = Math.max(2, Math.floor(Number(value) || 2));
    this.nSplits.set(n);
    this.rebuildAmountsArray();
  }

  private rebuildAmountsArray(): void {
    const total = this.orderTotal();
    const n = this.nSplits();
    const next: number[] = [];
    if (this.splitMode() === 'equal') {
      const base = Math.floor((total / n) * 100) / 100;
      for (let i = 0; i < n; i += 1) next.push(base);
      // Last bucket absorbs rounding diff.
      const diff = this.round2(total) - this.round2(base * n);
      next[next.length - 1] = this.round2(next[next.length - 1] + diff);
    } else {
      const half = Math.round((total / n) * 100) / 100;
      for (let i = 0; i < n; i += 1) next.push(half);
    }
    // Reset the FormArray
    while (this.amountsFormArray.length) {
      this.amountsFormArray.removeAt(0);
    }
    for (const v of next) {
      this.amountsFormArray.push(this.fb.control(v, { nonNullable: true }));
    }
    this.customAmounts.set(next);
  }

  onSubmit(): void {
    if (this.activeTab() === 'items') {
      if (!this.allItemsAssigned()) {
        this.toastService.error(
          'Asigna todos los items a un grupo antes de continuar',
        );
        return;
      }
      const groups = this.itemGroups().filter((g) => g.ids.length > 0);
      if (groups.length < 2) {
        this.toastService.error('Necesitas al menos 2 grupos con items');
        return;
      }
      this.splitByItems.emit({
        item_groups: groups.map((g) => ({ order_item_ids: g.ids })),
      });
    } else {
      const n = this.nSplits();
      if (this.splitMode() === 'equal') {
        this.splitByAmount.emit({ mode: 'equal', n_splits: n });
      } else {
        if (!this.customSumMatches()) {
          this.toastService.error(
            `La suma de los montos (${this.customSum()}) no coincide con el total (${this.orderTotal()})`,
          );
          return;
        }
        this.splitByAmount.emit({
          mode: 'custom',
          n_splits: n,
          amounts: this.customAmounts(),
        });
      }
    }
  }

  trackById(_i: number, item: TableSessionOrderItem): number {
    return item.id;
  }

  trackByIndex(i: number): number {
    return i;
  }

  private round2(v: number): number {
    return Math.round(v * 100) / 100;
  }
}
