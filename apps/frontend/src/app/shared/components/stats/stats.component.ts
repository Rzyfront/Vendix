import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './stats.component.html',
  styleUrls: ['./stats.component.scss'],
})
export class StatsComponent {
  @Input() title!: string;
  @Input() value: string | number = '';
  @Input() smallText?: string;
  @Input() iconName: string = 'info';
  @Input() iconBgColor: string = 'bg-primary/10';
  @Input() iconColor: string = 'text-primary';
  @Input() clickable: boolean = true;
  @Input() loading: boolean = false;
}
