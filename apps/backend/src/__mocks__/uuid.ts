// Minimal stub for `uuid` used only by the QUI-558 local Jest config.
// Replaces the v4 export with a deterministic string so tests don't
// collide when multiple suites run with the same default Math.random().

export const v4 = (): string => '00000000-0000-4000-8000-000000000000';
export default { v4 };
