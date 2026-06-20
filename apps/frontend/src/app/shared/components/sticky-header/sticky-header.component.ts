import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';

export interface StickyHeaderActionButton {
  id: string;
  label: string;
  variant:
    | 'primary'
    | 'secondary'
    | 'outline'
    | 'outline-danger'
    | 'ghost'
    | 'danger';
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  visible?: boolean;
  /**
   * Optional native `title` attribute surfaced as a tooltip on hover. Useful to
   * explain why an action is disabled without taking up screen space.
   */
  title?: string;
}

export interface StickyHeaderTab {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: string;
  route?: string | unknown[];
  exact?: boolean;
  disabled?: boolean;
  visible?: boolean;
}

export type StickyHeaderVariant = 'default' | 'glass';
export type StickyHeaderBadgeColor =
  | 'green'
  | 'blue'
  | 'yellow'
  | 'gray'
  | 'red';

@Component({
  selector: 'app-sticky-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    IconComponent,
    ButtonComponent,
  ],
  templateUrl: './sticky-header.component.html',
  styleUrls: ['./sticky-header.component.scss'],
})
export class StickyHeaderComponent implements AfterViewInit {
  title = input.required<string>();
  subtitle = input<string>('');
  icon = input<string>('box');
  variant = input<StickyHeaderVariant>('glass');
  showBackButton = input<boolean>(false);
  backRoute = input<string | string[]>('/');
  metadataContent = input<string>('');
  badgePulse = input<boolean>(false);
  badgeText = input<string>('');
  badgeColor = input<StickyHeaderBadgeColor>('blue');
  actions = input<StickyHeaderActionButton[]>([]);
  tabs = input<StickyHeaderTab[]>([]);
  activeTab = input<string>('');
  tabsAriaLabel = input<string>('Secciones');

  actionClicked = output<string>();
  tabChanged = output<string>();

  readonly tabsScrollContainer = viewChild<ElementRef<HTMLElement>>(
    'tabsScrollContainer',
  );
  readonly showLeftArrow = signal(false);
  readonly showRightArrow = signal(false);

  private readonly destroyRef = inject(DestroyRef);
  private resizeObserver: ResizeObserver | null = null;
  private observedTabsElement: HTMLElement | null = null;

  readonly visibleTabs = computed(() =>
    this.tabs().filter((tab) => tab.visible !== false),
  );

