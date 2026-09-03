import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AccountSelectComponent } from '../../../../../shared/components/account-select/account-select.component';
import type { InheritedAccountHint } from '../../../../../shared/components/account-select/account-select.component';
import { ChartAccountLookupService } from '../../../../../shared/services/chart-account-lookup.service';
import type { ChartAccountScope } from '../../../../../shared/services/chart-account-lookup.service';

/**
 * Espejo de `PUC_ACCOUNT_CODE_REGEX` del backend
 * (`apps/backend/src/domains/store/products/dto/index.ts`): el PUC del Decreto
 * 2650/1993 es estrictamente numérico y mínimo Cuenta (4 dígitos) — apuntar un
 * producto a una Clase o un Grupo no significa nada contablemente.
 */
const PUC_ACCOUNT_CODE_REGEX = /^[0-9]{4,20}$/;

/**
 * Selector de subcuenta PUC cuyo valor hacia afuera es el CÓDIGO (`'413550'`),
 * no el id de la fila.
 *
 * Existe por una asimetría real de contratos: `app-account-select` es un CVA
 * cuyo valor es `chart_of_accounts.id` (así lo consume el formulario de
 * mapeos), pero `products.account_code` y `product_variants.account_code` son
 * `VarChar(20)` y guardan el código. Enchufar el selector directo al control
 * del producto guardaría un id donde el motor contable espera un código: el
 * `AutoEntryService` no casaría nada y el producto caería al ingreso por
 * defecto SIN error visible — el fallo mudo que este campo viene justamente a
 * evitar.
 *
 * Este envoltorio traduce en los dos sentidos:
 *  - al escribir (edición): código → id, vía `resolveByCode`.
 *  - al elegir: id → código, vía `resolveById` (el id recién elegido ya está
 *    en la caché del lookup, así que resuelve sin ida al servidor).
 *
 * Solo ofrece cuentas con `accepts_entries = true`: una cuenta de agrupación no
 * admite asientos, y ofrecerla sería ofrecer un error que aparece meses después
 * al contabilizar la factura.
 */
@Component({
  selector: 'app-account-code-select',
  standalone: true,
  imports: [ReactiveFormsModule, AccountSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AccountCodeSelectComponent),
      multi: true,
    },
  ],
  template: `
    @if (label()) {
      <span class="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">
        {{ label() }}
      </span>
    }

    <app-account-select
      [formControl]="idControl"
      [placeholder]="placeholder()"
      [ariaLabel]="ariaLabel() || label()"
      [acceptsEntriesOnly]="true"
      [scope]="scope()"
      [inherited]="inheritedAccount()"
    />

    @if (inheritedAccount(); as inherited) {
      @if (code()) {
        <!--
          OVERRIDE EXPLÍCITO ⇒ salida de vuelta. Sólo se ofrece cuando hay
          herencia a la que volver: sin default vigente, «volver al sistema»
          sería vaciar el campo y llamarlo sistema.
        -->
        <button
          type="button"
          class="mt-1 text-left text-xs text-[var(--color-text-secondary)] underline underline-offset-2 transition-colors hover:text-[var(--color-primary)]"
          aria-label="Volver al valor del sistema"
          [title]="'Restaura el valor heredado del mapeo contable de la tienda (' + inherited.code + ')'"
          (click)="restoreInherited($event)"
        >
          Volver al valor del sistema
        </button>
      }
    }

    @if (error(); as message) {
      <p class="mt-1 text-xs text-error">{{ message }}</p>
    }

    @if (helperText() && !error()) {
      <p class="mt-1 text-xs text-[var(--color-text-secondary)]">
        {{ helperText() }}
      </p>
    }

    @if (unresolvedCode(); as code) {
      <p class="mt-1 text-xs text-amber-600">
        El código {{ code }} no existe en el plan de cuentas de esta tienda.
        Elija una cuenta válida o deje el campo vacío.
      </p>
    }

    @if (malformedCode(); as code) {
      <p class="mt-1 text-xs text-amber-600">
        El código {{ code }} no tiene forma de subcuenta PUC (solo dígitos, de 4
        a 20). El guardado lo va a rechazar: corrija la cuenta en el plan
        contable o elija otra.
      </p>
    }
  `,
})
export class AccountCodeSelectComponent implements ControlValueAccessor {
  private readonly lookup = inject(ChartAccountLookupService);
  private readonly destroyRef = inject(DestroyRef);

