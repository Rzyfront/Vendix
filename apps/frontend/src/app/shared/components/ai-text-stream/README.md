# ai-text-stream

Componente inline para renderizar texto streaming con cursor parpadeante. Suscribe a un `Observable<string>` y acumula el texto en un signal.

## Uso

```html
<!-- Suscribir a un observable de streaming -->
<app-ai-text-stream [stream$]="stream$"></app-ai-text-stream>
```

```typescript
// stream$ debe ser un Observable<string> que emite fragmentos de texto
this.stream$ = this.aiService.streamResponse(prompt);
```

## Inputs

| Input     | Tipo                         | Default | Descripcion                              |
| --------- | ---------------------------- | ------- | ---------------------------------------- |
| `stream$` | `Observable<string> \| null` | `null`  | Observable que emite fragmentos de texto |

## Importante

- Usa Angular signals y `effect()` para reaccionar a cambios en `stream$`
- El cursor (blinking) solo aparece mientras `isStreaming()` es `true`
- Cambiar `stream$` a un nuevo observable resetea el texto y re-suscribe automaticamente
- Poner `stream$` en `null` limpia la suscripcion
- Es un componente inline (`display: inline`) — no ocupa espacio de bloque
- El cursor usa `rgba(var(--color-primary-rgb), 0.8)` para adaptarse al tema
