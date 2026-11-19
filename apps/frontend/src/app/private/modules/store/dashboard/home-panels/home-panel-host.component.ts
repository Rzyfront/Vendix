import {
  ChangeDetectionStrategy,
  Component,
  Type,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { HomePanelId } from '../../../../../shared/constants/home-panels';
import { HomePanelService } from './home-panel.service';

/**
 * QUI-967 — host of `/admin/dashboard`. Shows the tabs resolved by
 * `HomePanelService` (bar only when there is more than one), loads lazily the
 * active panel only and never persists the tab the user picks.
 */
@Component({
  selector: 'app-home-panel-host',
  standalone: true,
  imports: [NgComponentOutlet, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tabs().length > 1) {
      <div
        class="flex items-center gap-1 overflow-x-auto scrollbar-hide mb-3"
        role="tablist"
        aria-label="Paneles"
      >
        @for (tab of tabs(); track tab.id) {
          <button
            type="button"
            role="tab"
            class="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors"
            [class.tab-active]="activeId() === tab.id"
            [class.tab-inactive]="activeId() !== tab.id"
            [attr.aria-selected]="activeId() === tab.id"
            (click)="select(tab.id)"
          >
            <app-icon [name]="tab.icon" [size]="16"></app-icon>
            <span>{{ tab.title }}</span>
          </button>
        }
      </div>
    }

    @if (activeRoute(); as route) {
      <div class="flex justify-end mb-2">
        <a
          [routerLink]="route"
          class="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-primary"
        >
          <span>Abrir módulo completo</span>
          <app-icon name="external-link" [size]="12"></app-icon>
        </a>
      </div>
    }

    @if (activeComponent(); as component) {
      <ng-container *ngComponentOutlet="component" />
    } @else if (loadFailed()) {
      <p class="py-8 text-center text-sm text-text-secondary">
        No se pudo cargar este panel. Intenta de nuevo en unos segundos.
      </p>
    } @else {
      <div class="py-8 text-center text-sm text-text-secondary">Cargando…</div>
    }
  `,
  styles: [
    `
      .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
      .scrollbar-hide::-webkit-scrollbar {
        display: none;
      }
      .tab-active {
        background-color: var(--color-primary);
        color: white;
      }
      .tab-inactive {
        background-color: var(--color-surface);
        color: var(--color-text-secondary);
      }
      .tab-inactive:hover {
        background-color: var(--color-neutral-50);
        color: var(--color-text-primary);
      }
    `,
  ],
})
export class HomePanelHostComponent {
  private readonly panels = inject(HomePanelService);

  readonly tabs = this.panels.visibleTabs;

  /** Tab picked by the user in this visit; local state, never saved. */
  private readonly selectedId = signal<HomePanelId | null>(null);

  /** Active tab; falls back to the first one when the picked tab vanishes. */
  readonly activeId = computed<HomePanelId | null>(() => {
    const tabs = this.tabs();
    const selected = this.selectedId();
    if (selected && tabs.some((tab) => tab.id === selected)) return selected;
    return tabs[0]?.id ?? null;
  });

  private readonly active = computed(
    () => this.tabs().find((tab) => tab.id === this.activeId()) ?? null,
  );

  /** Original module route; the "Resumen" has none. */
  readonly activeRoute = computed(() => this.active()?.route ?? null);

  private readonly loaded = signal<Partial<Record<HomePanelId, Type<unknown>>>>(
    {},
  );
  private readonly failed = signal<Partial<Record<HomePanelId, boolean>>>({});
  private readonly loading = new Set<HomePanelId>();

  readonly activeComponent = computed<Type<unknown> | null>(() => {
    const id = this.activeId();
    return id ? (this.loaded()[id] ?? null) : null;
  });

  readonly loadFailed = computed(() => {
    const id = this.activeId();
    return !!id && !!this.failed()[id];
  });

  constructor() {
    effect(() => {
      const tab = this.active();
      if (!tab) return;
      untracked(() => {
        if (this.loaded()[tab.id] || this.loading.has(tab.id)) return;
        this.loading.add(tab.id);
        tab
          .loadComponent()
          .then((type) =>
            this.loaded.update((current) => ({ ...current, [tab.id]: type })),
          )
          .catch(() =>
            this.failed.update((current) => ({ ...current, [tab.id]: true })),
          )
          .finally(() => this.loading.delete(tab.id));
      });
    });
  }

  select(id: HomePanelId): void {
    this.selectedId.set(id);
  }
}
