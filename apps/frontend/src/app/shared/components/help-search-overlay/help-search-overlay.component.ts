import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Router } from '@angular/router';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { IconComponent } from '../icon/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { HelpCenterService } from '../../../private/modules/store/help/services/help-center.service';
import { HelpArticle } from '../../../private/modules/store/help/models/help-article.model';

@Component({
  selector: 'app-help-search-overlay',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, IconComponent, SpinnerComponent],
  template: `
    <!-- Trigger Button -->
    <button
      class="search-trigger"
      (click)="open($event)"
      aria-label="Buscar en Centro de Ayuda"
      >
      <app-icon name="search" [size]="18"></app-icon>
    </button>
    
    <!-- Overlay -->
    <dialog
      #dialogRef
      class="overlay"
      (click)="onBackdropClick($event)"
      (cancel)="close()"
      >
      <div class="spotlight" (click)="$event.stopPropagation()">
        <!-- Search Input -->
        <div class="spotlight-input-wrap">
          <app-icon name="search" [size]="20" class="spotlight-search-icon"></app-icon>
          <input
            #searchInput
            type="text"
            class="spotlight-input"
            placeholder="Buscar artículos de ayuda..."
            [formControl]="searchControl"
            (input)="onQueryChange(searchControl.value)"
            autocomplete="off"
            />
          @if (!searchControl.value) {
            <kbd class="spotlight-kbd">ESC</kbd>
          }
          @if (searchControl.value) {
            <button
              class="spotlight-clear"
              (click)="clearQuery()"
              >
              <app-icon name="x" [size]="16"></app-icon>
            </button>
          }
        </div>

        <!-- Results -->
        @if (searchControl.value.length >= 2) {
          <div class="spotlight-results">
            <!-- Loading -->
            @if (isSearching()) {
              <div class="spotlight-loading">
                <app-spinner size="sm"></app-spinner>
                <span>Buscando...</span>
              </div>
            }
            <!-- Results List -->
            @for (article of results(); track article; let i = $index) {
              <div
                class="spotlight-result"
                [class.active]="i === activeIndex()"
                (click)="selectResult(article)"
                (mouseenter)="activeIndex.set(i)"
                >
                <div class="result-content">
                  <span class="result-title">{{ article.title }}</span>
                  <span class="result-summary">{{ article.summary }}</span>
                </div>
                <span class="result-category">{{ article.category.name }}</span>
              </div>
            }
            <!-- Empty -->
            @if (!isSearching() && results().length === 0 && hasSearched()) {
              <div class="spotlight-empty">
                <app-icon name="search" [size]="24" class="empty-icon"></app-icon>
                <span>No se encontraron artículos</span>
              </div>
            }
          </div>
        }

        <!-- Hint -->
        @if (searchControl.value.length < 2) {
          <div class="spotlight-hint">
            <app-icon name="help-circle" [size]="16"></app-icon>
            <span>Escribe al menos 2 caracteres para buscar</span>
          </div>
        }
      </div>
    </dialog>
    `,
  styles: [`
    .search-trigger {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--color-text-secondary, #6b7280);
      transition: all 0.15s;
    }

    .search-trigger:hover {
      background: rgba(0, 0, 0, 0.05);
    }

    /* Overlay (native <dialog> renders in top-layer, escaping all stacking contexts) */
    .overlay {
      border: none;
      padding: 0;
      margin: 0;
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      max-width: 100vw;
      max-height: 100vh;
      align-items: flex-start;
      justify-content: center;
      padding-top: 15vh;
      background: transparent;
    }

    .overlay[open] {
      display: flex;
    }

    .overlay::backdrop {
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
    }

    /* Spotlight Container */
    .spotlight {
      width: 90%;
      max-width: 580px;
      background: var(--color-surface, #fff);
      border-radius: 16px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.2);
      overflow: hidden;
    }

    /* Input */
    .spotlight-input-wrap {
      display: flex;
      align-items: center;
      padding: 0.875rem 1rem;
      border-bottom: 1px solid var(--color-border, #e5e7eb);
      gap: 0.75rem;
    }

    .spotlight-search-icon {
      flex-shrink: 0;
      color: var(--color-text-tertiary, #9ca3af);
    }

    .spotlight-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 1.0625rem;
      background: transparent;
      color: var(--color-text, #111827);
    }

    .spotlight-input::placeholder {
      color: var(--color-text-tertiary, #9ca3af);
    }

    .spotlight-kbd {
      font-size: 11px;
      font-family: inherit;
      padding: 2px 6px;
      border: 1px solid var(--color-border, #d1d5db);
      border-radius: 4px;
      color: var(--color-text-tertiary, #9ca3af);
      background: var(--color-background, #f9fafb);

      @media (max-width: 768px) {
        display: none;
      }
    }

    .spotlight-clear {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: var(--color-text-tertiary, #9ca3af);
      border-radius: 4px;
    }

    .spotlight-clear:hover {
      color: var(--color-text, #111827);
    }

    /* Results */
    .spotlight-results {
      max-height: 360px;
      overflow-y: auto;
    }

    .spotlight-result {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      cursor: pointer;
      transition: background 0.1s;
    }

    .spotlight-result:hover,
    .spotlight-result.active {
      background: var(--color-background, #f3f4f6);
    }

    .result-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .result-title {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text, #111827);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-summary {
      font-size: 0.75rem;
      color: var(--color-text-secondary, #6b7280);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-category {
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 12px;
      background: rgba(59, 130, 246, 0.1);
      color: #3b82f6;
      white-space: nowrap;
    }

    /* Loading & Empty */
    .spotlight-loading,
    .spotlight-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 2rem 1rem;
      color: var(--color-text-secondary, #6b7280);
      font-size: 0.875rem;
    }

    .empty-icon {
      opacity: 0.4;
    }

    /* Hint */
    .spotlight-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 1.25rem 1rem;
      color: var(--color-text-tertiary, #9ca3af);
      font-size: 0.8125rem;
    }
  `] })
