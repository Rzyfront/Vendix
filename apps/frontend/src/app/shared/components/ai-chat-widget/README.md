# ai-chat-widget

Widget flotante de chat AI con conversaciones, streaming y panel lateral. Integra con `AIChatFacade` del store NgRx.

## Uso

```html
<!-- Solo colocar en el layout raiz — no recibe inputs -->
<app-ai-chat-widget></app-ai-chat-widget>
```

```typescript
// El widget se integra automaticamente con AIChatFacade
// No requiere configuracion adicional
```

## Importante

- Es un componente de posicion fija (`position: fixed`, `bottom: 20px`, `right: 20px`)
- No tiene inputs — toda la logica es via `AIChatFacade` (store NgRx)
- Usa `AIChatFacade.conversations$`, `messages$`, `streamingContent$`, `isStreaming$`, `isSending$`
- `newConversation()` y `sendMessage()` delegan al facade
- El sidebar muestra lista de conversaciones y permite seleccionar
- Streaming: el texto se muestra incrementalmente con cursor parpadeante
- Loading: puntos animados mientras espera respuesta
- Responsive: en mobile (`< 480px`) el panel ocupa `calc(100vw - 32px)`
- Requiere `FormsModule` para `[(ngModel)]` del input de mensaje
- Solo recibe `OnInit`/`OnDestroy` lifecycle — NO usa signals para inputs
