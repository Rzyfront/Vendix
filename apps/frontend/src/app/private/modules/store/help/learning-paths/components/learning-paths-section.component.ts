import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { LearningPathsService } from '../services/learning-paths.service';
import { LearningPathSummary } from '../models/learning-path.model';
import { LearningPathDetailComponent } from './learning-path-detail.component';

@Component({
  selector: 'app-learning-paths-section',
  standalone: true,
  imports: [IconComponent, LearningPathDetailComponent],
  template: `
    @if (paths().length > 0) {
      <section class="lps" aria-labelledby="lps-title">
        @if (selectedId(); as id) {
          <app-learning-path-detail
            [pathId]="id"
            (closed)="selectedId.set(null)"
            (progressChanged)="load()"
          ></app-learning-path-detail>
        } @else {
          <h3 id="lps-title" class="lps-title">Rutas de aprendizaje</h3>
          <ul class="lps-grid">
            @for (p of paths(); track p.id) {
              <li>
                <button type="button" class="lps-card" (click)="selectedId.set(p.id)">
                  <span class="lps-icon"><app-icon name="list-ordered" [size]="20"></app-icon></span>
                  <span class="lps-body">
                    <span class="lps-name">{{ p.title }}</span>
                    @if (p.summary) {
                      <span class="lps-summary">{{ p.summary }}</span>
                    }
                    <span class="lps-meta">
                      {{ p.completed_count }} de {{ p.video_count }} videos completados
                    </span>
                    <span
                      class="lps-bar"
                      role="progressbar"
                      aria-label="Progreso de la ruta"
                      aria-valuemin="0"
                      [attr.aria-valuemax]="p.video_count"
                      [attr.aria-valuenow]="p.completed_count"
                    >
                      <span
                        class="lps-bar-fill"
                        [style.width.%]="p.video_count ? (p.completed_count / p.video_count) * 100 : 0"
                      ></span>
                    </span>
                  </span>
                </button>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: [`
    .lps { margin-bottom: 1.5rem; }
    .lps-title { margin: 0 0 .75rem; font-size: 1.125rem; font-weight: 700; color: var(--color-text-primary); }
    .lps-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: .75rem; grid-template-columns: 1fr; }
    @media (min-width: 640px) { .lps-grid { grid-template-columns: repeat(2, 1fr); } }
    .lps-card { display: flex; gap: .75rem; width: 100%; text-align: left; cursor: pointer;
      padding: .875rem; border-radius: var(--radius-lg); border: 1px solid var(--color-border);
      background: var(--color-surface); transition: border-color .15s; min-height: 3rem; }
    .lps-card:hover, .lps-card:focus-visible { border-color: var(--color-primary); }
    .lps-icon { flex: none; width: 2.5rem; height: 2.5rem; border-radius: var(--radius-md);
      display: grid; place-items: center; background: var(--color-background); color: var(--color-primary); }
    .lps-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .25rem; }
    .lps-name { font-size: .9375rem; font-weight: 600; color: var(--color-text-primary); }
    .lps-summary { font-size: .8125rem; color: var(--color-text-secondary); }
    .lps-meta { font-size: .75rem; color: var(--color-text-secondary); }
    .lps-bar { display: block; height: .375rem; border-radius: 9999px; background: var(--color-background); overflow: hidden; }
    .lps-bar-fill { display: block; height: 100%; background: var(--color-primary); }
  `],
})
export class LearningPathsSectionComponent {
  private service = inject(LearningPathsService);
  private destroyRef = inject(DestroyRef);

  readonly paths = signal<LearningPathSummary[]>([]);
  readonly selectedId = signal<number | null>(null);

  constructor() {
    this.load();
  }

  load(): void {
    this.service
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.paths.set(list ?? []),
        // The section is optional: hide it when the list cannot be loaded.
        error: () => this.paths.set([]),
      });
  }
}
