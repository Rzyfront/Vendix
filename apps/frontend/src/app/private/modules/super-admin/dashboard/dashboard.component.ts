import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface StatCard {
  title: string;
  value: string;
  change: number;
  icon: string;
  color: string;
  trend: 'up' | 'down';
}

interface ActivityItem {
  id: string;
  type: 'organization' | 'user' | 'system' | 'store';
  title: string;
  description: string;
  timestamp: string;
  icon: string;
  color: string;
}

interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
  }[];
}

@Component({
  selector: 'app-super-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-4" style="background-color: var(--color-background);">
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div
          *ngFor="let stat of statsData; let i = index"
          class="rounded-card p-4 flex items-center gap-4 shadow-card hover:shadow-lg transition-all duration-300 relative overflow-hidden"
          style="background: linear-gradient(135deg, var(--color-surface) 0%, rgba(126, 215, 165, 0.05) 100%); border: 1px solid var(--color-border);"
        >
          <div class="absolute top-0 right-0 w-16 h-16 rounded-full opacity-20 -mr-8 -mt-8" [style.background]="getStatColor(i, 0.1)"></div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center relative z-10 text-white"
            [style.background]="getStatColor(i, 1)"
          >
            <i class="fas {{ stat.icon }} text-lg"></i>
          </div>
          <div class="flex-1 relative z-10">
            <h3 class="text-sm font-medium mb-1" style="color: var(--color-text-secondary);">{{ stat.title }}</h3>
            <p class="text-2xl font-bold mb-2" style="color: var(--color-text-primary);">
              {{ stat.value }}
            </p>
            <div class="flex items-center gap-2">
              <div 
                class="w-6 h-6 rounded-full flex items-center justify-center"
                [style.background]="stat.trend === 'up' ? 'rgba(126, 215, 165, 0.15)' : 'rgba(239, 68, 68, 0.15)'"
              >
                <i 
                  class="fas text-xs"
                  [class.fa-arrow-up]="stat.trend === 'up'"
                  [class.fa-arrow-down]="stat.trend === 'down'"
                  [style.color]="stat.trend === 'up' ? 'var(--color-primary)' : 'var(--color-destructive)'"
                ></i>
              </div>
              <span
                class="text-sm font-semibold"
                [style.color]="stat.trend === 'up' ? 'var(--color-primary)' : 'var(--color-destructive)'"
              >
                {{ getAbsValue(stat.change) }}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Charts Section -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div
          class="lg:col-span-2 rounded-card shadow-card"
          style="background: var(--color-surface); border: 1px solid var(--color-border);"
        >
          <div
            class="flex justify-between items-center p-6"
            style="border-bottom: 1px solid var(--color-border);"
          >
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center shadow-card" style="background: linear-gradient(135deg, rgba(126, 215, 165, 0.8) 0%, rgba(126, 215, 165, 0.6) 100%);">
                <i class="fas fa-chart-line text-white"></i>
              </div>
              <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">Growth Overview</h3>
            </div>
            <div class="flex gap-2 rounded-lg p-1.5" style="background: rgba(126, 215, 165, 0.08);">
              <button
                class="px-3 py-1.5 text-xs rounded-md font-medium transition-colors"
                style="background: var(--color-primary); color: white;"
              >
                7D
              </button>
              <button
                class="px-3 py-1.5 text-xs rounded-md font-medium transition-colors hover:bg-white/50"
                style="color: var(--color-text-secondary);"
              >
                30D
              </button>
              <button
                class="px-3 py-1.5 text-xs rounded-md font-medium transition-colors hover:bg-white/50"
                style="color: var(--color-text-secondary);"
              >
                90D
              </button>
            </div>
          </div>
          <div class="p-6 h-80">
            <!-- Chart Header with Stats -->
            <div class="flex justify-between items-center mb-6">
              <div class="flex gap-8">
                <div class="text-center">
                  <p class="text-2xl font-bold" style="color: var(--color-primary);">1,367</p>
                  <p class="text-xs" style="color: var(--color-text-muted);">Total</p>
                </div>
                <div class="text-center">
                  <p class="text-lg font-semibold" style="color: var(--color-primary);">+23.5%</p>
                  <p class="text-xs" style="color: var(--color-text-muted);">vs last week</p>
                </div>
                <div class="text-center">
                  <p class="text-lg font-semibold" style="color: var(--color-accent);">256</p>
                  <p class="text-xs" style="color: var(--color-text-muted);">Peak (Sat)</p>
                </div>
              </div>
            </div>
            
            <!-- Main Chart -->
            <div class="relative h-52">
              <!-- Grid Lines -->
              <div class="absolute inset-0 flex flex-col justify-between opacity-30">
                <div class="border-b" style="border-color: var(--color-border);"></div>
                <div class="border-b" style="border-color: var(--color-border);"></div>
                <div class="border-b" style="border-color: var(--color-border);"></div>
                <div class="border-b" style="border-color: var(--color-border);"></div>
              </div>
              
              <!-- Bars -->
              <div class="absolute inset-0 flex items-end justify-between gap-3 px-4">
                <div
                  *ngFor="let bar of chartData.datasets[0].data; let i = index"
                  class="flex-1 rounded-t-lg min-h-4 transition-all duration-500 hover:shadow-lg relative group cursor-pointer"
                  style="background: linear-gradient(to top, rgba(126, 215, 165, 0.6) 0%, rgba(126, 215, 165, 0.3) 100%);"
                  [style.height.%]="getBarHeight(bar)"
                >
                  <!-- Value Tooltip -->
                  <div class="absolute -top-12 left-1/2 transform -translate-x-1/2 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap shadow-lg z-20 p-2 text-xs" style="background: var(--color-surface); border: 1px solid var(--color-border); color: var(--color-text-primary);">
                    <div class="font-semibold">{{ bar }}</div>
                    <div style="color: var(--color-text-muted);">{{ chartData.labels[i] }}</div>
                    <div class="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 rotate-45 w-2 h-2" style="background: var(--color-surface); border-right: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border);"></div>
                  </div>
                  
                  <!-- Bar Animation -->
                  <div class="absolute inset-0 rounded-t-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" style="background: linear-gradient(to top, rgba(126, 215, 165, 0.8) 0%, rgba(126, 215, 165, 0.4) 100%);"></div>
                </div>
              </div>
              
              <!-- Y-axis Labels -->
              <div class="absolute left-0 top-0 h-full flex flex-col justify-between text-xs -ml-10" style="color: var(--color-text-muted);">
                <span>250</span>
                <span>200</span>
                <span>150</span>
                <span>100</span>
                <span>50</span>
                <span>0</span>
              </div>
            </div>
            
            <!-- X-axis Labels -->
            <div class="flex justify-between mt-6 px-4">
              <span *ngFor="let label of chartData.labels" class="text-xs font-medium px-3 py-1.5 rounded-md transition-colors cursor-pointer" style="color: var(--color-text-secondary); background: rgba(126, 215, 165, 0.08);" class="hover:bg-opacity-20">{{ label }}</span>
            </div>
          </div>
        </div>

        <div
          class="bg-gradient-to-br from-white via-green-50/20 to-emerald-50/10 border border-green-100/50 rounded-2xl p-6 shadow-xl"
        >
          <div class="flex items-center gap-3 mb-6">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center shadow-card" style="background: linear-gradient(135deg, rgba(126, 215, 165, 0.8) 0%, rgba(126, 215, 165, 0.6) 100%);">
              <i class="fas fa-heartbeat text-white"></i>
            </div>
            <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">System Health</h3>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="flex items-center gap-3 rounded-lg p-4 transition-all duration-200 hover:shadow-md" style="background: rgba(126, 215, 165, 0.08);">
              <i
                class="fas fa-server w-10 h-10 rounded-lg flex items-center justify-center text-sm shadow-card text-white"
                style="background: linear-gradient(135deg, rgba(126, 215, 165, 0.8) 0%, rgba(126, 215, 165, 0.6) 100%);"
              ></i>
              <div>
                <p class="text-lg font-bold" style="color: var(--color-text-primary);">99.9%</p>
                <p class="text-xs font-medium" style="color: var(--color-text-muted);">Uptime</p>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-lg p-4 transition-all duration-200 hover:shadow-md" style="background: rgba(6, 182, 212, 0.08);">
              <i
                class="fas fa-tachometer-alt w-10 h-10 rounded-lg flex items-center justify-center text-sm shadow-card text-white"
                style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.8) 0%, rgba(6, 182, 212, 0.6) 100%);"
              ></i>
              <div>
                <p class="text-lg font-bold" style="color: var(--color-text-primary);">0.8s</p>
                <p class="text-xs font-medium" style="color: var(--color-text-muted);">Response</p>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-lg p-4 transition-all duration-200 hover:shadow-md" style="background: rgba(139, 92, 246, 0.08);">
              <i
                class="fas fa-database w-10 h-10 rounded-lg flex items-center justify-center text-sm shadow-card text-white"
                style="background: linear-gradient(135deg, rgba(139, 92, 246, 0.8) 0%, rgba(139, 92, 246, 0.6) 100%);"
              ></i>
              <div>
                <p class="text-lg font-bold" style="color: var(--color-text-primary);">8.7TB</p>
                <p class="text-xs font-medium" style="color: var(--color-text-muted);">Storage</p>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-lg p-4 transition-all duration-200 hover:shadow-md" style="background: rgba(126, 215, 165, 0.08);">
              <i
                class="fas fa-shield-alt w-10 h-10 rounded-lg flex items-center justify-center text-sm shadow-card text-white"
                style="background: linear-gradient(135deg, rgba(126, 215, 165, 0.8) 0%, rgba(126, 215, 165, 0.6) 100%);"
              ></i>
              <div>
                <p class="text-lg font-bold" style="color: var(--color-text-primary);">A+</p>
                <p class="text-xs font-medium" style="color: var(--color-text-muted);">Security</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Activity Section -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          class="rounded-card shadow-card"
          style="background: var(--color-surface); border: 1px solid var(--color-border);"
        >
          <div
            class="flex justify-between items-center p-6"
            style="border-bottom: 1px solid var(--color-border);"
          >
            <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">Recent Activity</h3>
            <button
              class="text-xs px-3 py-1.5 rounded-md font-medium transition-colors hover:bg-opacity-10"
              style="color: var(--color-primary); background: rgba(126, 215, 165, 0.1);"
            >
              View all
            </button>
          </div>
          <div class="p-6">
            <div
              *ngFor="let activity of recentActivities.slice(0, 4)"
              class="flex gap-4 py-4 transition-colors -mx-2 px-2 rounded-lg"
              style="border-bottom: 1px solid var(--color-border);"
              [class.last:border-b-0]="true"
              [style.background]="'rgba(126, 215, 165, 0.05)'"
              class="hover:bg-opacity-10"
            >
              <div
                class="w-10 h-10 rounded-lg flex items-center justify-center text-sm flex-shrink-0 shadow-card"
                style="background: linear-gradient(135deg, rgba(126, 215, 165, 0.2) 0%, rgba(126, 215, 165, 0.1) 100%); color: var(--color-primary);"
              >
                <i class="fas {{ activity.icon }}"></i>
              </div>
              <div class="flex-1">
                <p class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);">
                  {{ activity.title }}
                </p>
                <p class="text-xs mb-2" style="color: var(--color-text-secondary);">
                  {{ activity.description }}
                </p>
                <p class="text-xs font-medium" style="color: var(--color-text-muted);">{{ activity.timestamp }}</p>
              </div>
            </div>
          </div>
        </div>

        <div
          class="rounded-card shadow-card"
          style="background: var(--color-surface); border: 1px solid var(--color-border);"
        >
          <div
            class="flex justify-between items-center p-6"
            style="border-bottom: 1px solid var(--color-border);"
          >
            <h3 class="text-lg font-semibold" style="color: var(--color-text-primary);">
              Top Organizations
            </h3>
            <button class="p-2 rounded-lg transition-colors hover:bg-opacity-10" style="color: var(--color-text-secondary); background: rgba(126, 215, 165, 0.05);">
              <i class="fas fa-sync-alt text-sm"></i>
            </button>
          </div>
          <div class="p-6">
            <div
              *ngFor="let org of topOrganizations.slice(0, 5); let i = index"
              class="flex items-center gap-4 py-4 transition-colors -mx-2 px-2 rounded-lg"
              style="border-bottom: 1px solid var(--color-border);"
              [class.last:border-b-0]="true"
              [style.background]="'rgba(126, 215, 165, 0.05)'"
              class="hover:bg-opacity-10"
            >
              <span
                class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-card text-white"
                style="background: linear-gradient(135deg, rgba(126, 215, 165, 0.8) 0%, rgba(126, 215, 165, 0.6) 100%);"
                >{{ i + 1 }}</span
              >
              <div class="flex-1">
                <p class="text-sm font-semibold mb-1" style="color: var(--color-text-primary);">{{ org.name }}</p>
                <p class="text-xs font-medium" style="color: var(--color-text-secondary);">
                  {{ org.stores }} stores • {{ org.users.toLocaleString() }} users
                </p>
              </div>
              <div class="flex items-center gap-1">
                <i 
                  class="fas text-xs"
                  [class.fa-arrow-up]="org.growth > 0"
                  [class.fa-arrow-down]="org.growth < 0"
                  [style.color]="org.growth > 0 ? 'var(--color-primary)' : 'var(--color-destructive)'"
                ></i>
                <span
                  class="text-xs font-bold"
                  [style.color]="org.growth > 0 ? 'var(--color-primary)' : 'var(--color-destructive)'"
                >
                  {{ getAbsValue(org.growth) }}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [],
})
export class DashboardComponent {
  statsData: StatCard[] = [
    {
      title: 'Total Organizations',
      value: '2,847',
      change: 18.5,
      icon: 'fa-building',
      color: '#7ed7a5',
      trend: 'up',
    },
    {
      title: 'Total Users',
      value: '48,392',
      change: 24.3,
      icon: 'fa-users',
      color: '#06b6d4',
      trend: 'up',
    },
    {
      title: 'Active Stores',
      value: '12,654',
      change: 15.7,
      icon: 'fa-store',
      color: '#10b981',
      trend: 'up',
    },
    {
      title: 'Platform Growth',
      value: '32.8%',
      change: 12.4,
      icon: 'fa-chart-line',
      color: '#8b5cf6',
      trend: 'up',
    },
  ];

