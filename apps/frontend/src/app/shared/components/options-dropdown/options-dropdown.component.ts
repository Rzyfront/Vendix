import {
  Component,
  ChangeDetectionStrategy,
  OnChanges,
  OnDestroy,
  HostListener,
  ElementRef,
  SimpleChanges,
  ChangeDetectorRef,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionsDropdownComponent implements OnChanges, OnDestroy {
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

  private cdr = inject(ChangeDetectorRef);

  isActionsOpen: boolean = false;
  isFiltersOpen: boolean = false;
  activeFiltersCount: number = 0;

  /** Position for mobile dropdown */
  dropdownTop: number | null = null;
  dropdownRight: number | null = null;

  /** Check if we're on mobile/tablet */
  get isMobileOrTablet(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 1024;
  }

  /** Local state for filter values */
  localFilterValues: FilterValues = {};

  /** Debounce subject for filter changes */
  private filterChange$ = new Subject<void>();
  private filterSubscription: Subscription;

  constructor() {
    this.filterSubscription = this.filterChange$
      .pipe(debounceTime(this.debounceMs()))
      .subscribe(() => this.emitFilterChange());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['filterValues']) {
      this.localFilterValues = { ...this.filterValues() };
    }

    if (changes['debounceMs'] && !changes['debounceMs'].firstChange) {
      // Re-subscribe with new debounce time
      this.filterSubscription?.unsubscribe();
      this.filterSubscription = this.filterChange$
        .pipe(debounceTime(this.debounceMs()))
        .subscribe(() => this.emitFilterChange());
    }

    this.calculateActiveFiltersCount();
  }

  ngOnDestroy(): void {
    this.filterSubscription?.unsubscribe();
  }

  private calculateActiveFiltersCount(): void {
    let count = 0;
    for (const filter of this.filters()) {
      const value = this.localFilterValues[filter.key];
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
    this.activeFiltersCount = count;
  }

  toggleActionsDropdown(): void {
    this.isActionsOpen = !this.isActionsOpen;
    this.isFiltersOpen = false;
  }

  toggleFiltersDropdown(): void {
    this.isFiltersOpen = !this.isFiltersOpen;
    this.isActionsOpen = false;
  }

  closeAllDropdowns(): void {
    this.isActionsOpen = false;
    this.isFiltersOpen = false;
  }

  private calculateDropdownPosition(): void {
    // Position is now handled purely by CSS (position: absolute with top: calc(100% + 4px))
    // This method is kept for potential future use or scroll handling
    this.cdr.markForCheck();
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
    if (this.isActionsOpen || this.isFiltersOpen) {
      this.calculateDropdownPosition();
    }
  }

  onFilterChange(key: string, value: string | number | null): void {
    this.localFilterValues[key] = value?.toString() || null;
    this.calculateActiveFiltersCount();
    this.filterChange$.next();
  }

  onMultiFilterChange(key: string, values: (string | number)[]): void {
    this.localFilterValues[key] = values.map((v) => v.toString());
    this.calculateActiveFiltersCount();
    this.filterChange$.next();
  }

  private emitFilterChange(): void {
    this.filterChange.emit({ ...this.localFilterValues });
  }

  onClearAllFilters(): void {
    // Emit clearAllFilters so the parent can reset to its own defaults
    // (e.g. thisMonth date range, default granularity).
    // We intentionally do NOT emit filterChange here to avoid dispatching
    // null/empty values before the parent sets the correct defaults.
    // TODO: The 'emit' function requires a mandatory void argument
    this.clearAllFilters.emit();
  }

  onClearFilter(key: string): void {
    const filter = this.filters().find((f) => f.key === key);
    if (filter) {
      if (filter.type === 'multi-select') {
        this.localFilterValues[key] = [];
      } else {
        this.localFilterValues[key] = null;
      }
      this.calculateActiveFiltersCount();
      // Emit immediately for explicit clear action
      this.emitFilterChange();
    }
  }

  hasActiveFilter(key: string): boolean {
    const value = this.localFilterValues[key];
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
    const value = this.localFilterValues[key];
    if (typeof value === 'string') {
      return value;
    }
    return '';
  }

  /**
   * Get the current values for a multi-select filter
   */
  getMultiFilterValues(key: string): string[] {
    const value = this.localFilterValues[key];
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  }
}
