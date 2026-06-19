import { Component, input } from '@angular/core';
import { StatsComponent } from '../../../../../../shared/components/index';

export interface VehicleStats {
  total: number;
  active: number;
  inactive: number;
}

@Component({
  selector: 'app-vehicle-stats',
  standalone: true,
  imports: [StatsComponent],
  templateUrl: './vehicle-stats.component.html',
  styles: [`:host { display: contents; }`],
})
export class VehicleStatsComponent {
  readonly stats = input<VehicleStats>({
    total: 0,
    active: 0,
    inactive: 0,
  });

  readonly loading = input<boolean>(false);
}
