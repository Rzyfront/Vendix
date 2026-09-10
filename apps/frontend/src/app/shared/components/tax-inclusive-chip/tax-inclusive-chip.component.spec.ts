import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TaxInclusiveChipComponent } from './tax-inclusive-chip.component';

describe('TaxInclusiveChipComponent', () => {
  let fixture: ComponentFixture<TaxInclusiveChipComponent>;
  let component: TaxInclusiveChipComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaxInclusiveChipComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TaxInclusiveChipComponent);
    component = fixture.componentInstance;
  });

  it('renders tax name and formatted rate when rate is not in name', () => {
    fixture.componentRef.setInput('name', 'IVA General');
    fixture.componentRef.setInput('rate', 19);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('IVA General');
    expect(compiled.textContent).toContain('19%');
  });

  it('does not repeat rate if already included in tax name', () => {
    fixture.componentRef.setInput('name', 'IVA 19%');
    fixture.componentRef.setInput('rate', 19);
    fixture.detectChanges();

    expect(component.showRate()).toBeFalse();
  });

  it('emits inclusiveChange with true when currently additional and clicked', () => {
    fixture.componentRef.setInput('name', 'IVA 19%');
    fixture.componentRef.setInput('inclusive', false);
    fixture.detectChanges();

    let emitted: boolean | undefined;
    component.inclusiveChange.subscribe((val) => (emitted = val));

    const toggleButton = fixture.debugElement.query(
      By.css('button[aria-pressed]'),
    );
    toggleButton.nativeElement.click();

    expect(emitted).toBeTrue();
  });

  it('emits inclusiveChange with false when currently inclusive and clicked', () => {
    fixture.componentRef.setInput('name', 'IVA 19%');
    fixture.componentRef.setInput('inclusive', true);
    fixture.detectChanges();

    let emitted: boolean | undefined;
    component.inclusiveChange.subscribe((val) => (emitted = val));

    const toggleButton = fixture.debugElement.query(
      By.css('button[aria-pressed]'),
    );
    toggleButton.nativeElement.click();

    expect(emitted).toBeFalse();
  });

  it('emits remove when x button is clicked', () => {
    fixture.componentRef.setInput('name', 'IVA 19%');
    fixture.detectChanges();

    let removed = false;
    component.remove.subscribe(() => (removed = true));

    const removeButton = fixture.debugElement.query(
      By.css('button[aria-label*="Quitar"]'),
    );
    removeButton.nativeElement.click();

    expect(removed).toBeTrue();
  });
});
