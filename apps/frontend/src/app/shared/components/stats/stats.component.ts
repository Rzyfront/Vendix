import { Component, Input, input } from '@angular/core';

import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './stats.component.html',
  styleUrls: ['./stats.component.scss'],
})
export class StatsComponent {
  readonly title = input.required<string>();
  readonly value = input<string | number>('');
  @Input() smallText?: string;
  readonly iconName = input<string>('info');
  readonly iconBgColor = input<string>('bg-primary/10');
  readonly iconColor = input<string>('text-primary');
  readonly clickable = input<boolean>(false);
  readonly loading = input<boolean>(false);
}
