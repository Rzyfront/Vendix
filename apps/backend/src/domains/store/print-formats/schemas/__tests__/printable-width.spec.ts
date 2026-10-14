import { validatePrintFormatDefinition } from '../ajv-instance';

const def = (format: string, printable: number) => ({
  v: 2,
  paper: { format, is_roll: true, printable_width_mm: printable },
});

describe('AJV invariant — roll printable_width_mm', () => {
  it('thermal_80 with 78 is rejected', () => {
    expect(validatePrintFormatDefinition(def('thermal_80', 78)).valid).toBe(false);
  });
  it('thermal_80 with 64 is accepted', () => {
    expect(validatePrintFormatDefinition(def('thermal_80', 64)).valid).toBe(true);
  });
  it('thermal_58 with 60 is rejected', () => {
    expect(validatePrintFormatDefinition(def('thermal_58', 60)).valid).toBe(false);
  });
  it('thermal_58 with 48 is accepted', () => {
    expect(validatePrintFormatDefinition(def('thermal_58', 48)).valid).toBe(true);
  });
  it('thermal_58 with 70 is rejected by the invariant or the schema', () => {
    expect(validatePrintFormatDefinition(def('thermal_58', 70)).valid).toBe(false);
  });
});
