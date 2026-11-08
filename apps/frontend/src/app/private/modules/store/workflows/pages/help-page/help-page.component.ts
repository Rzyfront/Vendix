import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  AlertBannerComponent,
  CardComponent,
  IconComponent,
  InputsearchComponent,
  StickyHeaderComponent,
} from '../../../../../../shared/components/index';
import { WorkflowLimitsApiService } from '../../services/workflow-limits-api.service';
import { HELP_ENTRIES, HELP_GROUPS, HelpLiveKind, NOT_DOING } from './help-page.data';
import { LimitRow, LiveGroup, limitRow, liveGroups, matchesQuery } from './help-page.util';

type LimitsState = 'loading' | 'ready' | 'error';

/**
 * "Ayuda" (Flujos P7.7): searchable FAQ and short guides. Stage types,
 * events, actions, connectors and plan limits come from the system's own
 * registries and API, so the answers never go stale.
 */
@Component({
  selector: 'app-workflow-help-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    StickyHeaderComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    AlertBannerComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden" data-testid="help-page">
      <app-sticky-header
        title="Ayuda"
        subtitle="Preguntas frecuentes y guías cortas sobre Flujos y Documentos"
        icon="life-buoy"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
      />

      <app-card [responsive]="true" overflow="visible">
        <app-inputsearch
          size="sm"
          placeholder="Buscar en la ayuda..."
          ariaLabel="Buscar en la ayuda"
          [debounceTime]="200"
          (searchChange)="query.set($event)"
        />
      </app-card>

      @if (visibleGroups().length === 0 && !showNotDoing()) {
        <app-card [responsive]="true" class="mt-3 block">
          <p class="text-sm text-text-secondary" data-testid="help-empty">
            No hay respuestas para «{{ query() }}». Prueba con otra palabra.
          </p>
        </app-card>
      }

      @for (group of visibleGroups(); track group.id) {
        <app-card [responsive]="true" [title]="group.title" class="mt-3 block">
          <ul class="divide-y divide-border" [attr.data-testid]="'group-' + group.id">
            @for (entry of group.entries; track entry.id) {
              <li [attr.data-testid]="'entry-' + entry.id">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium text-text-primary"
                  [attr.aria-expanded]="isOpen(entry.id)"
                  [attr.aria-controls]="'answer-' + entry.id"
                  [attr.data-testid]="'question-' + entry.id"
                  (click)="toggle(entry.id)"
                >
                  <span>{{ entry.question }}</span>
                  <app-icon [name]="isOpen(entry.id) ? 'chevron-up' : 'chevron-down'" [size]="16" />
                </button>
                @if (isOpen(entry.id)) {
                  <div [id]="'answer-' + entry.id" class="pb-4 text-sm text-text-secondary">
                    @for (p of entry.paragraphs; track $index) {
                      <p class="mb-2">{{ p }}</p>
                    }
                    @if (entry.live; as kind) {
                      @if (kind === 'limits') {
                        @switch (limitsState()) {
                          @case ('loading') {
                            <p class="text-xs">Cargando tu uso del plan...</p>
                          }
                          @case ('error') {
                            <app-alert-banner variant="warning" icon="alert-triangle">
                              No se pudo cargar tu uso actual. Revísalo en «Uso del plan».
                            </app-alert-banner>
                          }
                          @case ('ready') {
                            <ul class="mb-2 space-y-1" data-testid="limits-live">
                              @for (row of limits(); track row.key) {
                                <li [attr.data-testid]="'limit-' + row.key">
                                  <span class="font-medium text-text-primary">{{ row.label }}:</span>
                                  {{ row.text }}
                                </li>
                              }
                            </ul>
                          }
                        }
                      } @else {
                        @for (g of live(kind); track g.title) {
                          <p class="mt-2 text-xs font-semibold uppercase text-text-primary">{{ g.title }}</p>
                          <ul class="mb-2 list-disc pl-5" [attr.data-testid]="'live-' + kind">
                            @for (item of g.items; track item) {
                              <li>{{ item }}</li>
                            }
                          </ul>
                        }
                      }
                    }
                    <p class="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                      @for (link of entry.links; track link.path) {
                        <a class="font-medium text-primary hover:underline" [routerLink]="link.path"
                          >Ir a {{ link.label }}</a
                        >
                      }
                    </p>
                  </div>
                }
              </li>
            }
          </ul>
        </app-card>
      }

      @if (showNotDoing()) {
        <app-card [responsive]="true" title="Lo que Flujos no hace" class="mt-3 block">
          <ul class="space-y-3" data-testid="not-doing">
            @for (item of notDoing; track item.title) {
              <li>
                <p class="text-sm font-medium text-text-primary">{{ item.title }}</p>
                <p class="text-sm text-text-secondary">{{ item.text }}</p>
              </li>
            }
          </ul>
        </app-card>
      }
    </div>
  `,
})
export class HelpPageComponent implements OnInit {
  private readonly limitsApi = inject(WorkflowLimitsApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly query = signal('');
  readonly notDoing = NOT_DOING;
  readonly limits = signal<LimitRow[]>([]);
  readonly limitsState = signal<LimitsState>('loading');
  private readonly open = signal<ReadonlySet<string>>(new Set());

  readonly visibleGroups = computed(() => {
    const q = this.query();
    return HELP_GROUPS.map((group) => ({
      ...group,
      entries: HELP_ENTRIES.filter((e) => e.group === group.id && matchesQuery(e, q)),
    })).filter((group) => group.entries.length > 0);
  });

  /** The honest-limits section stays visible unless the search excludes it. */
  readonly showNotDoing = computed(() => {
    const q = this.query();
    if (!q.trim()) return true;
    return NOT_DOING.some((item) =>
      matchesQuery(
        { id: item.title, group: 'start', question: item.title, paragraphs: [item.text], links: [] },
        q,
      ),
    );
  });

  ngOnInit(): void {
    this.limitsApi
      .usage()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (snapshot) => {
          this.limits.set(snapshot.metrics.map(limitRow));
          this.limitsState.set('ready');
        },
        error: () => this.limitsState.set('error'),
      });
  }

  isOpen(id: string): boolean {
    return this.open().has(id);
  }

  toggle(id: string): void {
    this.open.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  live(kind: HelpLiveKind): LiveGroup[] {
    return liveGroups(kind);
  }
}
