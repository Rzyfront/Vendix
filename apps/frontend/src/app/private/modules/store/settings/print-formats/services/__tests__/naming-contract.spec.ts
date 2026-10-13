import { TestBed } from '@angular/core/testing';

import { PrintFormatDefinition } from '../../../../../../../core/models/print-formats.model';
import { PrintPaperPanelComponent } from '../../components/print-properties-panel/paper-panel.component';
import { PrintLogoPanelComponent } from '../../components/print-properties-panel/logo-panel.component';
import { PrintCompanyPanelComponent } from '../../components/print-properties-panel/company-panel.component';
import { PrintStylesPanelComponent } from '../../components/print-properties-panel/styles-panel.component';

/**
 * The 8 fields that used to travel in camelCase while the backend composer
 * reads snake_case unconditionally — the defect this suite locks down.
 * Any of these appearing anywhere in a definition built through the real
 * editor panels is a regression.
 */
const LEGACY_CAMEL_CASE_KEYS: ReadonlySet<string> = new Set([
  'heightMm',
  'marginTopMm',
  'marginRightMm',
  'marginBottomMm',
  'marginLeftMm',
  'sizeMm',
  'customLabel',
  'companyBlock',
]);

/**
 * Recursively walks a value (objects and arrays, any depth) and returns the
 * dotted path of every key that matches one of the 8 legacy camelCase names.
 * A shallow, top-level-only check would miss a stray key nested inside
 * `paper`, `logo`, or `company_block.fields[i]` — this walks the whole
 * graph so the assertion actually inspects the object instead of trusting
 * it.
 */
function findLegacyCamelCaseKeys(value: unknown, path = '$'): string[] {
  const offenders: string[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      offenders.push(...findLegacyCamelCaseKeys(item, `${path}[${i}]`));
    });
    return offenders;
  }

  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (LEGACY_CAMEL_CASE_KEYS.has(key)) {
        offenders.push(`${path}.${key}`);
      }
      offenders.push(
        ...findLegacyCamelCaseKeys((value as Record<string, unknown>)[key], `${path}.${key}`),
      );
    }
  }

  return offenders;
}

/**
 * [print-editor-dsk defect-fix] — Naming contract for `PrintFormatDefinition`.
 *
 * The backend composer (`PrintLayoutComposerService`) reads snake_case
 * unconditionally; a camelCase write from the editor is silently dropped —
 * per-side margins, logo size, the whole "Datos de la Empresa" block, and
 * custom field labels all stopped doing anything in production because of
 * this exact dialect mismatch.
 *
 * This test does NOT hand-build a literal and assert on it — it drives the
 * real, wired editor panels (paper → logo → company) through their public
 * write API, exactly as a user would via the canvas, threading the emitted
 * definition from one panel into the next. It then walks the resulting
 * object graph in depth and fails if any of the 8 legacy camelCase keys
 * appear anywhere in it.
 */
