# Facade Contract — `toSignal()` con `initialValue`

## Regla obligatoria

Todo `toSignal()` en una facade **debe** declarar `initialValue`.

```typescript
// ✅ CORRECTO — con initialValue
readonly isLoading = toSignal(this.isLoading$, { initialValue: false });
readonly user = toSignal(this.user$, { initialValue: null as User | null });
readonly roles = toSignal(this.roles$, { initialValue: [] as string[] });

// ❌ INCORRECTO — sin initialValue
readonly isLoading = toSignal(this.isLoading$);
readonly user = toSignal(this.user$);
```

## Por qué es obligatorio

`toSignal(obs$)` sin `initialValue` devuelve `undefined` hasta que el observable
emita por primera vez. Si lees `facade.data()` síncronamente en `ngOnInit` o
constructor, verás `undefined` si el HTTP aún no resolvió — race condition silenciosa.

Ver: `vendix-zoneless-signals` SKILL §12.

## How-to fix

```typescript
// Booleanos → initialValue: false
readonly isLoading = toSignal(this.isLoading$, { initialValue: false });

// Objetos → initialValue: null
readonly config = toSignal(this.config$, { initialValue: null as Config | null });

// Listas → initialValue: []
readonly items = toSignal(this.items$, { initialValue: [] as Item[] });
```

## Excepciones

Solo si está **justificado documentado** y aprobado por el equipo de arquitectura.