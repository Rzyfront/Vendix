import { useState, useEffect } from 'react';

/**
 * useDebouncedSearch — hook para inputs de búsqueda con debounce.
 *
 * A diferencia de un useState normal, este hook retorna:
 *  - `value`: el valor actual (lo que el usuario está escribiendo)
 *  - `debouncedValue`: el valor con un retardo de `delay` ms
 *    (útil para evitar filtrar en cada keystroke)
 *
 * Uso típico:
 *   const { value, debouncedValue, setValue, clear } = useDebouncedSearch('', 300);
 *   <TextInput value={value} onChangeText={setValue} />
 *   useEffect(() => { fetch(debouncedValue); }, [debouncedValue]);
 */
export function useDebouncedSearch<T = string>(initial: T = '' as T, delay: number = 300) {
  const [value, setValue] = useState<T>(initial);
  const [debouncedValue, setDebouncedValue] = useState<T>(initial);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  const clear = () => {
    setValue(initial);
    setDebouncedValue(initial);
  };

  return { value, debouncedValue, setValue, clear };
}