  readonly placeholder = input<string>('Cuenta por defecto de la organización');
  readonly disabled = input<boolean>(false);

  /**
   * Qué controlador responde el lookup del PUC.
   *
   * Por defecto `'store'`, que es como nació y como lo siguen usando los
   * formularios de producto. La consola de plataforma pasa
   * `'super-admin/fiscal'`: allí NO hay tienda, y una lectura con el scope de
   * tienda devolvería vacío —el selector se pintaría sin cuentas y sin decir
   * por qué—.
   *
   * Se propaga a las DOS resoluciones internas además de al selector: si sólo
   * viajara al hijo, `resolveByCode` (hidratación de un código ya guardado) y
   * `resolveById` (traducción de la cuenta elegida a su código) seguirían
   * preguntando por el plan de cuentas equivocado, y el control quedaría
   * mudo justo al releer lo que acaba de guardar.
   */
  readonly scope = input<ChartAccountScope>('store');

  /**
   * Etiqueta visible, y también el nombre accesible del disparador.
   *
   * Opcional para no cambiar nada donde ya se pinta la etiqueta por fuera. La
   * facturación la pasa: allí hay hasta cinco cuentas seguidas en la misma
   * rejilla —los tres componentes del AIU, el costo reembolsable y el IVA por
   * pagar— y sin etiqueta propia son cinco selectores indistinguibles.
   */
  readonly label = input<string>('');

  /**
   * Nombre accesible cuando NO hay etiqueta visible.
   *
   * La rejilla de cuentas por línea de la factura pone el nombre de la línea en
   * la columna de al lado, así que el selector no lleva etiqueta propia: sin
   * esto serían N botones que dicen todos «Cuenta PUC (opcional)». Vacío ⇒ se
   * usa `label()`.
   */
  readonly ariaLabel = input<string>('');

  /**
   * Error del contrato, pintado bajo el selector como en `app-input`.
   *
   * Admite `undefined` además de `null` porque los ayudantes que lo alimentan
   * devuelven lo uno o lo otro según de dónde salgan —`itemError()` de la
   * factura devuelve `string | undefined`, `issueFor()` del editor de perfiles
   * devuelve `string | null`—, y estrechar el tipo aquí sólo obligaría a cada
   * llamador a normalizar lo mismo.
   */
  readonly error = input<string | null | undefined>(null);

  /** Ayuda breve. Se calla cuando hay error: el error es lo urgente. */
  readonly helperText = input<string>('');

  /**
   * El default vigente del sistema para este campo (C.9, híbrido).
   *
   * Mientras el control está vacío, `app-account-select` pinta este código con
   * marca «heredado». ESCRIBIRLO JAMÁS: la precarga vive fuera del control, así
   * que guardar sin tocar sigue produciendo `null` — el perfil o la factura
   * siguen heredando el mapeo de la tienda aunque éste cambie mañana.
   */
  readonly inheritedAccount = input<InheritedAccountHint | null>(null);

  /** Control interno que habla ids: es lo que consume `app-account-select`. */
  readonly idControl = new FormControl<number | null>(null);

  /**
   * Código guardado que no se pudo resolver contra el PUC vigente. Se muestra
   * en vez de silenciarlo: un código huérfano ya está mandando el ingreso a la
   * cuenta por defecto y el comerciante tiene que enterarse ahora, no al cerrar
   * el mes.
   */
  readonly unresolvedCode = signal<string | null>(null);

