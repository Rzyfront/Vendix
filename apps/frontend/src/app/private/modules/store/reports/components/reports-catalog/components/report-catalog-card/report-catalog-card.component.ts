import { Component, input, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';
import { ReportDefinition, ReportType } from '../../../../interfaces/report.interface';

/**
 * ReportCatalogCardComponent
 *
 * Card representation of a single report in the reports catalog grid.
 * Mirrors the analytics-card visual pattern (hover lift, accent border,
 * shadow) but consumes `ReportDefinition` from the reports registry.
 *
 * Differences vs AnalyticsCardComponent:
 * - Input is `report: ReportDefinition` (uses `id` as identifier, not `key`).
 * - `categoryColor` is a signal input so the parent can override per
 *   context (defaults to `--color-primary`).
 * - Adds an optional `type` badge (`summary` | `list` | `nested`) with a
 *   color derived from the report shape, alongside the category badge.
 * - Click navigates to `report.route` (the analytics card does the same).
 *
 * Tooltip shows `detailedDescription` (or `description` as fallback) on
 * hover, mirroring the analytics-card interaction.
 */
@Component({
  selector: 'app-report-catalog-card',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './report-catalog-card.component.html',
  styleUrls: ['./report-catalog-card.component.scss'],
})
export class ReportCatalogCardComponent {
  readonly report = input.required<ReportDefinition>();
  readonly categoryColor = input<string>('var(--color-primary)');

  private readonly router = inject(Router);

  readonly showTooltip = signal(false);

  onClick(): void {
    this.router.navigateByUrl(this.report().route);
  }

  /**
   * Resolve the color token for the secondary `type` badge. Falls back
   * to the accent color when the type is unknown or missing.
   */
  typeBadgeColor(type: ReportType | undefined): string {
    switch (type) {
      case 'summary':
        return 'var(--color-info)';
      case 'list':
        return 'var(--color-primary)';
      case 'nested':
        return 'var(--color-warning)';
      default:
        return this.categoryColor();
    }
  }

  typeBadgeLabel(type: ReportType | undefined): string {
    switch (type) {
      case 'summary':
        return 'Resumen';
      case 'list':
        return 'Detalle';
      case 'nested':
        return 'Agrupado';
      default:
        return '';
    }
  }

  hasTypeBadge(type: ReportType | undefined): boolean {
    return type !== undefined;
  }
}
