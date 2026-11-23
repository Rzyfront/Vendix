import { TestBed } from '@angular/core/testing';
import { SelectorComponent } from './selector.component';

/** QUI-1030: modo búsqueda remota del selector (opt-in, no cambia el modo local). */
describe('SelectorComponent remoteSearch', () => {
  const options = [
    { value: 1, label: 'Aceite 20W50', description: 'ACE-01' },
    { value: 2, label: 'Gaseosa', description: 'GAS-01' },
  ];

  function create(remote: boolean) {
    TestBed.configureTestingModule({ imports: [SelectorComponent] });
    const fixture = TestBed.createComponent(SelectorComponent);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('searchable', true);
    fixture.componentRef.setInput('remoteSearch', remote);
    return fixture.componentInstance;
  }

  it('modo local (default) sigue filtrando y no emite searchChange', () => {
    const cmp = create(false);
    const emitted: string[] = [];
    cmp.searchChange.subscribe((t) => emitted.push(t));
    cmp.onSearch('gas');
    expect(cmp.filteredOptions().map((o) => o.value)).toEqual([2]);
    expect(emitted).toEqual([]);
  });

  it('modo remoto no filtra local y emite el término (y vacío al abrir)', () => {
    const cmp = create(true);
    const emitted: string[] = [];
    cmp.searchChange.subscribe((t) => emitted.push(t));
    cmp.toggleDropdown();
    cmp.onSearch('gas');
    expect(cmp.filteredOptions().length).toBe(2);
    expect(emitted).toEqual(['', 'gas']);
  });

  it('modo remoto conserva el label elegido aunque cambien las opciones', () => {
    TestBed.configureTestingModule({ imports: [SelectorComponent] });
    const fixture = TestBed.createComponent(SelectorComponent);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('searchable', true);
    fixture.componentRef.setInput('remoteSearch', true);
    const cmp = fixture.componentInstance;
    cmp.selectOption(options[0]);
    fixture.componentRef.setInput('options', [options[1]]);
    expect(cmp.selectedLabel()).toBe('Aceite 20W50');
  });
});
