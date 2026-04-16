import { ChangeDetectionStrategy, Component, output } from '@angular/core';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent, TooltipComponent } from '../../../../../../shared/components';

@Component({
  selector: 'app-quick-actions-panel',
  standalone: true,
  imports: [CardComponent, IconComponent, TooltipComponent],
  templateUrl: './quick-actions-panel.component.html',
  styleUrls: ['./quick-actions-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuickActionsPanelComponent {
  walkIn = output<void>();
  blockSchedule = output<void>();
  exportReport = output<void>();
}
