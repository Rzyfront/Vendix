import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { VideoPlayerComponent } from '../../video-library/components/video-player/video-player.component';
import { LearningPathsService } from '../services/learning-paths.service';
import { LearningPathDetail, LearningPathItem } from '../models/learning-path.model';

@Component({
  selector: 'app-learning-path-detail',
  standalone: true,
  imports: [RouterModule, IconComponent, SpinnerComponent, VideoPlayerComponent],
  template: `
    <section class="lp-detail" aria-live="polite">
      <button type="button" class="lp-back" (click)="closed.emit()">
        <app-icon name="arrow-left" [size]="16"></app-icon>
        <span>Volver a las rutas</span>
      </button>

      @if (loading()) {
        <div class="lp-center"><app-spinner size="md"></app-spinner></div>
      } @else if (error()) {
        <p class="lp-muted" role="alert">
          No pudimos cargar esta ruta de aprendizaje. Intenta de nuevo en un momento.
        </p>
      } @else if (path(); as p) {
        <header class="lp-header">
          <h3 class="lp-title">{{ p.title }}</h3>
          @if (p.summary) {
            <p class="lp-muted">{{ p.summary }}</p>
          }
          <p class="lp-progress">
            {{ completedCount() }} de {{ p.items.length }} videos completados
          </p>
        </header>

        @if (current(); as item) {
          <div class="lp-player">
            <app-video-player
              [videoUrl]="item.video.video_url"
              [videoSource]="item.video.video_source"
              [externalId]="item.video.external_id"
              (ended)="markCompleted(item)"
            ></app-video-player>
            <div class="lp-player-actions">
              <h4 class="lp-video-title">{{ item.video.title }}</h4>
              @if (!isDone(item)) {
                <button type="button" class="lp-btn" (click)="markCompleted(item)">
                  <app-icon name="check" [size]="14"></app-icon>
                  <span>Marcar como visto</span>
                </button>
              }
            </div>
          </div>
        }

        <ol class="lp-list">
          @for (item of p.items; track item.video.id) {
            <li
              class="lp-item"
              [class.lp-item-active]="item.video.id === currentId()"
            >
              <button
                type="button"
                class="lp-item-main"
                [attr.aria-current]="item.video.id === currentId() ? 'true' : null"
                (click)="select(item)"
              >
                <span class="lp-index">{{ item.position }}</span>
                <span class="lp-item-text">
                  <span class="lp-item-title">{{ item.video.title }}</span>
                  @if (item.video.duration_seconds) {
                    <span class="lp-muted">{{ formatDuration(item.video.duration_seconds) }}</span>
                  }
                </span>
                @if (isDone(item)) {
                  <span class="lp-done" role="img" aria-label="Completado">
                    <app-icon name="check-circle" [size]="18"></app-icon>
                  </span>
                }
              </button>
              @if (item.article) {
                <a class="lp-article" [routerLink]="['/admin/help/center', item.article.slug]">
                  <app-icon name="file-text" [size]="14"></app-icon>
                  <span>Leer: {{ item.article.title }}</span>
                </a>
              }
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: [`
    .lp-detail { display: flex; flex-direction: column; gap: 1rem; }
    .lp-center { display: flex; justify-content: center; padding: 2rem 0; }
    .lp-back { display: inline-flex; align-items: center; gap: .375rem; align-self: flex-start;
      background: none; border: 0; cursor: pointer; font-size: .875rem; font-weight: 600;
      color: var(--color-primary); padding: .25rem 0; }
    .lp-title { margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--color-text-primary); }
    .lp-muted { margin: 0; font-size: .8125rem; color: var(--color-text-secondary); }
    .lp-progress { margin: .25rem 0 0; font-size: .8125rem; font-weight: 600; color: var(--color-primary); }
    .lp-player { display: flex; flex-direction: column; gap: .75rem; }
    .lp-player-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; }
    .lp-video-title { margin: 0; font-size: 1rem; font-weight: 600; color: var(--color-text-primary); }
    .lp-btn { display: inline-flex; align-items: center; gap: .375rem; padding: .5rem .875rem;
      border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface);
      color: var(--color-text-primary); font-size: .8125rem; font-weight: 600; cursor: pointer; min-height: 2.5rem; }
    .lp-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
    .lp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .lp-item { border: 1px solid var(--color-border); border-radius: var(--radius-lg);
      background: var(--color-surface); overflow: hidden; }
    .lp-item-active { border-color: var(--color-primary); }
    .lp-item-main { display: flex; align-items: center; gap: .75rem; width: 100%; text-align: left;
      background: none; border: 0; cursor: pointer; padding: .75rem; min-height: 3rem; }
    .lp-index { flex: none; width: 1.75rem; height: 1.75rem; border-radius: 9999px; display: grid;
      place-items: center; font-size: .75rem; font-weight: 700; background: var(--color-background);
      color: var(--color-text-secondary); }
    .lp-item-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .lp-item-title { font-size: .9375rem; font-weight: 600; color: var(--color-text-primary); }
    .lp-done { color: var(--color-success); display: inline-flex; }
    .lp-article { display: inline-flex; align-items: center; gap: .375rem; padding: .5rem .75rem .75rem 3.5rem;
      font-size: .8125rem; color: var(--color-primary); text-decoration: none; }
    .lp-article:hover { text-decoration: underline; }
  `],
})
export class LearningPathDetailComponent {
  private service = inject(LearningPathsService);
  private destroyRef = inject(DestroyRef);

  readonly pathId = input.required<number>();
  readonly closed = output<void>();
  /** Notifies the parent so the list can refresh its progress counters. */
  readonly progressChanged = output<void>();

  readonly path = signal<LearningPathDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly currentId = signal<number | null>(null);

  readonly current = computed(
    () => this.path()?.items.find((i) => i.video.id === this.currentId()) ?? null,
  );
  readonly completedCount = computed(
    () => this.path()?.items.filter((i) => this.isDone(i)).length ?? 0,
  );

  constructor() {
    effect(() => {
      const id = this.pathId();
      this.loading.set(true);
      this.error.set(false);
      this.service
        .get(id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (p) => {
            this.path.set(p);
            // Resume at the first unfinished video, or the first one.
            const next = p.items.find((i) => !i.progress?.completed) ?? p.items[0];
            this.currentId.set(next?.video.id ?? null);
            this.loading.set(false);
          },
          error: () => {
            this.error.set(true);
            this.loading.set(false);
          },
        });
    });
  }

  isDone(item: LearningPathItem): boolean {
    return !!item.progress?.completed;
  }

  select(item: LearningPathItem): void {
    this.currentId.set(item.video.id);
  }

  markCompleted(item: LearningPathItem): void {
    const p = this.path();
    if (!p || this.isDone(item)) return;
    this.service
      .saveProgress({
        video_id: item.video.id,
        series_id: p.id,
        seconds_watched: item.video.duration_seconds,
        completed: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.path.update((cur) =>
            cur
              ? {
                  ...cur,
                  items: cur.items.map((i) =>
                    i.video.id === item.video.id
                      ? {
                          ...i,
                          progress: {
                            seconds_watched: item.video.duration_seconds,
                            completed: true,
                          },
                        }
                      : i,
                  ),
                }
              : cur,
          );
          this.progressChanged.emit();
        },
      });
  }

  formatDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
