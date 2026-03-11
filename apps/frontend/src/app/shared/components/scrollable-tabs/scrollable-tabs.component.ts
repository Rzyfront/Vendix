import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface ScrollableTab {
  id: string;
  label: string;
  icon?: string;
}

export type ScrollableTabSize = 'xs' | 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-scrollable-tabs',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './scrollable-tabs.component.html',
  styleUrls: ['./scrollable-tabs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScrollableTabsComponent implements AfterViewInit, OnDestroy {
  readonly tabs = input.required<ScrollableTab[]>();
  readonly activeTab = input.required<string>();
  readonly size = input<ScrollableTabSize>('md');
  readonly ariaLabel = input<string>('Tabs');

  readonly tabChange = output<string>();

  readonly scroll_container = viewChild.required<ElementRef<HTMLElement>>('scroll_container');

  readonly show_left_arrow = signal(false);
  readonly show_right_arrow = signal(false);

  private resize_observer: ResizeObserver | null = null;

  readonly tab_icon_size = computed(() => {
    const map: Record<ScrollableTabSize, number> = { xs: 10, sm: 12, md: 12, lg: 14 };
    return map[this.size()];
  });

  readonly arrow_icon_size = computed(() => {
    const map: Record<ScrollableTabSize, number> = { xs: 12, sm: 14, md: 16, lg: 18 };
    return map[this.size()];
  });

  readonly wrapper_class = computed(() => `scrollable-tabs--${this.size()}`);

  constructor() {
    effect(() => {
      const active_id = this.activeTab();
      // Wait for DOM update before scrolling active tab into view
      queueMicrotask(() => this.scrollActiveTabIntoView(active_id));
    });
  }

  ngAfterViewInit(): void {
    const el = this.scroll_container().nativeElement;

    this.resize_observer = new ResizeObserver(() => this.checkOverflow());
    this.resize_observer.observe(el);

    this.checkOverflow();
  }

  ngOnDestroy(): void {
    this.resize_observer?.disconnect();
    this.resize_observer = null;
  }

  onScroll(): void {
    this.checkOverflow();
  }

  onTabClick(tab_id: string): void {
    this.tabChange.emit(tab_id);
  }

  scrollLeft(): void {
    const el = this.scroll_container().nativeElement;
    const chunk = el.clientWidth * 0.75;
    el.scrollBy({ left: -chunk, behavior: 'smooth' });
  }

  scrollRight(): void {
    const el = this.scroll_container().nativeElement;
    const chunk = el.clientWidth * 0.75;
    el.scrollBy({ left: chunk, behavior: 'smooth' });
  }

  private checkOverflow(): void {
    const el = this.scroll_container()?.nativeElement;
    if (!el) return;

    const tolerance = 1;
    this.show_left_arrow.set(el.scrollLeft > tolerance);
    this.show_right_arrow.set(el.scrollLeft + el.clientWidth < el.scrollWidth - tolerance);
  }

  private scrollActiveTabIntoView(tab_id: string): void {
    const container = this.scroll_container()?.nativeElement;
    if (!container) return;

    const tab_el = container.querySelector(`[data-tab-id="${tab_id}"]`) as HTMLElement;
    if (tab_el) {
      tab_el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }
}