export class HelpSearchOverlayComponent {
  private helpCenterService = inject(HelpCenterService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private searchSubject$ = new Subject<string>(); // LEGÍTIMO — debounceTime+distinctUntilChanged search stream

  readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialogRef');

  readonly isOpen = signal(false);
  readonly searchControl = new FormControl<string>('', { nonNullable: true });
  readonly results = signal<HelpArticle[]>([]);
  readonly isSearching = signal(false);
  readonly hasSearched = signal(false);
  readonly activeIndex = signal(0);

  constructor() {
    this.searchSubject$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(q => {
        if (q.trim().length >= 2) {
          this.search(q);
        } else {
          this.results.set([]);
          this.hasSearched.set(false);
        }
      });

  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isOpen()) {
      this.close();
      event.preventDefault();
    }

    if (!this.isOpen()) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.set(Math.min(this.activeIndex() + 1, this.results().length - 1));
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
    }

    const current = this.results()[this.activeIndex()];
    if (event.key === 'Enter' && current) {
      event.preventDefault();
      this.selectResult(current);
    }
  }

  open(event: Event): void {
    event.stopPropagation();
    this.dialogRef().nativeElement.showModal();
    this.isOpen.set(true);
    setTimeout(() => {
      const input = this.dialogRef().nativeElement.querySelector('.spotlight-input') as HTMLInputElement;
      input?.focus();
    }, 50);
  }

  close(): void {
    const dialogRef = this.dialogRef();
    if (dialogRef.nativeElement.open) {
      dialogRef.nativeElement.close();
    }
    this.isOpen.set(false);
    this.searchControl.setValue('');
    this.results.set([]);
    this.hasSearched.set(false);
    this.activeIndex.set(0);
  }

  onBackdropClick(event: Event): void {
    if (event.target === this.dialogRef().nativeElement) {
      this.close();
    }
  }

  onQueryChange(value: string): void {
    this.searchSubject$.next(value);
  }

  clearQuery(): void {
    this.searchControl.setValue('');
    this.results.set([]);
    this.hasSearched.set(false);
  }

  selectResult(article: HelpArticle): void {
    this.close();
    this.router.navigate(['/admin/help/center', article.slug]);
  }

  private search(q: string): void {
    this.isSearching.set(true);
    this.helpCenterService.searchArticles(q, 8)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (results) => {
          this.results.set(results);
          this.isSearching.set(false);
          this.hasSearched.set(true);
          this.activeIndex.set(0);
        },
        error: () => {
          this.isSearching.set(false);
          this.hasSearched.set(true);
        } });
  }

}
