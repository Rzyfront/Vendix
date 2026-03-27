# app-onboarding-modal

Wizard de configuracion inicial de cuenta. Guide al usuario por los pasos de creacion de organizacion/tienda, con flujo bifurcado segun tipo de negocio.

## Uso

```html
<app-onboarding-modal [(isOpen)]="isOnboardingOpen" (isOpenChange)="onOnboardingChange($event)" (completed)="onOnboardingComplete()"> </app-onboarding-modal>
```

## Inputs

| Input    | Tipo      | Default | Descripcion                 |
| -------- | --------- | ------- | --------------------------- |
| `isOpen` | `boolean` | `false` | Controla apertura del modal |

## Outputs

| Output         | Tipo                    | Descripcion                  |
| -------------- | ----------------------- | ---------------------------- |
| `isOpenChange` | `EventEmitter<boolean>` | Emite false al cerrar        |
| `completed`    | `void`                  | Emite al completar el wizard |

## Flujos de Pasos

### STORE (7 pasos)

1. Bienvenida y seleccion de tipo de negocio
2. Verificacion de email
3. Informacion del usuario + direccion
4. Configuracion de tienda
5. Personalizacion de app (branding, colores)
6. Terminos y condiciones
7. Completado

### ORGANIZATION (8 pasos)

1-3: Igual que STORE
4: Configuracion de organizacion
5: Configuracion de tienda (pre-cargada con datos de organizacion)
6-8: Igual que STORE pasos 5-7

## Importante

- `ChangeDetectionStrategy.OnPush` para rendimiento.
- Cada paso tiene un componente dedicado en `steps/`.
- La navegacion entre pasos se maneja via `OnboardingWizardService`.
- `canProceedFromCurrentStep` valida negocio: paso 1 requiere tipo seleccionado, paso 2 requiere email verificado.
- `completeWizard()` despacha switch de entorno via `EnvironmentSwitchService` y reload.
- Hay "Smart Checks" en cada submit para skippear pasos ya completados si el formulario no fue modificado.
- `handleOnboardingError()` traduce errores de backend a mensajes amigables en espanol.
