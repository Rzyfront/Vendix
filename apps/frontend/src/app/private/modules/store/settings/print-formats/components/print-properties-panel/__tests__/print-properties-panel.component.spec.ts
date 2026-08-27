import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, ViewChild } from '@angular/core';
import {
  CanvasRegion,
  PrintFormatDefinition,
} from '../../../../../../../../core/models/print-formats.model';
import { PrintPropertiesPanelComponent } from '../print-properties-panel.component';
import { PrintPaperPanelComponent } from '../paper-panel.component';
import { PrintSectionPanelComponent } from '../section-panel.component';
import { PrintColumnPanelComponent } from '../column-panel.component';
import { PrintLogoPanelComponent } from '../logo-panel.component';
import { PrintCompanyPanelComponent } from '../company-panel.component';
import { PrintStylesPanelComponent } from '../styles-panel.component';
import { PrintCustomTemplatePanelComponent } from '../custom-template-panel.component';
import { IconComponent } from '../../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P5] — Property panel shell selection logic.
 *
 * The shell is a router: it inspects `selectedRegion().kind` and renders
 * one of the seven subpanels. We assert:
 *  - null / unknown → paper + styles + custom-template (global view)
 *  - section        → section panel
 *  - column         → column panel
 *  - logo           → logo panel
 *  - company-field  → company panel
 *  - header / footer → paper panel (no dedicated subpanel — they fall
 *    through to the global view; the shell header still reflects the
 *    region label).
 */
@Component({
  standalone: true,
  imports: [
    PrintPropertiesPanelComponent,
    IconComponent,
    PrintPaperPanelComponent,
    PrintSectionPanelComponent,
    PrintColumnPanelComponent,
    PrintLogoPanelComponent,
    PrintCompanyPanelComponent,
    PrintStylesPanelComponent,
    PrintCustomTemplatePanelComponent,
  ],
  template: `
    <app-print-properties-panel
      [definition]="definition"
      [selectedRegion]="region"
      (definitionChanged)="onChange($event)"
    ></app-print-properties-panel>
  `,
})
class HostComponent {
  definition: PrintFormatDefinition = {
    paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
    sections: [
      { id: 's1', type: 'header', title: 'Cabecera', enabled: true, order: 0 },
      { id: 'tbl', type: 'items_table', title: 'Items', enabled: true, order: 1 },
    ],
    columns: [
      { id: 'c1', key: 'name', label: 'Producto', enabled: true, width_percent: 60, align: 'left' },
      { id: 'c2', key: 'qty', label: 'Cant', enabled: true, width_percent: 40, align: 'right' },
    ],
  };

  region: CanvasRegion | null = null;
  lastEmitted: PrintFormatDefinition | null = null;

  onChange(def: PrintFormatDefinition): void {
    this.lastEmitted = def;
  }

  @ViewChild(PrintPropertiesPanelComponent) panel!: PrintPropertiesPanelComponent;
}

describe('PrintPropertiesPanelComponent — selection logic [print-editor-dsk P5]', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('null selection → renders the global paper + styles + custom-template subpanels', () => {
    host.region = null;
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-print-properties-panel');
    expect(panel).toBeTruthy();
    expect(panel.querySelector('app-print-paper-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-styles-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-custom-template-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-section-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-column-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-logo-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-company-panel')).toBeFalsy();
  });

  it('section region → renders only the section panel', () => {
    host.region = {
      id: 'sec-s1', kind: 'section', anchorId: 's1', label: 'Cabecera',
      x_mm: 0, y_mm: 0, width_mm: 80, height_mm: 30, zIndex: 1,
    };
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-print-properties-panel');
    expect(panel.querySelector('app-print-section-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-column-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-logo-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-company-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-paper-panel')).toBeFalsy();
  });

  it('column region → renders only the column panel', () => {
    host.region = {
      id: 'col-c1', kind: 'column', anchorId: 'c1', label: 'Producto',
      x_mm: 0, y_mm: 0, width_mm: 60, height_mm: 30, zIndex: 2, parentId: 'sec-tbl',
    };
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-print-properties-panel');
    expect(panel.querySelector('app-print-column-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-section-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-logo-panel')).toBeFalsy();
  });

  it('logo region → renders only the logo panel', () => {
    host.region = {
      id: 'logo', kind: 'logo', anchorId: 'logo', label: 'Logo',
      x_mm: 0, y_mm: 0, width_mm: 20, height_mm: 20, zIndex: 4,
    };
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-print-properties-panel');
    expect(panel.querySelector('app-print-logo-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-section-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-column-panel')).toBeFalsy();
  });

  it('company-field region → renders only the company panel', () => {
    host.region = {
      id: 'cf-NIT', kind: 'company-field', anchorId: 'NIT', label: 'NIT',
      x_mm: 0, y_mm: 0, width_mm: 30, height_mm: 6, zIndex: 5,
    };
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-print-properties-panel');
    expect(panel.querySelector('app-print-company-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-section-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-column-panel')).toBeFalsy();
    expect(panel.querySelector('app-print-logo-panel')).toBeFalsy();
  });

  it('header / footer regions fall through to the global view (no dedicated panel)', () => {
    host.region = {
      id: 'hdr', kind: 'header', anchorId: 'hdr', label: 'Encabezado',
      x_mm: 0, y_mm: 0, width_mm: 80, height_mm: 12, zIndex: 0,
    };
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-print-properties-panel');
    expect(panel.querySelector('app-print-paper-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-styles-panel')).toBeTruthy();
    expect(panel.querySelector('app-print-custom-template-panel')).toBeTruthy();
  });
});