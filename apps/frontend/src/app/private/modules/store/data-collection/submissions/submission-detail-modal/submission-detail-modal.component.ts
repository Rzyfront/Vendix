import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  inject,
  OnInit,
  signal,
  computed,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DataCollectionSubmissionsService } from '../../services/data-collection-submissions.service';
import {
  DataCollectionSubmission,
  SubmissionResponse,
} from '../../interfaces/data-collection-submission.interface';
import {
  TemplateSection,
  TemplateTab,
} from '../../interfaces/data-collection-template.interface';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';

interface GroupedResponse {
  response: SubmissionResponse;
  width?: string;
}

interface GroupedSection {
  title: string;
  icon?: string;
  responses: GroupedResponse[];
  childSections?: GroupedSection[];
}

interface GroupedTab {
  title: string;
  icon?: string;
  sections: GroupedSection[];
}

@Component({
  selector: 'app-submission-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    IconComponent,
    ModalComponent,
    ScrollableTabsComponent,
    EmptyStateComponent,
    SpinnerComponent,
    ButtonComponent,
    BadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="true"
      (cancel)="close.emit()"
      title="Detalle del Formulario"
      size="lg"
    >
      <!-- Badge de estado en el header -->
      @if (submission(); as sub) {
        <div slot="header-end">
          <app-badge [variant]="getBadgeVariant(sub.status)">
            {{ getStatusLabel(sub.status) }}
          </app-badge>
        </div>
      }

      <!-- Loading state -->
      @if (loading()) {
        <div class="flex items-center justify-center py-16">
          <app-spinner size="md" />
        </div>
      } @else if (submission(); as sub) {
        <div class="space-y-5">
          <!-- Customer info -->
          @if (sub.customer || sub.booking?.customer) {
            <div
              class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 rounded-lg"
              style="background: var(--color-surface-secondary)"
            >
              <div class="flex items-center gap-2">
                <app-icon
                  name="user"
                  [size]="14"
                  color="var(--color-text-muted)"
                ></app-icon>
                <span
                  class="text-sm font-medium"
                  style="color: var(--color-text)"
                >
                  {{ (sub.customer || sub.booking?.customer)?.first_name }}
                  {{ (sub.customer || sub.booking?.customer)?.last_name }}
                </span>
              </div>
            </div>
          }

          <!-- Booking info -->
          @if (sub.booking) {
            <div
              class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 rounded-lg"
              style="background: var(--color-surface-secondary)"
            >
              <div class="flex items-center gap-2">
                <app-icon
                  name="calendar"
                  [size]="14"
                  color="var(--color-text-muted)"
                ></app-icon>
                <span class="text-sm" style="color: var(--color-text)">
                  #{{ sub.booking.booking_number }}
                </span>
              </div>
              <span class="text-sm" style="color: var(--color-text-muted)">
                {{ sub.booking.date | date: 'mediumDate' }}
              </span>
              @if (sub.booking.product) {
                <span class="text-sm" style="color: var(--color-text-muted)">
                  {{ sub.booking.product.name }}
                </span>
              }
              @if (sub.booking.provider) {
                <span class="text-sm" style="color: var(--color-text-muted)">
                  {{ sub.booking.provider.display_name }}
                </span>
              }
            </div>
          }

          <!-- AI Prediagnosis -->
          @if (sub.ai_prediagnosis) {
            <div
              class="rounded-lg overflow-hidden"
              style="border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)"
            >
              <div
                class="flex items-center gap-2 px-4 py-2.5"
                style="background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))"
              >
                <app-icon name="brain" [size]="16" color="var(--color-primary)"></app-icon>
                <span class="text-sm font-semibold" style="color: var(--color-primary)"
                  >Pre-diagnostico IA</span
                >
              </div>
              <div
                class="px-4 py-3 text-sm leading-relaxed prose-sm"
                style="color: var(--color-text); background: color-mix(in srgb, var(--color-primary) 4%, var(--color-surface))"
                [innerHTML]="sub.ai_prediagnosis"
              ></div>
            </div>
          }

          <!-- Form link (pending status) -->
          @if (sub.status === 'pending' && sub.token) {
            <div
              class="flex items-center gap-2 px-3 py-2.5 rounded-lg"
              style="background: var(--color-surface-secondary); border: 1px solid var(--color-border)"
            >
              <app-icon
                name="link"
                [size]="14"
                color="var(--color-text-muted)"
              ></app-icon>
              <span
                class="flex-1 text-xs truncate font-mono"
                style="color: var(--color-text-muted)"
              >
                {{ getFormUrl() }}
              </span>
              <app-button variant="primary" size="sm" (clicked)="copyFormLink()">
                Copiar
              </app-button>
            </div>
          }

          <!-- Tab navigation -->
          @if (groupedTabs().length > 0) {
            <app-scrollable-tabs
              [tabs]="computedTabsList()"
              [activeTab]="activeTabId()"
              size="sm"
              (tabChange)="onTabChange($event)"
            />
            @if (groupedTabs()[activeTab()]; as activeTabData) {
              @for (section of activeTabData.sections; track section.title) {
                <ng-container
                  *ngTemplateOutlet="
                    sectionTmpl;
                    context: { $implicit: section }
                  "
                ></ng-container>
              }
            }
          } @else if (groupedSections().length > 0) {
            @for (section of groupedSections(); track section.title) {
              <ng-container
                *ngTemplateOutlet="
                  sectionTmpl;
                  context: { $implicit: section }
                "
              ></ng-container>
            }
          } @else if (sub.responses && sub.responses.length > 0) {
            <div>
              <h4
                class="text-sm font-semibold mb-2 px-1"
                style="color: var(--color-text)"
              >
                Respuestas
              </h4>
              <div
                class="rounded-lg overflow-hidden"
                style="border: 1px solid var(--color-border)"
              >
                @for (
                  resp of sub.responses;
                  track resp.id;
                  let last = $last
                ) {
                  <div
                    class="flex items-start justify-between gap-4 px-4 py-2.5"
                    [style.border-bottom]="
                      last ? 'none' : '1px solid var(--color-border)'
                    "
                    style="background: var(--color-surface)"
                  >
                    <span
                      class="text-sm shrink-0"
                      style="color: var(--color-text-muted)"
                    >
                      {{ resp.field.label || 'Campo' }}
                    </span>
                    @if (isFileField(resp) && isFileUrl(resp)) {
                      <a
                        [href]="getFileUrl(resp)"
                        target="_blank"
                        rel="noopener"
                        class="text-xs underline font-medium"
                        style="color: var(--color-primary)"
                      >
                        Ver archivo
                      </a>
                    } @else {
                      <span
                        class="text-sm text-right font-medium"
                        style="color: var(--color-text)"
                      >
                        {{ getDisplayValue(resp) }}
                      </span>
                    }
                  </div>
                }
              </div>
            </div>
          } @else {
            <app-empty-state
              icon="file-text"
              title="Sin respuestas"
              description="No hay respuestas registradas en este formulario."
              [showActionButton]="false"
            />
          }

          <ng-template #sectionTmpl let-section>
            <div class="mb-4">
              <div class="flex items-center gap-2 mb-2 px-1">
                @if (section.icon) {
                  <app-icon
                    [name]="section.icon"
                    [size]="16"
                    color="var(--color-text-muted)"
                  ></app-icon>
                }
                <h4
                  class="text-sm font-semibold"
                  style="color: var(--color-text)"
                >
                  {{ section.title }}
                </h4>
              </div>
              <div class="flex flex-wrap gap-3">
                @for (resp of section.responses; track resp.response.id) {
                  <div
                    class="px-4 py-2.5 rounded-lg"
                    [ngClass]="getItemWidthClass(resp.width)"
                    style="background: var(--color-surface); border: 1px solid var(--color-border)"
                  >
                    <span
                      class="text-xs block mb-1"
                      style="color: var(--color-text-muted)"
                    >
                      {{ resp.response.field.label || 'Campo' }}
                    </span>
                    @if (
                      isFileField(resp.response) && isFileUrl(resp.response)
                    ) {
                      <a
                        [href]="getFileUrl(resp.response)"
                        target="_blank"
                        rel="noopener"
                        class="text-sm underline font-medium"
                        style="color: var(--color-primary)"
                      >
                        Ver archivo
                      </a>
                    } @else {
                      <span
                        class="text-sm font-medium"
                        style="color: var(--color-text)"
                      >
                        {{ getDisplayValue(resp.response) }}
                      </span>
                    }
                  </div>
                }
              </div>
              @if (section.childSections?.length) {
                <div
                  class="ml-4 pl-4 mt-2"
                  style="border-left: 2px solid var(--color-border)"
                >
                  @for (child of section.childSections; track child.title) {
                    <ng-container
                      *ngTemplateOutlet="
                        sectionTmpl;
                        context: { $implicit: child }
                      "
                    ></ng-container>
                  }
                </div>
              }
            </div>
          </ng-template>

          <!-- Metadata -->
          <div
            class="text-xs flex flex-wrap gap-x-4 gap-y-1 pt-2"
            style="color: var(--color-text-muted)"
          >
            @if (sub.template?.name; as templateName) {
              <span>Plantilla: {{ templateName }}</span>
            }
            <span>Creado: {{ sub.created_at | date: 'short' }}</span>
            @if (sub.submitted_at) {
              <span>Enviado: {{ sub.submitted_at | date: 'short' }}</span>
            }
            @if (sub.processed_at) {
              <span>Procesado: {{ sub.processed_at | date: 'short' }}</span>
            }
          </div>
        </div>
      }

      <!-- Footer -->
      <div slot="footer" class="flex items-center justify-end gap-3">
        <app-button variant="outline" (clicked)="close.emit()">Cerrar</app-button>
      </div>
    </app-modal>
  `,
})
export class SubmissionDetailModalComponent implements OnInit {
  submissionId = input.required<number>();
  close = output<void>();

  private submissionsService = inject(DataCollectionSubmissionsService);
  private toastService = inject(ToastService);

  submission = signal<DataCollectionSubmission | null>(null);
  loading = signal(true);
  groupedSections = signal<GroupedSection[]>([]);
  groupedTabs = signal<GroupedTab[]>([]);
  activeTab = signal(0);
  fileUrlMap = signal<Map<number, string>>(new Map());

  readonly computedTabsList = computed<ScrollableTab[]>(() =>
    this.groupedTabs().map((tab, i) => ({
      id: String(i),
      label: tab.title,
      icon: tab.icon || undefined,
    }))
  );

  readonly activeTabId = computed(() => String(this.activeTab()));

  ngOnInit() {
    this.loadSubmission();
  }

  loadSubmission() {
    this.loading.set(true);
    this.submissionsService.getOne(this.submissionId()).subscribe({
      next: (sub) => {
        this.submission.set(sub);
        const { tabs, sections } = this.buildGroupedData(sub);
        this.groupedTabs.set(tabs);
        this.groupedSections.set(sections);
        this.activeTab.set(0);
        this.resolveFileUrls(sub);
        this.loading.set(false);
      },
      error: (err) => {
        this.toastService.error(extractApiErrorMessage(err));
        this.loading.set(false);
      },
    });
  }

  onTabChange(tabId: string) {
    this.activeTab.set(Number(tabId));
  }

  private buildGroupedData(sub: DataCollectionSubmission): {
    tabs: GroupedTab[];
    sections: GroupedSection[];
  } {
    if (!sub.responses?.length) return { tabs: [], sections: [] };

    const responsesMap = new Map<number, SubmissionResponse>();
    for (const r of sub.responses) {
      responsesMap.set(r.field_id, r);
    }

    const usedFieldIds = new Set<number>();

    const buildSection = (section: TemplateSection): GroupedSection | null => {
      const sectionResponses: GroupedResponse[] = [];
      const sortedItems = [...(section.items || [])].sort(
        (a, b) => a.sort_order - b.sort_order,
      );

      for (const item of sortedItems) {
        const resp = responsesMap.get(item.metadata_field_id);
        if (resp) {
          sectionResponses.push({ response: resp, width: item.width });
          usedFieldIds.add(resp.field_id);
        }
      }

      const childSections: GroupedSection[] = [];
      if (section.child_sections?.length) {
        for (const child of [...section.child_sections].sort(
          (a, b) => a.sort_order - b.sort_order,
        )) {
          const built = buildSection(child);
          if (built) childSections.push(built);
        }
      }

      if (sectionResponses.length === 0 && childSections.length === 0)
        return null;

      return {
        title: section.title,
        icon: section.icon,
        responses: sectionResponses,
        childSections: childSections.length > 0 ? childSections : undefined,
      };
    };

    const tabs = sub.template?.tabs;
    if (tabs?.length) {
      const groupedTabs: GroupedTab[] = [];
      for (const tab of [...tabs].sort((a, b) => a.sort_order - b.sort_order)) {
        const tabSections: GroupedSection[] = [];
        const tabRawSections = tab.sections?.length
          ? tab.sections
          : (sub.template?.sections || []).filter((s) => s.tab_id === tab.id);

        for (const section of [...tabRawSections].sort(
          (a, b) => a.sort_order - b.sort_order,
        )) {
          const built = buildSection(section);
          if (built) tabSections.push(built);
        }

        if (tabSections.length > 0) {
          groupedTabs.push({
            title: tab.title,
            icon: tab.icon,
            sections: tabSections,
          });
        }
      }

      const orphaned = sub.responses.filter(
        (r) => !usedFieldIds.has(r.field_id),
      );
      if (orphaned.length > 0) {
        const orphanGrouped: GroupedResponse[] = orphaned.map((r) => ({
          response: r,
        }));
        if (groupedTabs.length > 0) {
          groupedTabs.push({
            title: 'Otros',
            sections: [{ title: 'Otros', responses: orphanGrouped }],
          });
        }
      }

      return { tabs: groupedTabs, sections: [] };
    }

    const templateSections = sub.template?.sections || [];
    const groupedSections: GroupedSection[] = [];
    for (const section of [...templateSections].sort(
      (a, b) => a.sort_order - b.sort_order,
    )) {
      const built = buildSection(section);
      if (built) groupedSections.push(built);
    }

    const orphaned = sub.responses.filter((r) => !usedFieldIds.has(r.field_id));
    if (orphaned.length > 0) {
      groupedSections.push({
        title: 'Otros',
        responses: orphaned.map((r) => ({ response: r })),
      });
    }

    return { tabs: [], sections: groupedSections };
  }

  getItemWidth(width?: string): string {
    switch (width) {
      case '25':
        return 'calc(25% - 0.75rem)';
      case '33':
        return 'calc(33.33% - 0.75rem)';
      case '50':
        return 'calc(50% - 0.75rem)';
      case '75':
        return 'calc(75% - 0.75rem)';
      default:
        return '100%';
    }
  }

  getItemWidthClass(width?: string): string {
    switch (width) {
      case '25': return 'field-width-25';
      case '33': return 'field-width-33';
      case '50': return 'field-width-50';
      case '75': return 'field-width-75';
      default: return 'field-width-100';
    }
  }

  getDisplayValue(response: SubmissionResponse): string {
    if (response.field?.field_type === 'file') {
      const val = response.value_text || '';
      if (val.startsWith('http')) return val;
      if (val.startsWith('organizations/')) return 'Archivo adjunto';
      if (val === '[object File]' || val === '[object Object]')
        return 'Archivo no disponible';
      if (val) return 'Archivo adjunto';
      return '\u2014';
    }
    if (response.value_text) return response.value_text;
    if (response.value_number !== null && response.value_number !== undefined)
      return String(response.value_number);
    if (response.value_bool !== null && response.value_bool !== undefined)
      return response.value_bool ? 'Si' : 'No';
    if (response.value_date)
      return new Date(response.value_date).toLocaleDateString('es-CO');
    if (response.value_json) return JSON.stringify(response.value_json);
    return '\u2014';
  }

  isFileField(response: SubmissionResponse): boolean {
    return response.field?.field_type === 'file';
  }

  isFileUrl(response: SubmissionResponse): boolean {
    const val = response.value_text || '';
    return val.startsWith('http') || val.startsWith('organizations/');
  }

  getFileUrl(response: SubmissionResponse): string {
    const val = response.value_text || '';
    // If already an HTTP URL (presigned or direct), use it
    if (val.startsWith('http')) return val;
    // If it's an S3 key, check the resolved URLs map
    const resolved = this.fileUrlMap().get(response.id);
    return resolved || '#';
  }

  private resolveFileUrls(sub: DataCollectionSubmission) {
    if (!sub.responses?.length) return;

    for (const resp of sub.responses) {
      if (resp.field?.field_type === 'file' && resp.value_text) {
        const val = resp.value_text;
        if (val.startsWith('organizations/')) {
          this.submissionsService.getPresignedUrl(val).subscribe({
            next: (res) => {
              const map = new Map(this.fileUrlMap());
              map.set(resp.id, res.url);
              this.fileUrlMap.set(map);
            },
          });
        }
      }
    }
  }

  getFormUrl(): string {
    const sub = this.submission();
    // Use backend-computed URL (includes correct ecommerce domain)
    if (sub?.form_url) return sub.form_url;
    // Fallback
    return sub?.token
      ? `${window.location.origin}/preconsulta/${sub.token}`
      : '';
  }

  copyFormLink() {
    const url = this.getFormUrl();
    if (url) {
      navigator.clipboard.writeText(url);
      this.toastService.success('Enlace copiado');
    }
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      in_progress: 'En progreso',
      submitted: 'Enviado',
      processing: 'Procesando',
      completed: 'Completado',
      expired: 'Expirado',
    };
    return labels[status] || status;
  }

  getBadgeVariant(status: string): 'success' | 'neutral' | 'error' | 'primary' | 'warning' {
    const variants: Record<string, 'success' | 'neutral' | 'error' | 'primary' | 'warning'> = {
      pending: 'warning',
      in_progress: 'primary',
      submitted: 'success',
      processing: 'primary',
      completed: 'success',
      expired: 'error',
    };
    return variants[status] ?? 'neutral';
  }
}
