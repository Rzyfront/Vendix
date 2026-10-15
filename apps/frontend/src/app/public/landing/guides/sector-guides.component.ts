import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-sector-guides',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './sector-guides.component.html',
  styleUrl: './sector-guides.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectorGuidesComponent {}
