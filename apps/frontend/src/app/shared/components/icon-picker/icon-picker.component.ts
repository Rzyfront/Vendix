import {
  Component,
  ChangeDetectionStrategy,
  Input,
  signal,
  computed,
  HostListener,
  ElementRef,
  inject,
  input,
  output
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { ICON_REGISTRY, IconName } from '../icon/icons.registry';

@Component({
  selector: 'app-icon-picker',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative inline-block">
      <!-- Trigger button -->
      <button
        type="button"
        class="flex items-center gap-1.5 px-2 py-1 border rounded-md text-xs transition-colors"
        [style.border-color]="isOpen() ? 'var(--color-primary)' : 'var(--color-border)'"
        [style.background]="'var(--color-surface)'"
        [style.color]="value ? 'var(--color-text)' : 'var(--color-text-muted)'"
        (click)="toggle()"
      >
        @if (value) {
          <app-icon [name]="value" [size]="size() === 'sm' ? 14 : 16"></app-icon>
          <span>{{ value }}</span>
        } @else {
          <app-icon name="image" [size]="size() === 'sm' ? 14 : 16" color="var(--color-text-muted)"></app-icon>
          <span>{{ placeholder() }}</span>
        }
        <app-icon name="chevron-down" [size]="12" color="var(--color-text-muted)"></app-icon>
      </button>

      <!-- Dropdown -->
      @if (isOpen()) {
        <div
          class="absolute z-50 mt-1 rounded-lg shadow-lg overflow-hidden"
          [class.right-0]="alignRight()"
          [class.left-0]="!alignRight()"
          style="background: var(--color-surface); border: 1px solid var(--color-border); width: 280px"
        >
          <!-- Search -->
          <div class="p-2" style="border-bottom: 1px solid var(--color-border)">
            <input
              type="text"
              class="w-full px-2.5 py-1.5 border rounded-md text-xs"
              style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text)"
              placeholder="Buscar icono..."
              [ngModel]="searchQuery()"
              (ngModelChange)="searchQuery.set($event)"
              #searchInput
            />
          </div>

          <!-- Icon grid -->
          <div class="p-2 max-h-48 overflow-y-auto">
            @if (filteredIcons().length) {
              <div class="grid grid-cols-6 gap-1">
                @for (icon of filteredIcons(); track icon) {
                  <button
                    type="button"
                    class="flex flex-col items-center justify-center p-1.5 rounded-md transition-colors"
                    [style.background]="value === icon ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : 'transparent'"
                    [style.color]="value === icon ? 'var(--color-primary)' : 'var(--color-text)'"
                    (click)="selectIcon(icon)"
                    [title]="icon"
                  >
                    <app-icon [name]="icon" [size]="18"></app-icon>
                  </button>
                }
              </div>
            } @else {
              <p class="text-xs text-center py-3" style="color: var(--color-text-muted)">
                Sin resultados
              </p>
            }
          </div>

          <!-- Clear button -->
          @if (value) {
            <div class="p-2" style="border-top: 1px solid var(--color-border)">
              <button
                type="button"
                class="w-full px-2 py-1 text-xs rounded-md transition-colors"
                style="color: var(--color-text-muted)"
                (click)="clearIcon()"
              >
                Quitar icono
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class IconPickerComponent {
  private el = inject(ElementRef);

  @Input() value = '';
  readonly placeholder = input('Icono');
  readonly size = input<'sm' | 'md'>('sm');
  readonly alignRight = input(false);
  readonly valueChange = output<string>();

  isOpen = signal(false);
  searchQuery = signal('');

  private allIcons = Object.keys(ICON_REGISTRY).filter(k => k !== 'default').sort();

  filteredIcons = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.allIcons;
    return this.allIcons.filter(name => name.includes(q));
  });

  toggle() {
    this.isOpen.update(v => !v);
    if (this.isOpen()) {
      this.searchQuery.set('');
    }
  }

  selectIcon(icon: string) {
    this.value = icon;
    this.valueChange.emit(icon);
    this.isOpen.set(false);
  }

  clearIcon() {
    this.value = '';
    this.valueChange.emit('');
    this.isOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.el.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
    }
  }
}
