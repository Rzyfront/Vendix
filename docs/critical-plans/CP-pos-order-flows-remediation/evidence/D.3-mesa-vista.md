# Ítem 7 — vista de mesa admite vocabulario ampliado y muestra destino (10 líneas)

1. Tipo: `table.interface.ts:237` ya admite el vocabulario completo —
2. `'before_fire'|'after_fire_reused'|'after_fire_waste'|'delivered_restock'|'delivered_waste'|null`. Sin cambio.
3. Badge (`table-session-page.component.html:436-452`): "Cancelado · merma" si
4. `after_fire_waste`/`delivered_waste`; "· reuso" si `after_fire_reused`/`delivered_restock`;
5. "Cancelado" solo si `before_fire`/null; + línea "Motivo: …" (:454-458). Destino visible. ✓
6. Flujo mesa (`table-session-page.component.ts:1102`, `onRemoveItem`) manda solo `{reason}`;
7. el backend decide el tipo según `inventory_consumed_at_fire`. El service (`tables.service.ts:276-280`)
8. YA acepta `cancellation_type?` con los 3 valores, así que un futuro picker de destino en mesa
9. enchufa sin tocar el service. Divergencia consciente vs order-details (modal con picker): mesa
10. no pide destino al mesero. VEREDICTO: ítem 7 OK — vista y tipo listos, sin edits.
