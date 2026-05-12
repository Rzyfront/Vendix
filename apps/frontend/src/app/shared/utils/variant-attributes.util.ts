export interface VariantAttribute {
  name: string;
  value: string;
}

export function parseVariantAttributes(raw: unknown): VariantAttribute[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((a: any) => ({
        name: String(a?.attribute_name ?? a?.name ?? '').trim(),
        value: String(a?.attribute_value ?? a?.value ?? '').trim(),
      }))
      .filter(a => a.name || a.value);
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([name, value]) => ({ name: name.trim(), value: String(value ?? '').trim() }))
      .filter(a => a.name || a.value);
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseVariantAttributes(JSON.parse(trimmed));
    } catch {
      // fall through to plain-string parsing
    }
  }
  return trimmed
    .split(',')
    .map(pair => {
      const idx = pair.indexOf(':');
      if (idx === -1) return { name: '', value: pair.trim() };
      return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() };
    })
    .filter(a => a.name || a.value);
}

export function formatVariantAttributes(raw: unknown, separator = ', '): string {
  return parseVariantAttributes(raw)
    .map(a => (a.name ? `${a.name}: ${a.value}` : a.value))
    .join(separator);
}