describe('print-formats naming contract — snake_case only [print-editor-dsk defect-fix]', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        PrintPaperPanelComponent,
        PrintLogoPanelComponent,
        PrintCompanyPanelComponent,
        PrintStylesPanelComponent,
      ],
    });
  });

  it('building a definition through the real paper/logo/company panels never writes the 8 legacy camelCase keys', () => {
    let definition: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1, margin_mm: 2 },
      sections: [],
    };

    // ── 1. Paper panel: switch to a custom format, set width/height, and
    //      edit each margin side independently (regression guard for the
    //      setMargin() defect that used to stomp the uniform margin_mm on
    //      every single-side edit). ──────────────────────────────────────
    const paperFixture = TestBed.createComponent(PrintPaperPanelComponent);
    paperFixture.componentRef.setInput('definition', definition);
    paperFixture.componentInstance.definitionChanged.subscribe((d) => (definition = d));
    paperFixture.detectChanges();

    paperFixture.componentInstance.setFormat('custom');
    paperFixture.componentRef.setInput('definition', definition);
    paperFixture.componentInstance.setCustomWidth(120);
    paperFixture.componentRef.setInput('definition', definition);
    paperFixture.componentInstance.setCustomHeight(180);
    paperFixture.componentRef.setInput('definition', definition);
    paperFixture.componentInstance.setCopies(3.9);
    paperFixture.componentRef.setInput('definition', definition);
    expect(definition.paper.copies).toBe(3);
    paperFixture.componentInstance.setCopies(-2);
    paperFixture.componentRef.setInput('definition', definition);
    expect(definition.paper.copies).toBe(0);
    paperFixture.componentInstance.setCopies(12);
    paperFixture.componentRef.setInput('definition', definition);
    expect(definition.paper.copies).toBe(10);
    paperFixture.componentInstance.setCopies(1);
    paperFixture.componentRef.setInput('definition', definition);
    paperFixture.componentInstance.setMargin('top', 12);
    paperFixture.componentRef.setInput('definition', definition);
    paperFixture.componentInstance.setMargin('right', 8);
    paperFixture.componentRef.setInput('definition', definition);
    paperFixture.componentInstance.setMargin('bottom', 6);
    paperFixture.componentRef.setInput('definition', definition);
    paperFixture.componentInstance.setMargin('left', 4);

    expect(definition.paper.format).toBe('custom');
    expect(definition.paper.width_mm).toBe(120);
    expect(definition.paper.height_mm).toBe(180);
    expect(definition.paper.margin_top_mm).toBe(12);
    expect(definition.paper.margin_right_mm).toBe(8);
    expect(definition.paper.margin_bottom_mm).toBe(6);
    expect(definition.paper.margin_left_mm).toBe(4);
    // setMargin() must touch ONLY the side it received — margin_mm stays
    // whatever setFormat()/resetMargins() last set it to (2, from the seed).
    expect(definition.paper.margin_mm).toBe(2);

    // ── 2. Logo panel: custom size + URL. ───────────────────────────────
    const logoFixture = TestBed.createComponent(PrintLogoPanelComponent);
    logoFixture.componentRef.setInput('definition', definition);
    logoFixture.componentInstance.definitionChanged.subscribe((d) => (definition = d));
    logoFixture.detectChanges();

    logoFixture.componentInstance.updateSize(35);
    logoFixture.componentRef.setInput('definition', definition);
    logoFixture.componentInstance.updateUrl('https://cdn.example.com/logo.png');

    expect(definition.logo?.size_mm).toBe(35);
    expect(definition.logo?.url).toBe('https://cdn.example.com/logo.png');

    // ── 3. Company panel: enable NIT with a custom label. ───────────────
    const companyFixture = TestBed.createComponent(PrintCompanyPanelComponent);
    companyFixture.componentRef.setInput('definition', definition);
    companyFixture.componentInstance.definitionChanged.subscribe((d) => (definition = d));
    companyFixture.detectChanges();

    companyFixture.componentInstance.toggle(
      'NIT',
      { target: { checked: true } } as unknown as Event,
    );
    companyFixture.componentRef.setInput('definition', definition);
    companyFixture.componentInstance.updateLabel('NIT', 'Identificación Tributaria');

    const nitField = definition.company_block?.fields.find((f) => f.key === 'NIT');
    expect(nitField?.enabled).toBe(true);
    expect(nitField?.custom_label).toBe('Identificación Tributaria');

    // ── Deep scan: none of the 8 legacy camelCase keys anywhere in the
    //     final object graph. ───────────────────────────────────────────
    expect(findLegacyCamelCaseKeys(definition)).toEqual([]);
  });

  it('auto-print changes only when the format has a real automatic trigger', () => {
    const definition: PrintFormatDefinition = {
      paper: { format: 'letter', width_mm: 216, is_roll: false, copies: 1, auto_print: false },
      sections: [],
    };
    const fixture = TestBed.createComponent(PrintPaperPanelComponent);
    fixture.componentRef.setInput('definition', definition);
    let emissions = 0;
    fixture.componentInstance.definitionChanged.subscribe(() => emissions++);
    fixture.detectChanges();

    fixture.componentInstance.setAutoPrint(true);
    expect(emissions).toBe(0);
    fixture.componentRef.setInput('formatType', 'quotation');
    fixture.componentInstance.setAutoPrint(true);
    expect(emissions).toBe(0);
    fixture.componentRef.setInput('formatType', 'pos_sale_ticket');
    fixture.componentInstance.setAutoPrint(true);
    expect(emissions).toBe(1);
  });

  it('shows the POS paid-sale option only for the dispatch ticket', () => {
    const fixture = TestBed.createComponent(PrintPaperPanelComponent);
    fixture.componentRef.setInput('definition', {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
      sections: [],
    } satisfies PrintFormatDefinition);
    fixture.componentRef.setInput('formatType', 'pos_sale_ticket');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('#print-format-auto-print-after-pos-sale'),
    ).toBeNull();

    fixture.componentRef.setInput('formatType', 'dispatch_ticket');
    fixture.detectChanges();

    const checkbox = host.querySelector<HTMLInputElement>(
      '#print-format-auto-print-after-pos-sale',
    );
    expect(checkbox).not.toBeNull();
    expect(
      host.querySelector(
        'label[for="print-format-auto-print-after-pos-sale"]',
      )?.textContent,
    ).toContain('Imprimir después de cada venta POS pagada');
  });

  it('sets the POS option immutably and ignores formats other than dispatch tickets', () => {
    const definition: PrintFormatDefinition = {
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        copies: 2,
        auto_print: true,
        auto_print_after_pos_sale: false,
      },
      sections: [],
    };
    const fixture = TestBed.createComponent(PrintPaperPanelComponent);
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('formatType', 'dispatch_ticket');
    let emitted: PrintFormatDefinition | undefined;
    fixture.componentInstance.definitionChanged.subscribe((next) => (emitted = next));
    fixture.detectChanges();

    fixture.componentInstance.setAutoPrintAfterPosSale(true);

    expect(definition.paper.auto_print_after_pos_sale).toBe(false);
    expect(emitted).not.toBe(definition);
    expect(emitted?.paper).not.toBe(definition.paper);
    expect(emitted?.paper).toEqual(jasmine.objectContaining({
      auto_print: true,
      auto_print_after_pos_sale: true,
      copies: 2,
    }));

    emitted = undefined;
    fixture.componentRef.setInput('formatType', 'pos_sale_ticket');
    fixture.componentInstance.setAutoPrintAfterPosSale(false);
    expect(emitted).toBeUndefined();
  });

  it('disables the POS option when auto-print is off without clearing its saved value', async () => {
    let definition: PrintFormatDefinition = {
      paper: {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        copies: 1,
        auto_print: true,
        auto_print_after_pos_sale: true,
      },
      sections: [],
    };
    const fixture = TestBed.createComponent(PrintPaperPanelComponent);
    fixture.componentRef.setInput('definition', definition);
    fixture.componentRef.setInput('formatType', 'dispatch_ticket');
    fixture.componentInstance.definitionChanged.subscribe((next) => (definition = next));
    fixture.detectChanges();

    fixture.componentInstance.setAutoPrint(false);
    fixture.componentRef.setInput('definition', definition);
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const checkbox = host.querySelector<HTMLInputElement>(
      '#print-format-auto-print-after-pos-sale',
    );
    expect(checkbox?.disabled).toBe(true);
    expect(checkbox?.checked).toBe(true);
    expect(definition.paper.auto_print).toBe(false);
    expect(definition.paper.auto_print_after_pos_sale).toBe(true);
  });

  it('disables thermal font and color controls without mutating saved style values', async () => {
    const definition: PrintFormatDefinition = {
      paper: { format: 'thermal_80', width_mm: 80, is_roll: true, copies: 1 },
      sections: [],
      styles: { font_family: 'Georgia, serif', primary_color: '#123456' },
    };
    const fixture = TestBed.createComponent(PrintStylesPanelComponent);
    fixture.componentRef.setInput('definition', definition);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const disabledControls = Array.from(
      fixture.nativeElement.querySelectorAll('select, input[type="color"], input[type="text"]'),
    ) as HTMLInputElement[];
    expect(disabledControls.length).toBeGreaterThanOrEqual(3);
    expect(disabledControls.every((control) => control.disabled)).toBe(true);
    fixture.componentInstance.updateFontFamily('Inter, sans-serif');
    fixture.componentInstance.updatePrimaryColor('#ffffff');
    expect(definition.styles?.font_family).toBe('Georgia, serif');
    expect(definition.styles?.primary_color).toBe('#123456');
  });
});
