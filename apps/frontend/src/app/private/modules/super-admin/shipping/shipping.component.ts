import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ShippingMethodsComponent } from './components/shipping-methods/shipping-methods.component';
import { ShippingZonesComponent } from './components/shipping-zones/shipping-zones.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { DashboardTabsComponent, DashboardTab } from '../../store/dashboard/components/dashboard-tabs.component';
import { ShippingService } from './services/shipping.service';
import { ShippingMethodStats, ShippingZoneStats } from './interfaces/shipping.interface';

@Component({
  selector: 'app-superadmin-shipping-layout',
  standalone: true,
  imports: [
    CommonModule,
    ShippingMethodsComponent,
    ShippingZonesComponent,
    StatsComponent,
    DashboardTabsComponent,
  ],
  template: `
    <div class="space-y-4 p-4 md:p-6">
      <!-- Stats consolidadas usando stats-container -->
      <div class="stats-container">
        <app-stats
          title="Métodos Totales"
          [value]="methodStats()?.total_methods || 0"
          iconName="truck"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        />
        <app-stats
          title="Métodos Activos"
          [value]="methodStats()?.active_methods || 0"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        />
        <app-stats
          title="Zonas Totales"
          [value]="zoneStats()?.total_zones || 0"
          iconName="map-pin"
          iconBgColor="bg-indigo-100"
          iconColor="text-indigo-600"
        />
        <app-stats
          title="Zonas Activas"
          [value]="zoneStats()?.active_zones || 0"
          iconName="globe"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        />
      </div>

      <!-- Tabs debajo de stats (patrón dashboard) -->
      <app-dashboard-tabs
        [tabs]="tabs"
        [activeTab]="activeTab()"
        (tabChange)="setActiveTab($event)"
      />

      <!-- Contenido según tab activo -->
      @switch (activeTab()) {
        @case ('methods') {
          <app-superadmin-shipping-methods />
        }
        @case ('zones') {
          <app-superadmin-shipping-zones />
        }
      }
    </div>
  `,
})
export class ShippingLayoutComponent implements OnInit {
  private shippingService = inject(ShippingService);

  activeTab = signal<'methods' | 'zones'>('methods');
  methodStats = signal<ShippingMethodStats | null>(null);
  zoneStats = signal<ShippingZoneStats | null>(null);

  tabs: DashboardTab[] = [
    { id: 'methods', label: 'Métodos de Envío', shortLabel: 'Métodos', icon: 'truck' },
    { id: 'zones', label: 'Zonas y Tarifas', shortLabel: 'Zonas', icon: 'map-pin' },
  ];

  ngOnInit(): void {
    this.loadStats();
  }

  loadStats(): void {
    this.shippingService.getMethodStats().subscribe((stats) => this.methodStats.set(stats));
    this.shippingService.getZoneStats().subscribe((stats) => this.zoneStats.set(stats));
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab as 'methods' | 'zones');
  }
}
