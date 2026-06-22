import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'app-dropdown',
  standalone: true,
  imports: [],
  template: `
    <div class="relative inline-block text-left" #root>
      <button
        #trigger
        type="button"
        class="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-[var(--color-background)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface)]"
        (click)="toggle($event)"
      >
        <ng-content select="[dropdown-trigger]"></ng-content>
      </button>

      @if (open()) {
        <!--
          Panel anchored with position: fixed against the trigger rect so it
          escapes any ancestor with overflow:hidden (e.g. .table-container).
          Coordinates are recomputed on open and on window scroll/resize.
        -->
        <div
          #panel
          class="fixed z-[10000] w-56 origin-top-right rounded-md bg-[var(--color-background)] shadow-lg ring-1 ring-[var(--color-border)] focus:outline-none"
          role="menu"
          [style.top.px]="panelTop()"
          [style.left.px]="panelLeft()"
          [style.visibility]="positioned() ? 'visible' : 'hidden'"
        >
          <div class="py-1" role="none">
            <ng-content select="[dropdown-item]"></ng-content>
          </div>
        </div>
      }
    </div>
  `,
})
export class DropdownComponent {
  open = signal(false);
  readonly isOpenChange = output<boolean>();

  readonly rootRef = viewChild.required<ElementRef<HTMLElement>>('root');
  readonly triggerRef = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  private readonly destroyRef = inject(DestroyRef);

  /** Fixed-position coordinates (viewport space) computed from the trigger rect. */
  readonly panelTop = signal(0);
  readonly panelLeft = signal(0);
  /** Hidden until measured so the panel never flashes at (0,0). */
  readonly positioned = signal(false);

  /** Panel width matches the `w-56` Tailwind class (14rem = 224px). */
  private readonly panelWidth = 224;
  /** Estimated panel height to decide up/down flip before it is rendered. */
  private readonly panelEstimatedHeight = 240;
  /** Gap between trigger and panel, mirroring the previous `mt-2`. */
  private readonly gap = 8;

  /** Bound reference so the same listener can be added and removed. */
  private readonly reposition = (): void => this.updatePosition();

  constructor() {
    // Manage scroll/resize listeners reactively based on open state, and
    // re-measure when the panel element appears in the DOM. Depending on
    // panelRef() (the viewChild signal) makes this effect re-run once the
    // @if renders the panel, so the height-based up/down flip uses the real
    // measured height instead of the estimate.
    effect((onCleanup) => {
      if (!this.open()) return;
      // Read panelRef so the effect re-runs when the panel mounts.
      this.panelRef();
      this.updatePosition();
      window.addEventListener('scroll', this.reposition, true);
      window.addEventListener('resize', this.reposition);
      onCleanup(() => {
        window.removeEventListener('scroll', this.reposition, true);
        window.removeEventListener('resize', this.reposition);
      });
    });

    // Safety net: ensure listeners are gone if the component is destroyed
    // while open (effect cleanup already covers normal close paths).
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', this.reposition, true);
      window.removeEventListener('resize', this.reposition);
    });
  }

  toggle(event?: MouseEvent) {
    event?.stopPropagation();
    const next = !this.open();
    if (next) {
      // Reset measurement state; the open effect (re-)positions the panel
      // once the @if renders it, keeping it hidden until measured.
      this.positioned.set(false);
    }
    this.open.set(next);
    this.isOpenChange.emit(next);
  }

  close() {
    if (this.open()) {
      this.open.set(false);
      this.positioned.set(false);
      this.isOpenChange.emit(false);
    }
  }

  /**
   * Anchors the fixed panel to the trigger using getBoundingClientRect().
   * Right-aligns the panel to the trigger (matching the previous `right-0`)
   * and flips above the trigger when there is not enough space below,
   * mirroring the drop-up logic in `selector.component.ts`.
   */
  private updatePosition(): void {
    const trigger = this.triggerRef()?.nativeElement;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;

    const panelEl = this.panelRef()?.nativeElement;
    const measuredHeight = panelEl?.offsetHeight || this.panelEstimatedHeight;

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward =
      spaceBelow < measuredHeight + this.gap && spaceAbove > spaceBelow;

    // Right-align panel to the trigger's right edge.
    let left = rect.right - this.panelWidth;
    // Clamp inside the viewport with an 8px margin.
    left = Math.max(8, Math.min(left, viewportWidth - this.panelWidth - 8));

    const top = openUpward
      ? rect.top - measuredHeight - this.gap
      : rect.bottom + this.gap;

    this.panelLeft.set(left);
    this.panelTop.set(top);
    this.positioned.set(true);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!this.open()) return;
    const root = this.rootRef()?.nativeElement;
    const panel = this.panelRef()?.nativeElement;
    const target = e.target as Node;
    // The panel is now portaled in viewport space but still a DOM child of
    // root; check both so clicks inside the panel don't close it.
    if (root?.contains(target) || panel?.contains(target)) return;
    this.close();
  }
}
