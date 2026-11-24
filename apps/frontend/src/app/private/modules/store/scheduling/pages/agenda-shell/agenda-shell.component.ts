import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import {
  StickyHeaderComponent,
  StickyHeaderTab,
} from '../../../../../../shared/components/index';
import { ModuleShellActionsService } from '../../../../../../shared/components/module-tabs-shell/module-shell-actions.service';
import { SchedulingAgendaPageComponent } from '../scheduling-agenda-page/scheduling-agenda-page.component';
import { SchedulingListPageComponent } from '../scheduling-list-page/scheduling-list-page.component';
import { SchedulingConfigTabComponent } from '../../components/scheduling-config-tab/scheduling-config-tab.component';
import {
  AgendaTab,
  ConfigSection,
  toAgendaTab,
  toConfigSection,
} from '../../scheduling-tabs';

export const AGENDA_SHELL_TABS: StickyHeaderTab[] = [
  {
    id: 'calendario',
    label: 'Calendario',
    icon: 'calendar-days',
    description: 'Reservas y pedidos programados en un solo calendario',
  },
  {
    id: 'programacion',
    label: 'Programación',
    icon: 'list',
    description: 'Reservas y pedidos programados en una tabla con filtros',
  },
  {
    id: 'configuracion',
    label: 'Configuración',
    shortLabel: 'Config.',
    icon: 'settings',
    description: 'Prestadores, horarios, bloqueos, disponibilidad y cola',
  },
];

/**
 * Órdenes → Agenda (agenda-unificada F1, estructura de Rafael 2026-11-23).
 * Un solo módulo con tres pestañas en `?tab=`: Calendario (por defecto),
 * Programación (tabla) y Configuración (`?seccion=`). Cada pestaña monta la
 * pantalla ya construida; los botones de la pestaña activa se publican en
 * esta cabecera (`ModuleShellActionsService`).
 */
@Component({
  selector: 'app-agenda-shell',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    SchedulingAgendaPageComponent,
    SchedulingListPageComponent,
    SchedulingConfigTabComponent,
  ],
  template: `
    <div class="w-full overflow-x-clip md:space-y-4">
      <app-sticky-header
        title="Agenda"
        [subtitle]="subtitle()"
        icon="calendar-days"
        variant="glass"
        tabsAriaLabel="Secciones de Agenda"
        [tabs]="tabs"
        [activeTab]="tab()"
        [actions]="shellActions.buttons()"
        (tabChanged)="onTab($event)"
        (actionClicked)="shellActions.run($event)"
      />

      <div role="tabpanel" [attr.aria-label]="tabLabel()" [attr.data-tab]="tab()">
        @switch (tab()) {
          @case ('calendario') {
            <app-scheduling-agenda-page [embedded]="true" />
          }
          @case ('programacion') {
            <app-scheduling-list-page [embedded]="true" />
          }
          @case ('configuracion') {
            <app-scheduling-config-tab [section]="section()" (sectionChange)="onSection($event)" />
          }
        }
      </div>
    </div>
  `,
})
export class AgendaShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly shellActions = inject(ModuleShellActionsService);

  readonly tabs = AGENDA_SHELL_TABS;

  // Del router (no de una señal local): atrás/adelante y las URLs viejas, que
  // redirigen aquí con `?tab=`, cambian la pestaña.
  private readonly params = toSignal(this.route.queryParamMap.pipe(map((p) => p)), {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly tab = computed<AgendaTab>(() => toAgendaTab(this.params().get('tab')));
  readonly section = computed<ConfigSection>(() => toConfigSection(this.params().get('seccion')));
  readonly tabLabel = computed(() => this.tabs.find((t) => t.id === this.tab())?.label ?? '');
  readonly subtitle = computed(() => this.tabs.find((t) => t.id === this.tab())?.description ?? '');

  constructor() {
    // La entrada del menú abre la URL sin `?tab=`: se escribe la pestaña por
    // defecto (o se corrige una desconocida) sin agregar historial.
    if (this.route.snapshot.queryParamMap.get('tab') !== this.tab()) {
      this.select({ tab: this.tab() }, true);
    }
  }

  onTab(id: string): void {
    const tab = toAgendaTab(id);
    if (tab === this.tab()) return;
    // La pestaña saliente limpia sus botones al destruirse; se limpia aquí
    // también para que Configuración (sin botones) no herede los anteriores.
    this.shellActions.clear();
    this.select({ tab, seccion: tab === 'configuracion' ? this.section() : null }, false);
  }

  onSection(section: ConfigSection): void {
    if (section === this.section()) return;
    this.select({ tab: 'configuracion', seccion: section }, false);
  }

  private select(queryParams: Record<string, string | null>, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }
}
