import {
  Component,
  ElementRef,
  HostListener,
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
        class="inline-flex w-full items-center justify-center gap-x-1.5 rounded-lg bg-[var(--color-background)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface)] active:scale-95 transition-all min-h-[36px]"
        (click)="toggle($event)"
      >
        <ng-content select="[dropdown-trigger]"></ng-content>
      </button>

      @if (open()) {
        <div
          #panel
          class="absolute right-0 top-full mt-1.5 z-[10000] w-56 origin-top-right rounded-md bg-[var(--color-background)] shadow-lg ring-1 ring-[var(--color-border)] focus:outline-none"
          role="menu"
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

  toggle(event?: MouseEvent) {
    event?.stopPropagation();
    const next = !this.open();
    this.open.set(next);
    this.isOpenChange.emit(next);
  }

  close() {
    if (this.open()) {
      this.open.set(false);
      this.isOpenChange.emit(false);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!this.open()) return;
    const root = this.rootRef()?.nativeElement;
    const target = e.target as Node;
    if (root?.contains(target)) return;
    this.close();
  }
}