  constructor() {
    effect(() => {
      const activeTab = this.activeTab();
      const visibleTabs = this.visibleTabs();

      queueMicrotask(() => {
        this.setupTabsObserver();
        if (!visibleTabs.length) {
          this.checkTabsOverflow();
          return;
        }

        this.scrollActiveTabIntoView(activeTab);
        this.checkTabsOverflow();
      });
    });

    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  ngAfterViewInit(): void {
    this.setupTabsObserver();
    this.checkTabsOverflow();
    queueMicrotask(() => this.scrollActiveTabIntoView(this.activeTab()));
  }

  onActionClick(id: string): void {
    this.actionClicked.emit(id);
  }

  onTabClick(tab: StickyHeaderTab, event?: Event): void {
    if (tab.disabled) {
      event?.preventDefault();
      return;
    }

    this.tabChanged.emit(tab.id);

    if (event?.currentTarget instanceof HTMLElement) {
      event.currentTarget.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }

  onTabsScroll(): void {
    this.checkTabsOverflow();
  }

  scrollTabs(direction: 'left' | 'right'): void {
    const el = this.tabsScrollContainer()?.nativeElement;
    if (!el) return;

    const chunk = Math.max(el.clientWidth * 0.72, 120);
    el.scrollBy({
      left: direction === 'left' ? -chunk : chunk,
      behavior: 'smooth',
    });
  }

  isTabActive(tab: StickyHeaderTab, routeActive = false): boolean {
    const activeTab = this.activeTab();
    return activeTab ? activeTab === tab.id : routeActive;
  }

  getBadgeClasses(): string {
    const colors: Record<StickyHeaderBadgeColor, string> = {
      green: 'bg-green-100 text-green-700',
      blue: 'bg-blue-100 text-blue-700',
      yellow: 'bg-yellow-100 text-yellow-700',
      gray: 'bg-gray-100 text-gray-700',
      red: 'bg-red-100 text-red-700',
    };
    return colors[this.badgeColor()] || colors.blue;
  }

  getBadgeDotClasses(): string {
    const colors: Record<StickyHeaderBadgeColor, string> = {
      green: 'bg-green-500',
      blue: 'bg-blue-500',
      yellow: 'bg-yellow-500',
      gray: 'bg-gray-500',
      red: 'bg-red-500',
    };
    return colors[this.badgeColor()] || colors.blue;
  }

  private setupTabsObserver(): void {
    const el = this.tabsScrollContainer()?.nativeElement ?? null;
    if (this.observedTabsElement === el) return;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.observedTabsElement = el;

    if (!el) {
      this.showLeftArrow.set(false);
      this.showRightArrow.set(false);
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.checkTabsOverflow());
      this.resizeObserver.observe(el);
    }
  }

  private checkTabsOverflow(): void {
    const el = this.tabsScrollContainer()?.nativeElement;
    if (!el) {
      this.showLeftArrow.set(false);
      this.showRightArrow.set(false);
      return;
    }

    const tolerance = 1;
    this.showLeftArrow.set(el.scrollLeft > tolerance);
    this.showRightArrow.set(
      el.scrollLeft + el.clientWidth < el.scrollWidth - tolerance,
    );
  }

  private scrollActiveTabIntoView(activeTab: string): void {
    const container = this.tabsScrollContainer()?.nativeElement;
    if (!container) return;

    const tabEl = activeTab
      ? this.findTabElement(container, activeTab)
      : container.querySelector<HTMLElement>('[aria-selected="true"]');

    if (!tabEl) return;

    // ISSUE-09: honor the user's reduced-motion preference (WCAG 2.1
    // and vendix-ui-ux rule). Auto behavior snaps instantly to the
    // new position; smooth gives the polished feel on capable devices.
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    tabEl.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      // ISSUE-09: center (not nearest) so the active tab parks in the
      // middle of the strip instead of hugging the right edge.
      inline: 'center',
    });
  }

  private findTabElement(
    container: HTMLElement,
    tabId: string,
  ): HTMLElement | undefined {
    return Array.from(
      container.querySelectorAll<HTMLElement>('[data-tab-id]'),
    ).find((el) => el.dataset['tabId'] === tabId);
  }

  /**
   * ISSUE-09: WAI-ARIA roving-tabindex keyboard nav for the tablist.
   * Tab/Shift+Tab enter / leave the tablist as a whole (the active
   * tab is the only one with tabindex=0). ArrowLeft / ArrowRight
   * move between visible, non-disabled tabs. Home / End jump to the
   * first / last. The parent's `(tabChanged)` handler is fired so the
   * existing constructor effect re-centers the strip via
   * `scrollActiveTabIntoView`.
   */
  onTabsKeydown(event: KeyboardEvent): void {
    const container = this.tabsScrollContainer()?.nativeElement;
    if (!container) return;

    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).filter(
      (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true',
    );
    if (!tabs.length) return;

    const currentIndex = tabs.findIndex(
      (el) => el.getAttribute('aria-selected') === 'true',
    );
    const safeIndex = currentIndex < 0 ? 0 : currentIndex;

    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (safeIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (safeIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return; // not a key we handle
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    const nextId = next.dataset['tabId'] ?? '';
    if (nextId) {
      this.tabChanged.emit(nextId);
    }
    // focus after the change is applied so screen readers pick up
    // the new aria-selected=true on the focused element.
    queueMicrotask(() => next.focus());
  }
}
