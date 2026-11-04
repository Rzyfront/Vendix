import { ChangeDetectionStrategy, Component, computed, inject, input, output, viewChild } from '@angular/core';

import type { StoreHomeAppLink } from '../../../../../../public/store-home/store-home.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StoreAppsService } from '../../services/store-apps.service';
import type { AppPageDocument } from '../../templates';
import { AppPageBuilderPageComponent } from '../app-page-builder-page.component';
import {
  MAX_STORE_HOME_FOOTER,
  StoreHomeContext,
  StoreHomeSettings,
  storeHomeBuilderAdapter,
  storeHomeKinds,
} from './store-home-builder';

/**
 * F6-B — the store home's own part of General: which published apps «Mis
 * apps» lists and in which order (`blocks[apps].props.kinds`; absent = all,
 * as before) and the footer line.
 */
@Component({
  selector: 'app-store-home-general',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="store-home-general-apps">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">Apps que se muestran</h3>
      @if (!hasAppsBlock()) {
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Tu inicio no muestra accesos a tus apps.</p>
        <button type="button" class="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary)]"
                data-testid="store-home-add-apps" (click)="addApps.emit()">
          <app-icon name="plus" [size]="14" /> Mostrar mis apps
        </button>
      } @else if (!published().length) {
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]" data-testid="store-home-no-apps">
          Aún no tienes otras apps publicadas. Cuando publiques una, aparece aquí.
        </p>
      } @else {
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
          {{ kinds() === null ? 'Se muestran todas tus apps publicadas, también las que publiques después.' : 'Solo las marcadas, en este orden.' }}
        </p>
        <ul class="mt-3 space-y-1.5">
          @for (row of rows(); track row.app.kind; let i = $index; let last = $last) {
            <li class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2" [attr.data-testid]="'store-home-app-' + row.app.kind">
              <input type="checkbox" class="h-4 w-4 accent-[var(--color-primary)]" [checked]="row.shown"
                     [attr.aria-label]="'Mostrar ' + row.app.name" (change)="toggle(row.app.kind)" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm text-[var(--color-text-primary)]">{{ row.app.name }}</span>
                <span class="block truncate text-[11px] text-[var(--color-text-secondary)]">{{ row.app.url }}</span>
              </span>
              <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] disabled:opacity-30" [disabled]="!row.shown || i === 0"
                      [attr.aria-label]="'Subir ' + row.app.name" (click)="shift(row.app.kind, -1)">
                <app-icon name="chevron-up" [size]="14" />
              </button>
              <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] disabled:opacity-30" [disabled]="!row.shown || last || !rows()[i + 1].shown"
                      [attr.aria-label]="'Bajar ' + row.app.name" (click)="shift(row.app.kind, 1)">
                <app-icon name="chevron-down" [size]="14" />
              </button>
            </li>
          }
        </ul>
        @if (kinds() !== null) {
          <button type="button" class="mt-2 text-xs font-semibold text-[var(--color-primary)]" data-testid="store-home-apps-all"
                  (click)="kindsChange.emit(null)">Mostrar todas, también las nuevas</button>
        }
      }
    </section>

    <section class="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <label class="block">
        <span class="mb-1 flex justify-between text-sm font-semibold text-[var(--color-text-primary)]">
          <span>Pie de página</span>
          <span class="text-xs font-normal text-[var(--color-text-secondary)]">{{ settings().footer_text.length }}/{{ maxFooter }}</span>
        </span>
        <input type="text" [attr.maxlength]="maxFooter" placeholder="Vacío: el texto de Vendix de siempre" data-testid="store-home-footer"
               class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
               [value]="settings().footer_text" (input)="settingsChange.emit({ footer_text: $any($event.target).value })" />
      </label>
    </section>
  `,
})
export class StoreHomeGeneralComponent {
  readonly page = input.required<AppPageDocument>();
  readonly published = input<readonly StoreHomeAppLink[]>([]);
  readonly settings = input.required<StoreHomeSettings>();

  readonly settingsChange = output<StoreHomeSettings>();
  /** The new list of shown kinds; `null` = all published apps. */
  readonly kindsChange = output<string[] | null>();
  readonly addApps = output<void>();

  readonly maxFooter = MAX_STORE_HOME_FOOTER;
  readonly hasAppsBlock = computed(() => this.page().blocks.some((b) => b.type === 'apps'));
  readonly kinds = computed(() => storeHomeKinds(this.page()));

  /** Shown apps first (in their order), then the hidden ones. */
  readonly rows = computed(() => {
    const apps = this.published();
    const kinds = this.kinds();
    if (kinds === null) return apps.map((app) => ({ app, shown: true }));
    const shown = kinds.map((k) => apps.find((a) => a.kind === k)).filter((a): a is StoreHomeAppLink => !!a);
    return [
      ...shown.map((app) => ({ app, shown: true })),
      ...apps.filter((a) => !shown.includes(a)).map((app) => ({ app, shown: false })),
    ];
  });

  private shownKinds(): string[] {
    return this.rows().filter((r) => r.shown).map((r) => r.app.kind);
  }

  toggle(kind: string): void {
    const shown = this.shownKinds();
    this.kindsChange.emit(shown.includes(kind) ? shown.filter((k) => k !== kind) : [...shown, kind]);
  }

  shift(kind: string, delta: -1 | 1): void {
    const shown = this.shownKinds();
    const from = shown.indexOf(kind);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= shown.length) return;
    [shown[from], shown[to]] = [shown[to], shown[from]];
    this.kindsChange.emit(shown);
  }
}

/** F6-B — `/admin/apps/store_home`: the store home builder (shared view + store home adapter). */
@Component({
  selector: 'app-store-home-builder-page',
  standalone: true,
  imports: [AppPageBuilderPageComponent, StoreHomeGeneralComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-app-page-builder-page #builder [adapter]="adapter">
      @if (builder.settings(); as settings) {
        <app-store-home-general
          [page]="builder.page()"
          [published]="builder.context()?.apps ?? []"
          [settings]="settings"
          (settingsChange)="builder.settings.set($event)"
          (kindsChange)="setKinds($event)"
          (addApps)="builder.addBlock('apps')"
        />
      }
    </app-app-page-builder-page>
  `,
})
export class StoreHomeBuilderPageComponent {
  readonly adapter = storeHomeBuilderAdapter(inject(StoreAppsService));
  private readonly builder = viewChild.required<AppPageBuilderPageComponent<StoreHomeSettings, StoreHomeContext>>('builder');

  setKinds(kinds: string[] | null): void {
    const builder = this.builder();
    const block = builder.blocks().find((b) => b.type === 'apps');
    if (!block) return;
    if (kinds === null) {
      const { kinds: _all, ...props } = block.props;
      builder.blocks.update((blocks) => blocks.map((b) => (b.id === block.id ? { ...b, props } : b)));
      return;
    }
    builder.setProp({ blockId: block.id, key: 'kinds', value: kinds });
  }
}