  /**
   * Código con forma que el backend va a rechazar (`PUC_ACCOUNT_CODE_REGEX`:
   * solo dígitos, 4 a 20). Puede pasar si la organización creó una cuenta con
   * puntos o guiones. Se avisa al elegirla y no al guardar, que es cuando el
   * 400 llega sin contexto.
   */
  readonly malformedCode = signal<string | null>(null);

  /**
   * Valor hacia afuera (el código PUC). Protegido y no privado porque la
   * plantilla lo lee para decidir si ofrece «volver al valor del sistema».
   */
  protected readonly code = signal<string | null>(null);
  /** Deshabilitado escrito por el formulario reactivo vía `setDisabledState`. */
  private readonly formDisabled = signal<boolean>(false);
  /**
   * Descarta respuestas de traducciones viejas: si el usuario cambia de cuenta
   * mientras una resolución sigue en vuelo, la vieja no debe pisar la nueva.
   */
  private resolutionToken = 0;

  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    effect(() => {
      const off = this.disabled() || this.formDisabled();
      if (off) {
        this.idControl.disable({ emitEvent: false });
      } else {
        this.idControl.enable({ emitEvent: false });
      }
    });

    this.idControl.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.onAccountPicked(id));
  }

  // ── ControlValueAccessor ──────────────────────────────────────────────
  writeValue(value: string | number | null): void {
    const next = value == null ? null : String(value).trim() || null;
    if (next === this.code()) return;

    this.code.set(next);
    this.unresolvedCode.set(null);
    this.malformedCode.set(
      next && !PUC_ACCOUNT_CODE_REGEX.test(next) ? next : null,
    );
    this.resolutionToken += 1;
    const token = this.resolutionToken;

    if (!next) {
      this.idControl.setValue(null, { emitEvent: false });
      return;
    }

    this.lookup
      // Sin filtrar por `accepts_entries` ni por `is_active`: un código heredado
      // puede apuntar a una cuenta que ya no pasa los filtros del selector, y
      // pintarlo vacío sería peor que pintarlo — un "Guardar" a ciegas lo
      // borraría.
      .resolveByCode(next, {
        scope: this.scope(),
        acceptsEntriesOnly: false,
        activeOnly: false,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((account) => {
        if (token !== this.resolutionToken) return;
        if (account) {
          this.idControl.setValue(account.id, { emitEvent: false });
          return;
        }
        this.idControl.setValue(null, { emitEvent: false });
        this.unresolvedCode.set(next);
      });
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  /**
   * «Volver al valor del sistema»: acción del USUARIO, y por eso sí pasa por
   * `onChange` — es exactamente lo que un override necesita para deshacerse.
   *
   * Se limpia el estado interno ANTES de avisar: tras `onChange(null)` Angular
   * devuelve `writeValue(null)` y su guarda de «ya estoy en ese valor» haría un
   * retorno temprano dejando el selector interno pintando la cuenta vieja.
   */
  restoreInherited(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.resolutionToken += 1;
    this.unresolvedCode.set(null);
    this.malformedCode.set(null);
    this.idControl.setValue(null, { emitEvent: false });
    this.commit(null);
  }

  // ── internos ──────────────────────────────────────────────────────────
  private onAccountPicked(id: number | null): void {
    this.unresolvedCode.set(null);
    this.malformedCode.set(null);
    this.resolutionToken += 1;
    const token = this.resolutionToken;

    if (id == null) {
      this.commit(null);
      return;
    }

    this.lookup
      .resolveById(id, {
        scope: this.scope(),
        acceptsEntriesOnly: false,
        activeOnly: false,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((account) => {
        if (token !== this.resolutionToken) return;
        this.commit(account?.code?.trim() || null);
      });
  }

  private commit(code: string | null): void {
    this.code.set(code);
    this.malformedCode.set(
      code && !PUC_ACCOUNT_CODE_REGEX.test(code) ? code : null,
    );
    this.onChange(code);
    this.onTouched();
  }
}
