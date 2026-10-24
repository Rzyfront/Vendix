import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ButtonComponent, ButtonVariant } from './button.component';

/**
 * Contrato de clases de `app-button`:
 * - las 5 variantes outline llevan `btn-outline-fill` (hover relleno) además de
 *   su borde y su color de texto de siempre;
 * - la variante `ai` aplica la clase global `vx-ai-button` (Vendix AI Style);
 * - las variantes sólidas y `ghost` no cambiaron.
 *
 * Se prueban las clases del `<button>` interno, que es donde se pinta todo.
 */
describe('ButtonComponent variants', () => {
  let fixture: ComponentFixture<ButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ButtonComponent);
  });

  function classesFor(variant: ButtonVariant): string[] {
    fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    return Array.from(button.classList);
  }

  const outlineCases: Array<[ButtonVariant, string, string]> = [
    ['outline', 'btn-outline-border', 'text-[var(--color-primary)]'],
    [
      'outline-secondary',
      'btn-outline-secondary-border',
      'text-[var(--color-secondary)]',
    ],
    [
      'outline-danger',
      'btn-outline-danger-border',
      'text-[var(--color-destructive)]',
    ],
    [
      'outline-warning',
      'btn-outline-warning-border',
      'text-[var(--color-warning)]',
    ],
    [
      'outline-success',
      'btn-outline-success-border',
      'text-[var(--color-success)]',
    ],
  ];

  for (const [variant, borderClass, textClass] of outlineCases) {
    it(`"${variant}" keeps its border/text classes and adds hover-filled`, () => {
      const classes = classesFor(variant);
      expect(classes).toContain('btn-outline-fill');
      expect(classes).toContain(borderClass);
      expect(classes).toContain(textClass);
      // Reposo transparente: ninguna variante outline trae un bg-* propio.
      expect(classes.some((c) => c.startsWith('bg-'))).toBeFalse();
    });
  }

  it('"ai" applies the global Vendix AI Style button class', () => {
    const classes = classesFor('ai');
    expect(classes).toContain('vx-ai-button');
    expect(classes).toContain('focus:ring-[var(--color-primary)]/50');
    expect(classes).not.toContain('btn-outline-fill');
    expect(classes.some((c) => c.startsWith('bg-['))).toBeFalse();
  });

  it('solid variants are unchanged and never get hover-filled or ai classes', () => {
    const expectations: Array<[ButtonVariant, string[]]> = [
      [
        'primary',
        [
          'bg-[var(--color-primary)]',
          'text-[var(--color-text-on-primary)]',
          'btn-shadow-primary',
        ],
      ],
      [
        'secondary',
        ['bg-[var(--color-secondary)]', 'btn-shadow-secondary'],
      ],
      ['danger', ['bg-[var(--color-destructive)]', 'btn-shadow-danger']],
      ['success', ['bg-[var(--color-success)]', 'btn-shadow-success']],
      [
        'ghost',
        [
          'text-[var(--color-text-primary)]',
          'hover:bg-[var(--color-background)]',
        ],
      ],
    ];

    for (const [variant, expected] of expectations) {
      const classes = classesFor(variant);
      for (const cls of expected) {
        expect(classes).withContext(`${variant} -> ${cls}`).toContain(cls);
      }
      expect(classes).withContext(variant).not.toContain('btn-outline-fill');
      expect(classes).withContext(variant).not.toContain('vx-ai-button');
    }
  });

  it('keeps the shared focus ring and disabled styling for every variant', () => {
    const all: ButtonVariant[] = [
      'primary',
      'secondary',
      'outline',
      'outline-secondary',
      'outline-danger',
      'outline-warning',
      'outline-success',
      'ghost',
      'danger',
      'success',
      'ai',
    ];
    for (const variant of all) {
      const classes = classesFor(variant);
      expect(classes).withContext(variant).toContain('focus:ring-2');
      expect(classes).withContext(variant).toContain('disabled:opacity-40');
      expect(classes).withContext(variant).toContain('active:scale-[0.97]');
    }
  });

  it('appends customClasses after the variant classes', () => {
    fixture.componentRef.setInput('customClasses', 'w-10 bg-surface');
    const classes = classesFor('outline');
    expect(classes).toContain('bg-surface');
    expect(classes).toContain('btn-outline-fill');
  });
});
