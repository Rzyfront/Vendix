import { TestBed } from '@angular/core/testing';

import { MmToPxService } from '../mm-to-px.service';

describe('MmToPxService [print-editor-dsk P2.3]', () => {
  let service: MmToPxService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MmToPxService);
  });

  it('mmToPx(80) converts 80mm to ~302.36px at 96dpi', () => {
    expect(service.mmToPx(80)).toBeCloseTo(302.36, 1);
  });

  it('mmToPx(58) returns ~219.21px for thermal_58 (NOT clamped)', () => {
    expect(service.mmToPx(58)).toBeCloseTo(219.21, 1);
  });

  it('paperToContainerPx for thermal_80 roll: width_px=302.36, height_px=null', () => {
    const box = service.paperToContainerPx({ width_mm: 80, is_roll: true });
    expect(box.width_px).toBeCloseTo(302.36, 1);
    expect(box.height_px).toBeNull();
    expect(box.css_width).toBe('80mm');
    expect(box.css_height).toBe('auto');
  });

  it('paperToContainerPx for A4 sheet returns ~793.7px width', () => {
    const box = service.paperToContainerPx({ width_mm: 210, is_roll: false });
    expect(box.width_px).toBeCloseTo(793.7, 1);
    expect(box.css_width).toBe('210mm');
  });

  it('paperToContainerPx for 80mm sheet returns width_px=302.36 (no min clamp, sheet stays small)', () => {
    const box = service.paperToContainerPx({ width_mm: 80, is_roll: false });
    expect(box.width_px).toBeCloseTo(302.36, 1);
    expect(box.height_px).not.toBeNull();
  });
});