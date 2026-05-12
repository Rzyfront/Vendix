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
        type="button"
        class="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-[var(--color-background)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface)]"
        (click)="toggle($event)"
      >
        <ng-content select="[dropdown-trigger]"></ng-content>
      </button>

      @if (open()) {
        <div
          class="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-md bg-[var(--color-background)] shadow-lg ring-1 ring-[var(--color-border)] focus:outline-none"
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

  toggle(event?: MouseEvent) {
    event?.stopPropagation();
    this.open.set(!this.open());
    this.isOpenChange.emit(this.open());
  }

  close() {
    if (this.open()) {
      this.open.set(false);
      this.isOpenChange.emit(false);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    const root = this.rootRef()?.nativeElement;
    if (!root) return;
    if (!root.contains(e.target as Node)) {
      this.close();
    }
  }
}
