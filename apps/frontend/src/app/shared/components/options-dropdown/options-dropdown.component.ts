import {
  Component,
  DestroyRef,
  HostListener,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import { debounceTime, switchMap } from 'rxjs/operators';

import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons.registry';
import { SelectorComponent } from '../selector/selector.component';
import { MultiSelectorComponent } from '../multi-selector/multi-selector.component';

import {
  FilterConfig,
  DropdownAction,
  FilterValues,
} from './options-dropdown.interfaces';

@Component({
  selector: 'app-options-dropdown',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SelectorComponent,
    MultiSelectorComponent
],
  templateUrl: './options-dropdown.component.html',
  styleUrls: ['./options-dropdown.component.scss'],
})
export class OptionsDropdownComponent {
  /** Configuration for each filter in the dropdown */
  readonly filters = input<FilterConfig[]>([]);

  /** Actions to display in the dropdown */
  readonly actions = input<DropdownAction[]>([]);

  /** Whether to show the actions trigger button */
  readonly showActions = input<boolean>(true);

  /** Current filter values */
  readonly filterValues = input<FilterValues>({});

  /** Title shown in the dropdown header */
  readonly title = input<string>('Opciones');

  /** Label for the trigger button */
  readonly triggerLabel = input<string>('Opciones');

  /** Icon for the trigger button */
  readonly triggerIcon = input<IconName>('sliders-horizontal');

  /** Debounce time in milliseconds for filter changes */
  readonly debounceMs = input<number>(350);

  /** Whether the component is in a loading state */
  readonly isLoading = input<boolean>(false);

  /** Emits when filter values change (after debounce) */
  readonly filterChange = output<FilterValues>();

  /** Emits when an action is clicked */
  readonly actionClick = output<string>();

  /** Emits when "clear all" is clicked */
  readonly clearAllFilters = output<void>();

  readonly dropdownContainer = viewChild.required<ElementRef<HTMLElement>>('dropdownContainer');
  readonly actionsTriggerButton = viewChild.required<ElementRef<HTMLButtonElement>>('actionsTriggerButton');
  readonly filtersTriggerButton = viewChild.required<ElementRef<HTMLButtonElement>>('filtersTriggerButton');

  private readonly destroyRef = inject(DestroyRef);

  readonly isActionsOpen = signal(false);
  readonly isFiltersOpen = signal(false);
  readonly activeFiltersCount = signal(0);

  /** Position for mobile dropdown */
  readonly dropdownTop = signal<number | null>(null);
  readonly dropdownRight = signal<number | null>(null);

  /** Check if we're on mobile/tablet */
  get isMobileOrTablet(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 1024;
  }

  /** Local state for filter values */
  readonly localFilterValues = signal<FilterValues>({});

  /** Emits debounce trigger — value is the debounce time to apply */
  private readonly debounceTrigger$ = new Subject<number>();

  constructor() {
    // Sync filterValues input → local state
    effect(() => {
      this.localFilterValues.set({ ...this.filterValues() });
      this.calculateActiveFiltersCount();
    });

    // Single pipeline: switchMap re-creates debounce when a new ms value arrives
    this.debounceTrigger$
      .pipe(
        switchMap((ms) => of(null).pipe(debounceTime(ms))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.emitFilterChange());
  }

  private calculateActiveFiltersCount(): void {
    let count = 0;
    const values = this.localFilterValues();
    for (const filter of this.filters()) {
      const value = values[filter.key];
      if (filter.type === 'multi-select') {
        if (Array.isArray(value) && value.length > 0) {
          count++;
        }
      } else {
        if (value && value !== '') {
          count++;
        }
      }
    }
    this.activeFiltersCount.set(count);
  }

  toggleActionsDropdown(): void {
    this.isActionsOpen.update((v) => !v);
    this.isFiltersOpen.set(false);
  }

  toggleFiltersDropdown(): void {
    this.isFiltersOpen.update((v) => !v);
    this.isActionsOpen.set(false);
  }

  closeAllDropdowns(): void {
    this.isActionsOpen.set(false);
    this.isFiltersOpen.set(false);
  }

  closeDropdown(): void {
    this.closeAllDropdowns();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const dropdownContainer = this.dropdownContainer();
    if (
      dropdownContainer &&
      !dropdownContainer.nativeElement.contains(event.target as Node)
    ) {
      this.closeAllDropdowns();
    }
  }

  @HostListener('keydown.escape')
  onEscapeKey(): void {
    this.closeDropdown();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    // Position is handled purely by CSS — no action needed
  }

  onFilterChange(key: string, value: string | number | null): void {
    this.localFilterValues.update((prev) => ({ ...prev, [key]: value?.toString() || null }));
    this.calculateActiveFiltersCount();
    this.debounceTrigger$.next(this.debounceMs());
  }

  onMultiFilterChange(key: string, values: (string | number)[]): void {
    this.localFilterValues.update((prev) => ({ ...prev, [key]: values.map((v) => v.toString()) }));
    this.calculateActiveFiltersCount();
    this.debounceTrigger$.next(this.debounceMs());
  }

  private emitFilterChange(): void {
    this.filterChange.emit({ ...this.localFilterValues() });
  }

  onClearAllFilters(): void {
    // Emit clearAllFilters so the parent can reset to its own defaults
    // (e.g. thisMonth date range, default granularity).
    // We intentionally do NOT emit filterChange here to avoid dispatching
    // null/empty values before the parent sets the correct defaults.
    this.clearAllFilters.emit();
  }

  onClearFilter(key: string): void {
    const filter = this.filters().find((f) => f.key === key);
    if (filter) {
      if (filter.type === 'multi-select') {
        this.localFilterValues.update((prev) => ({ ...prev, [key]: [] }));
      } else {
        this.localFilterValues.update((prev) => ({ ...prev, [key]: null }));
      }
      this.calculateActiveFiltersCount();
      // Emit immediately for explicit clear action
      this.emitFilterChange();
    }
  }

  hasActiveFilter(key: string): boolean {
    const value = this.localFilterValues()[key];
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return !!value && value !== '';
  }

  onActionClick(action: string): void {
    this.actionClick.emit(action);
    this.closeAllDropdowns();
  }

  get hasActions(): boolean {
    return this.showActions() && this.actions().length > 0;
  }

  get hasFilters(): boolean {
    return this.filters().length > 0;
  }

  /**
   * Get the current value for a single-select filter
   */
  getFilterValue(key: string): string {
    const value = this.localFilterValues()[key];
    if (typeof value === 'string') {
      return value;
    }
    return '';
  }

  /**
   * Get the current values for a multi-select filter
   */
  getMultiFilterValues(key: string): string[] {
    const value = this.localFilterValues()[key];
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  }
}
