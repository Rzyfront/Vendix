# Ejecutar Vendix Mobile con Expo Go

## Instalar dependencias

```bash
cd apps/mobile
npm install
```

## Ejecutar

```bash
npm start
```

- Escanea el QR con **Expo Go** en tu celular
- Listo! Ya conecta al backend de producción (`https://api.vendix.online/api`)

## Cambiar backend (opcional)

Edita `apps/mobile/src/core/api/client.ts`:

```typescript
'https://TU-BACKEND.com/api'  // Línea 9
```

## Comandos útiles

| Comando | Descripción |
|---------|-------------|
| `npm start` | Iniciar servidor dev |
| `npm start -- --tunnel` | Si estás en otra red |
| `npm start -- --lan` | Por LAN |