# Conjunto etiquetado de seguimientos (T5, `suggest_followup`)

## Qué es

40 turnos en español (retail, restaurante, servicios, gimnasio): 24 positivos y 16 negativos, con casos difíciles de ambos lados. **Es un fixture sintético escrito a mano. No son datos de producción**: no hubo exportación autorizada para etiquetar, y no contiene nombres reales ni datos personales. Las etiquetas son el criterio del autor según la descripción de la tool (`tools/domains/followup.tools.ts`), sin segundo etiquetador. No afirma representatividad del tráfico real.

## Etiquetas

- `expects_followup`: `true` si Vex debe llamar `suggest_followup` en ese turno.
- `kind`: `reminder` (compromiso con fecha) o `log_entry` (nota/decisión sin fecha), igual que el esquema de la tool.
- `expects_date`: si se espera `remind_at` (informativo, no entra en las metas).
- Negativos: preguntas puras, saludos, acciones ya completadas, hipotéticos, relatos pasados y peticiones explícitas («recuérdame…», «crea un recordatorio…»), que la tool manda a `create_reminder` directo y **no** deben producir ficha (f25, f26).

## Meta del plan

`odd/tasks/vex-agente-avanzado.md:598` y fila T5 (línea 640): «detectar ≥ 85 % de los seguimientos de un conjunto etiquetado de 40 turnos, con ≥ 80 % de sugerencias correctas»; «un turno sin compromiso no muestra ficha».

Definiciones usadas por el script (el plan no las precisa; interpretación de esta ronda):

- **Acierto** = positivos donde se llamó la tool con el `kind` correcto / positivos. Umbral ≥ 85 %.
- **No-falsos-positivos** = negativos donde NO se llamó la tool / negativos. Umbral ≥ 80 %.
- Además se informan precisión (llamadas correctas / todas las llamadas), recall y la matriz de confusión; no deciden el resultado.

## Uso (sin modelo, determinista)

Desde `apps/backend`:

```sh
npx ts-node src/ai-engine/evals/followups/measure-followups.ts \
  --predictions src/ai-engine/evals/followups/predictions.sample.json
```

Sale con 0 si se cumplen ambos umbrales y con 1 si no (nombrando la métrica) o si la entrada es inválida (40 turnos, ids únicos, todos con predicción). Cada predicción: `{"id","called","kind?","has_date?"}`. `predictions.sample.json` es un ejemplo hecho a mano, **no una medición**.

Spec de la función pura: `npx jest --runInBand -c jest.isolated.config.js src/ai-engine/evals/followups/followup-metrics.spec.ts`.

## Modo en vivo

No hay `--live`. El arnés existente (`test/agentic/live-http.adapter.ts`, `npm run eval:agentic -- --mode live --suite …`) corre conversaciones de oro con backend local, BD clonada `e2e` y gasto real, y su formato de caso es otro. Para medir el modelo: ejecutar cada `user_message` (con su `context`) en un backend local de ese arnés, anotar si se llamó `suggest_followup` y con qué `kind`, y volcar el resultado a un archivo de predicciones para este script.

## Estado

El modelo **no ha sido medido** contra este conjunto. Las metas siguen pendientes.
