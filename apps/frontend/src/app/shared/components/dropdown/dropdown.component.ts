import { Component, ElementRef, EventEmitter, HostListener, Input, Output, TemplateRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-dropdown',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative inline-block text-left" #root>
      <button type="button" class="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-[var(--color-background)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] shadow-sm ring-1 ring-inset ring-[var(--color-border)] hover:bg-[var(--color-surface)]" (click)="toggle()">
        <ng-content select="[dropdown-trigger]"></ng-content>
      </button>

      <div *ngIf="open" class="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-md bg-[var(--color-background)] shadow-lg ring-1 ring-[var(--color-border)] focus:outline-none" role="menu">
        <div class="py-1" role="none">
          <ng-content select="[dropdown-item]"></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class DropdownComponent {
  @Input() open = false;
  @Output() openChange = new EventEmitter<boolean>();
  @ViewChild('root') rootRef!: ElementRef<HTMLElement>;

  toggle() {
    this.open = !this.open;
    this.openChange.emit(this.open);
  }

  close() {
    if (this.open) {
      this.open = false;
      this.openChange.emit(false);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    const root = this.rootRef?.nativeElement;
    if (!root) return;
    if (!root.contains(e.target as Node)) {
      this.close();
    }
  }
}
