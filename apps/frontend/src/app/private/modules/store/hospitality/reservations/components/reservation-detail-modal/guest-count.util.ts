/** "1 adulto" / "2 adultos" and, with children, "· 1 niño" / "· 2 niños". */
export function guestCountLabel(adults: number, children: number): string {
  const adultsLabel = `${adults} ${adults === 1 ? 'adulto' : 'adultos'}`;
  if (children < 1) return adultsLabel;
  return `${adultsLabel} · ${children} ${children === 1 ? 'niño' : 'niños'}`;
}
