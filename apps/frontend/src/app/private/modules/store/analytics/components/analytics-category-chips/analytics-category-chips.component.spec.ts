import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsCategoryChipsComponent } from './analytics-category-chips.component';
import { ANALYTICS_CATEGORIES, AnalyticsCategoryId } from '../../config/analytics-registry';

describe('AnalyticsCategoryChipsComponent', () => {
  let fixture: ComponentFixture<AnalyticsCategoryChipsComponent>;
  let component: AnalyticsCategoryChipsComponent;
  let emitSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(AnalyticsCategoryChipsComponent);
    component = fixture.componentInstance;
    emitSpy = spyOn(component.categoryChange, 'emit');
    fixture.componentRef.setInput('categories', ANALYTICS_CATEGORIES);
    fixture.detectChanges();
  });

  it('renders one chip per category', () => {
    const chips = component.chips();
    expect(chips.length).toBe(ANALYTICS_CATEGORIES.length);
  });

  it('marks the selected category as isSelected=true', () => {
    fixture.componentRef.setInput('selectedCategory', 'sales');
    fixture.detectChanges();
    const selected = component.chips().filter((c) => c.isSelected);
    expect(selected.length).toBe(1);
    expect(selected[0].id).toBe('sales');
  });

  it('emits a new category when a non-selected chip is clicked', () => {
    component.onChipClick('inventory');
    expect(emitSpy).toHaveBeenCalledOnceWith('inventory');
  });

  it('emits null when the already-selected chip is clicked (toggle off)', () => {
    fixture.componentRef.setInput('selectedCategory', 'sales');
    fixture.detectChanges();
    component.onChipClick('sales');
    expect(emitSpy).toHaveBeenCalledOnceWith(null);
  });

  it('returns the correct chip variant for selection state', () => {
    expect(component.getChipVariant(true)).toBe('primary');
    expect(component.getChipVariant(false)).toBe('outline');
  });

  it('trackBy returns the category id', () => {
    const chip = { ...ANALYTICS_CATEGORIES[0], isSelected: true };
    expect(component.trackByCategoryId(0, chip)).toBe(ANALYTICS_CATEGORIES[0].id);
  });
});
