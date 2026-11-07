import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { formatFileSize, shortHash } from '../../../workflows/utils/workflow-labels.util';
import { DocumentsTabsComponent } from '../../components/documents-tabs.component';
import { PurgeRunDetail } from '../../interfaces/document-library.interfaces';
import {
  DocumentsLibraryApiService,
  libraryErrorMessage,
} from '../../services/documents-library-api.service';

/** Report of one purge run: totals and every file it purged or skipped. */
@Component({
  selector: 'app-documents-retention-run-page',
  standalone: true,
  imports: [
    RouterLink,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    BadgeComponent,
    IconComponent,
    EmptyStateComponent,
    DocumentsTabsComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Documentos"
        subtitle="Informe de purga"
        icon="folder-open"
        variant="glass"
      />
      <app-documents-tabs active="retention" />

      <div class="px-2 pb-2 md:px-0">
        <a
          class="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          [routerLink]="['/admin/documents/retention']"
        >
          <app-icon name="chevron-left" [size]="14" />
          Volver a Retención
        </a>
      </div>

      @if (loading()) {
        <div class="p-4 text-center md:p-6">
          <div class="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando informe...</p>
        </div>
      } @else if (run(); as r) {
        <div class="stats-container">
          <app-stats
            title="Purgados"
            [value]="r.files_purged"
            [smallText]="dateText(r.started_at)"
            iconName="archive"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
          />
          <app-stats
            title="Liberados"
            [value]="sizeText(r.bytes_purged)"
            [smallText]="r.trigger === 'schedule' ? 'Corrida programada' : 'Corrida manual'"
            iconName="download"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          />
          <app-stats
            title="Retención legal"
            [value]="r.skipped_legal_hold"
            smallText="Omitidos, siguen descargables"
            iconName="lock"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          />
        </div>
        @if (r.error) {
          <p class="px-2 pb-2 text-sm text-error" role="alert">{{ r.error }}</p>
        }
        <app-card [responsive]="true" [padding]="false" overflow="visible">
          @if (r.items.length === 0) {
            <app-empty-state
              icon="file-text"
              title="Esta corrida no encontró archivos"
              description="Ningún archivo había vencido según las políticas."
              [showActionButton]="false"
            />
          } @else {
            <ul class="flex flex-col gap-2 p-3 md:p-4" data-testid="run-items">
              @for (item of r.items; track item.id) {
                <li class="rounded-xl border border-border p-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-medium text-text-primary">{{ item.original_name }}</span>
                    <app-badge [variant]="item.outcome === 'purged' ? 'error' : 'warning'" size="xs">
                      {{ item.outcome === 'purged' ? 'Purgado' : 'Omitido por retención legal' }}
                    </app-badge>
                  </div>
                  <p class="mt-1 text-xs text-text-secondary">
                    {{ item.reason }} · {{ sizeText(item.size_bytes) }} ·
                    <span class="font-mono" [title]="item.sha256">{{ hashText(item.sha256) }}</span>
                  </p>
                </li>
              }
            </ul>
          }
        </app-card>
      }
    </div>
  `,
})
export class DocumentsRetentionRunPageComponent implements OnInit {
  private readonly api = inject(DocumentsLibraryApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly run = signal<PurgeRunDetail | null>(null);
  readonly loading = signal(true);

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.api
      .purgeRun(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (run) => {
          this.run.set(run);
          this.loading.set(false);
        },
        error: (error) => {
          this.loading.set(false);
          this.toast.error(libraryErrorMessage(error));
        },
      });
  }

  dateText(value: string): string {
    return formatStoreDateTime(value, this.settings.timezone());
  }

  sizeText(bytes: number): string {
    return bytes > 0 ? formatFileSize(bytes) : '0 B';
  }

  hashText(hash: string): string {
    return shortHash(hash);
  }
}
