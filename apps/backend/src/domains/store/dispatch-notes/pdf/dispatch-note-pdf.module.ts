import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { S3Module } from '../../../../common/services/s3.module';
import { DispatchNotePdfService } from './dispatch-note-pdf.service';

/**
 * ADR-15 §4 — módulo HOJA que publica `DispatchNotePdfService`.
 *
 * POR QUÉ EXISTE, Y POR QUÉ NO ALCANZABA `forwardRef`
 *
 * `PrintFormatsModule` necesita `DispatchNotePdfService` para que
 * `DispatchNotePdfRenderer` produzca el PDF de la remisión. La primera
 * versión lo resolvió importando `DispatchNotesModule` entero con
 * `forwardRef` en los dos lados. Compila, pasa los tests unitarios — y el
 * backend NO ARRANCA:
 *
 *   ReferenceError: Cannot access 'NotificationsModule' before initialization
 *       at notifications.module.ts:49
 *       at kitchen-fire.module.ts:36
 *       at payments.module.ts:1
 *
 * `forwardRef` resuelve el ciclo de INYECCIÓN de Nest, que es una cuestión de
 * tiempo de ejecución. No resuelve el ciclo de `require` de CommonJS, que es
 * de tiempo de carga: la sentencia `import` de arriba del archivo se evalúa
 * igual, y si el grafo se cierra, alguna `class` queda en su zona muerta
 * temporal cuando otro módulo la toca a mitad de evaluación. La arista
 * `PrintFormatsModule → DispatchNotesModule` cerraba el grafo contra
 * `NotificationsModule` por la cadena
 * `DispatchNotesModule → OrderFlowModule → KitchenFireModule →
 * NotificationsModule`, y `KitchenFireModule` importa `NotificationsModule`
 * directo, sin `forwardRef`. Medido: con la arista, 4 ocurrencias del
 * ReferenceError y el proceso muere; sin ella, cero.
 *
 * La salida no es apilar más `forwardRef` —eso sólo mueve el ciclo de sitio—
 * sino no cerrar el grafo. `DispatchNotePdfService` sólo depende de
 * `StorePrismaService` y `S3Service`, así que este módulo es una hoja de
 * verdad: no importa nada del dominio y nadie vuelve a él. `PrintFormatsModule`
 * lo importa PLANO, sin `forwardRef`, y `DispatchNotesModule` también, en vez
 * de declarar el proveedor por su cuenta — una sola definición del servicio,
 * un solo sitio donde cambiarla.
 */
@Module({
  imports: [PrismaModule, S3Module],
  providers: [DispatchNotePdfService],
  exports: [DispatchNotePdfService],
})
export class DispatchNotePdfModule {}
