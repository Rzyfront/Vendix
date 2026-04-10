import { Component, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'vendix-report-search',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="search-container">
      <app-icon name="search" [size]="18" class="search-icon" />
      <input
        type="text"
        [ngModel]="searchTerm()"
        (ngModelChange)="onSearch($event)"
        placeholder="Buscar reporte..."
        class="search-input"
      />
      @if (searchTerm()) {
        <button class="clear-btn" (click)="clear()">
          <app-icon name="x" [size]="16" />
        </button>
      }
    </div>
  `,
  styles: [`
    .search-container {
      position: relative;
      display: flex;
      align-items: center;
      max-width: 480px;
      width: 100%;
    }

    .search-icon {
      position: absolute;
      left: 0.875rem;
      color: var(--color-text-tertiary);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      padding: 0.625rem 2.5rem 0.625rem 2.75rem;
      font-size: var(--fs-sm);
      color: var(--color-text-primary);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 0.75rem;
      outline: none;
      transition: all 0.2s ease;

      &::placeholder {
        color: var(--color-text-tertiary);
      }

      &:focus {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
      }
    }

    .clear-btn {
      position: absolute;
      right: 0.625rem;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.25rem;
      border: none;
      background: none;
      color: var(--color-text-tertiary);
      cursor: pointer;
      border-radius: 0.375rem;

      &:hover {
        color: var(--color-text-primary);
        background: var(--color-surface-hover);
      }
    }
  `],
})
export class ReportSearchComponent {
  searchChange = output<string>();
  searchTerm = signal('');

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.searchChange.emit(term);
  }

  clear(): void {
    this.searchTerm.set('');
    this.searchChange.emit('');
  }
}
