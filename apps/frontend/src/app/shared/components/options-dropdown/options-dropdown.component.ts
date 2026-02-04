import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnChanges,
  OnDestroy,
  HostListener,
  ElementRef,
  ViewChild,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { IconComponent } from '../icon/icon.component';
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
    CommonModule,
    FormsModule,
    IconComponent,
    SelectorComponent,
    MultiSelectorComponent,
  ],
  templateUrl: './options-dropdown.component.html',
  styleUrls: ['./options-dropdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionsDropdownComponent implements OnChanges, OnDestroy {
  /** Configuration for each filter in the dropdown */
  @Input() filters: FilterConfig[] = [];

  /** Actions to display in the dropdown */
  @Input() actions: DropdownAction[] = [];

  /** Current filter values */
  @Input() filterValues: FilterValues = {};

  /** Title shown in the dropdown header */
  @Input() title: string = 'Opciones';

  /** Label for the trigger button */
  @Input() triggerLabel: string = 'Opciones';

  /** Debounce time in milliseconds for filter changes */
  @Input() debounceMs: number = 350;

  /** Whether the component is in a loading state */
  @Input() isLoading: boolean = false;

  /** Emits when filter values change (after debounce) */
  @Output() filterChange = new EventEmitter<FilterValues>();

  /** Emits when an action is clicked */
  @Output() actionClick = new EventEmitter<string>();

  /** Emits when "clear all" is clicked */
  @Output() clearAllFilters = new EventEmitter<void>();

  @ViewChild('dropdownContainer') dropdownContainer!: ElementRef<HTMLElement>;

  isOpen: boolean = false;
  activeFiltersCount: number = 0;

  /** Local state for filter values */
  localFilterValues: FilterValues = {};

  /** Debounce subject for filter changes */
  private filterChange$ = new Subject<void>();
  private filterSubscription: Subscription;

  constructor() {
    this.filterSubscription = this.filterChange$
      .pipe(debounceTime(this.debounceMs))
      .subscribe(() => this.emitFilterChange());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['filterValues']) {
      this.localFilterValues = { ...this.filterValues };
    }

    if (changes['debounceMs'] && !changes['debounceMs'].firstChange) {
      // Re-subscribe with new debounce time
      this.filterSubscription?.unsubscribe();
      this.filterSubscription = this.filterChange$
        .pipe(debounceTime(this.debounceMs))
        .subscribe(() => this.emitFilterChange());
    }

    this.calculateActiveFiltersCount();
  }

  ngOnDestroy(): void {
    this.filterSubscription?.unsubscribe();
  }

  private calculateActiveFiltersCount(): void {
    let count = 0;
    for (const filter of this.filters) {
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

  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
  }

  closeDropdown(): void {
    this.isOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (
      this.dropdownContainer &&
      !this.dropdownContainer.nativeElement.contains(event.target as Node)
    ) {
      this.closeDropdown();
    }
  }

  @HostListener('keydown.escape')
  onEscapeKey(): void {
    this.closeDropdown();
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
    // Reset all filter values
    for (const filter of this.filters) {
      if (filter.type === 'multi-select') {
        this.localFilterValues[filter.key] = [];
      } else {
        this.localFilterValues[filter.key] = null;
      }
    }
    this.calculateActiveFiltersCount();
    // Emit immediately without debounce for explicit clear action
    this.emitFilterChange();
    this.clearAllFilters.emit();
  }

  onClearFilter(key: string): void {
    const filter = this.filters.find((f) => f.key === key);
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
    this.closeDropdown();
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
