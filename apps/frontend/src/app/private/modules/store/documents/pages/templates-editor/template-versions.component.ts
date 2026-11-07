import { Component, computed, inject, input } from '@angular/core';
import { BadgeComponent } from '../../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { TemplateVersionRow } from '../../interfaces/document-template.interfaces';

/** Published versions of a template, newest first; published versions never change. */
@Component({
  selector: 'app-template-versions',
  standalone: true,
  imports: [BadgeComponent],
  template: `
    @if (rows().length === 0) {
      <p class="text-sm text-text-secondary" data-testid="versions-empty">
        Aún no hay versiones publicadas. Publica la plantilla para que los flujos puedan usarla.
      </p>
    } @else {
      <ul class="flex flex-col gap-2" data-testid="versions">
        @for (row of rows(); track row.id) {
          <li class="flex flex-col gap-1 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between" [attr.data-version]="row.version">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-text-primary">Versión {{ row.version }}</span>
              @if (row.id === currentId()) {
                <app-badge variant="success" size="xs">Vigente</app-badge>
              }
              <span class="text-xs text-text-secondary">{{ row.date }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
              <span>{{ row.token_schema.length }} variables</span>
              <span title="Huella del contenido">{{ row.hash }}</span>
            </div>
          </li>
        }
      </ul>
    }
  `,
})
export class TemplateVersionsComponent {
  private readonly settings = inject(StoreSettingsFacade);

  readonly versions = input<TemplateVersionRow[]>([]);
  /** Id of the version the template serves today. */
  readonly currentId = input<number | null>(null);

  readonly rows = computed(() =>
    this.versions().map((v) => ({
      ...v,
      date: formatStoreDateTime(v.published_at, this.settings.timezone()),
      hash: v.body_hash.slice(0, 10),
    })),
  );
}
