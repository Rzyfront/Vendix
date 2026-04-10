import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReportDefinition } from '../../interfaces/report.interface';
import { REPORT_CATEGORIES } from '../../config/report-registry';

@Component({
  selector: 'vendix-report-card',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './report-card.component.html',
  styleUrls: ['./report-card.component.scss'],
})
export class ReportCardComponent {
  report = input.required<ReportDefinition>();
  selected = output<string>();

  showTooltip = false;

  get categoryColor(): string {
    const cat = REPORT_CATEGORIES.find(c => c.id === this.report().category);
    return cat?.color || 'var(--color-primary)';
  }

  get categoryLabel(): string {
    const cat = REPORT_CATEGORIES.find(c => c.id === this.report().category);
    return cat?.label || '';
  }

  onClick(): void {
    this.selected.emit(this.report().id);
  }
}