  chartData: ChartData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'New Organizations',
        data: [145, 189, 167, 234, 198, 256, 178],
        borderColor: '#3b82f6',
        backgroundColor: '#3b82f6',
      },
    ],
  };

  recentActivities: ActivityItem[] = [
    {
      id: '1',
      type: 'organization',
      title: 'New organization registered',
      description: 'TechCorp Inc joined the platform with 5 stores',
      timestamp: '30 minutes ago',
      icon: 'fa-building',
      color: '#7ed7a5',
    },
    {
      id: '2',
      type: 'system',
      title: 'System update completed',
      description: 'Platform v2.1.0 deployed successfully',
      timestamp: '2 hours ago',
      icon: 'fa-check',
      color: '#06b6d4',
    },
    {
      id: '3',
      type: 'user',
      title: 'New super admin added',
      description: 'Sarah Wilson granted super admin access',
      timestamp: '4 hours ago',
      icon: 'fa-user-plus',
      color: '#f59e0b',
    },
    {
      id: '4',
      type: 'store',
      title: 'Store milestone reached',
      description: 'FashionHub achieved 1000 orders this month',
      timestamp: '6 hours ago',
      icon: 'fa-trophy',
      color: '#8b5cf6',
    },
    {
      id: '5',
      type: 'organization',
      title: 'Organization upgraded',
      description: 'GlobalRetail moved to Enterprise plan',
      timestamp: '1 day ago',
      icon: 'fa-arrow-up',
      color: '#10b981',
    },
  ];

  topOrganizations = [
    { name: 'TechCorp Inc', stores: 284, users: 8947, growth: 28.5 },
    { name: 'GlobalRetail', stores: 196, users: 6234, growth: 22.3 },
    { name: 'FashionHub', stores: 167, users: 4892, growth: 18.7 },
    { name: 'FoodChain', stores: 145, users: 3456, growth: 15.2 },
    { name: 'SportsWorld', stores: 128, users: 2789, growth: 12.8 },
  ];

  // Helper methods for template expressions
  getBarHeight(bar: number): number {
    const maxValue = Math.max(...this.chartData.datasets[0].data);
    return (bar / maxValue) * 100;
  }

  getGrowthDirection(growth: number): string {
    return growth > 0 ? 'up' : 'down';
  }

  getAbsValue(value: number): number {
    return Math.abs(value);
  }

  getProgressWidth(change: number): number {
    return Math.min(Math.abs(change) * 10, 100);
  }

  getStatColor(index: number, opacity: number): string {
    const colors = [
      `rgba(126, 215, 165, ${opacity})`, // Green
      `rgba(6, 182, 212, ${opacity})`, // Cyan
      `rgba(139, 92, 246, ${opacity})`, // Purple
      `rgba(251, 146, 60, ${opacity})`, // Orange
    ];
    return colors[index % colors.length];
  }
}
