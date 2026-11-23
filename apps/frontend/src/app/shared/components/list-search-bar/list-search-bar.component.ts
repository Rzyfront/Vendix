import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { InputsearchComponent } from '../inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../options-dropdown/options-dropdown.component';
import type {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../options-dropdown/options-dropdown.interfaces';

/**
 * Where the bar sticks on mobile, below whatever is already sticky above it:
 * - `stats`: standard list page with sticky stats (99px).
 * - `header`: under an `app-sticky-header` without tabs (52px).
 * - `header-tabs`: under an `app-sticky-header` with tabs (token in styles.scss).
 */
export type ListSearchBarOffset = 'stats' | 'header' | 'header-tabs';

/** Literal classes so Tailwind keeps them in the build. */
const OFFSET_CLASSES: Record<ListSearchBarOffset, string> = {
  stats: 'top-[99px]',
  header: 'top-[52px]',
  'header-tabs': 'top-header-tabs-search',
};

/**
 * Model mobile search bar of the admin lists (title + search + options),
 * sticky on mobile with a soft shadow on its controls; plain row from `md` up.
 * See README.md.
 */
@Component({
  selector: 'app-list-search-bar',
  standalone: true,
  imports: [InputsearchComponent, OptionsDropdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The host itself is the sticky element: a sticky child of an inline host
  // would have no room to stick.
  host: { '[class]': 'containerClasses()' },
  template: `
      <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
        @if (title()) {
          <h2
            class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary"
          >
            {{ title() }}
          </h2>
        }

        <div class="flex items-center gap-2 w-full md:w-auto">
          <app-inputsearch
            class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
            size="sm"
            [placeholder]="placeholder()"
            [debounceTime]="debounceTime()"
            (searchChange)="searchChange.emit($event)"
          ></app-inputsearch>

          @if (showOptions()) {
            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filters()"
              [filterValues]="filterValues()"
              [actions]="actions()"
              [singleActionAsMenu]="singleActionAsMenu()"
              [isLoading]="isLoading()"
              (filterChange)="filterChange.emit($event)"
              (clearAllFilters)="clearAllFilters.emit()"
              (actionClick)="actionClick.emit($event)"
            ></app-options-dropdown>
          }
        </div>
      </div>
  `,
})
export class ListSearchBarComponent {
  /** Optional title, e.g. "Todos los Clientes (95)". Empty hides it. */
  readonly title = input('');
  readonly placeholder = input('Buscar...');
  readonly debounceTime = input(300);
  readonly offset = input<ListSearchBarOffset>('stats');
  /**
   * `true` (default) keeps the desktop row styles (padding + bottom border,
   * for use inside a card). `false` for a bar that only renders on mobile.
   */
  readonly desktopRow = input(true);

  readonly filters = input<FilterConfig[]>([]);
  readonly filterValues = input<FilterValues>({});
  readonly actions = input<DropdownAction[]>([]);
  readonly singleActionAsMenu = input(false);
  readonly isLoading = input(false);
  /** Hides the options dropdown when the list has no filters nor actions. */
  readonly showOptions = input(true);

  readonly searchChange = output<string>();
  readonly filterChange = output<FilterValues>();
  readonly clearAllFilters = output<void>();
  readonly actionClick = output<string>();

  protected readonly containerClasses = computed(() =>
    [
      'block sticky z-10 bg-background px-2 py-1.5 -mt-[5px]',
      OFFSET_CLASSES[this.offset()],
      this.desktopRow()
        ? 'md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border'
        : '',
    ].join(' '),
  );
}
