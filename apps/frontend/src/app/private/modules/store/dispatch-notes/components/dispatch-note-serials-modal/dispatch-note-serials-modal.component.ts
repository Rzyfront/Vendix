import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../../shared/components/multi-selector/multi-selector.component';
import { SerialNumbersService } from '../../../serial-numbers/services/serial-numbers.service';
import { ConfirmDispatchNoteItemSerialsDto } from '../../interfaces/dispatch-note.interface';

/**
 * QUI-431 — Input describing a single serialized dispatch-note line that needs
 * serials chosen before the note can be confirmed.
 */
export interface DispatchNoteSerialLine {
  /** `dispatch_note_items.id` — keys the serials onto the backend payload. */
  dispatch_note_item_id: number;
  product_id: number;
  product_variant_id?: number;
  location_id?: number;
  /** Units that must be covered by serials (= dispatched_quantity). */
  dispatched_quantity: number;
  product_name: string;
}

/**
 * Internal per-line UI state. The pool options, the picked serial ids, and the
 * free-text are signals so the zoneless template re-renders on change.
 */
interface SerialLineState {
  line: DispatchNoteSerialLine;
  loading: ReturnType<typeof signal<boolean>>;
  options: ReturnType<typeof signal<MultiSelectorOption[]>>;
  selectedSerialIds: ReturnType<typeof signal<(string | number)[]>>;
  freeText: ReturnType<typeof signal<string>>;
}

/**
 * QUI-431 — Dispatch-note serial-selection modal.
 *
 * Opened at confirm time for any dispatch note that has serialized lines
 * (`product.requires_serial_numbers === true`). For every serialized line the
 * operator picks serials from the in_stock pool (multi-select, searchable)
 * and/or types free-text serials (one per line / comma separated) for units
 * not yet in the pool. Free-text serials are resolved-or-created by the backend
 * on confirm, preserving pool↔stock parity.
 *
 * Each line must be covered by exactly `dispatched_quantity` serials; the
 * "Confirmar" action is disabled until every line is satisfied. On confirm the
 * component emits the assembled `item_serials[]` and closes.
 *
 * Fully zoneless/signal-based and standalone.
 */
@Component({
  selector: 'app-dispatch-note-serials-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    MultiSelectorComponent,
  ],
  templateUrl: './dispatch-note-serials-modal.component.html',
})
export class DispatchNoteSerialsModalComponent {
  private readonly serialNumbersService = inject(SerialNumbersService);
  private readonly destroyRef = inject(DestroyRef);

  /** Two-way bound visibility from the parent. */
  readonly isOpen = model<boolean>(false);
  /** Serialized lines that need serials assigned before confirm. */
  readonly items = input<DispatchNoteSerialLine[]>([]);

  /** Emitted with the assembled `item_serials[]` when the operator confirms. */
  readonly confirmed = output<ConfirmDispatchNoteItemSerialsDto[]>();
  /** Emitted when the operator cancels (no serials chosen). */
  readonly cancelled = output<void>();

  /** Per-line UI state, rebuilt whenever the input lines change. */
  readonly lineStates = signal<SerialLineState[]>([]);

  /** Bumped after any per-line signal mutation to trigger derived recomputes. */
  private readonly revision = signal(0);

  /** True when every line is covered by exactly its dispatched quantity. */
  readonly canConfirm = computed(() => {
    this.revision();
    const states = this.lineStates();
    if (states.length === 0) return false;
    return states.every((s) => this.isLineComplete(s));
  });

  /** How many lines are fully satisfied (for the footer counter). */
  readonly completedLines = computed(() => {
    this.revision();
    return this.lineStates().filter((s) => this.isLineComplete(s)).length;
  });

  constructor() {
    // Rebuild per-line state and (re)load pools whenever the lines change.
    effect(() => {
      const lines = this.items();
      const states: SerialLineState[] = lines.map((line) => ({
        line,
        loading: signal<boolean>(false),
        options: signal<MultiSelectorOption[]>([]),
        selectedSerialIds: signal<(string | number)[]>([]),
        freeText: signal<string>(''),
      }));
      this.lineStates.set(states);
      this.revision.update((v) => v + 1);
      this.loadPools(states);
    });
  }

  /** Parse a free-text blob into trimmed, de-duped serial strings. */
  private parseFreeText(raw: string): string[] {
    if (!raw || !raw.trim()) return [];
    const parts = raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return Array.from(new Set(parts));
  }

  /** Total serials chosen for a line (pool selection + free text). */
  lineTotal(state: SerialLineState): number {
    return (
      state.selectedSerialIds().length +
      this.parseFreeText(state.freeText()).length
    );
  }

  /** A line is complete when its total exactly matches the dispatched qty. */
  isLineComplete(state: SerialLineState): boolean {
    return this.lineTotal(state) === state.line.dispatched_quantity;
  }

  onSelectionChange(state: SerialLineState, values: (string | number)[]): void {
    state.selectedSerialIds.set(values);
    this.revision.update((v) => v + 1);
  }

  onFreeTextChange(state: SerialLineState, event: Event): void {
    state.freeText.set((event.target as HTMLTextAreaElement).value);
    this.revision.update((v) => v + 1);
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;
    const payload: ConfirmDispatchNoteItemSerialsDto[] = this.lineStates().map(
      (state) => {
        const serial_ids = state
          .selectedSerialIds()
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n));
        const serial_numbers = this.parseFreeText(state.freeText());
        const item: ConfirmDispatchNoteItemSerialsDto = {
          dispatch_note_item_id: state.line.dispatch_note_item_id,
        };
        if (serial_ids.length) item.serial_ids = serial_ids;
        if (serial_numbers.length) item.serial_numbers = serial_numbers;
        return item;
      },
    );
    this.confirmed.emit(payload);
    this.isOpen.set(false);
  }

  onCancel(): void {
    this.cancelled.emit();
    this.isOpen.set(false);
  }

  /** Load the in_stock pool for each serialized line (parallel). */
  private loadPools(states: SerialLineState[]): void {
    states.forEach((state) => {
      const { product_id, location_id, product_variant_id } = state.line;
      if (!product_id || location_id == null) {
        return;
      }
      state.loading.set(true);
      this.serialNumbersService
        .listAvailable({
          product_id,
          location_id,
          product_variant_id: product_variant_id ?? undefined,
        })
        .pipe(
          catchError(() => of([])),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((serials) => {
          state.options.set(
            serials.map((s) => ({
              value: s.id,
              label: s.serial_number,
              description: s.inventory_locations?.name,
            })),
          );
          state.loading.set(false);
          this.revision.update((v) => v + 1);
        });
    });
  }
}
