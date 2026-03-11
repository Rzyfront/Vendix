# 📋 Requerimientos por Módulo — Sistema ERP

> Documento de requerimientos funcionales y de flujo para los módulos principales del sistema.  
> Elaborado a partir de la definición conversacional del alcance del proyecto.

---

## 1. Módulo de Facturación Electrónica

### Descripción General
Módulo encargado de emitir facturas electrónicas, notas crédito y notas débito, garantizando el cumplimiento normativo ante la **DIAN** (Dirección de Impuestos y Aduanas Nacionales de Colombia).

---

### Requerimientos Funcionales

| ID | Requerimiento | Prioridad |
|----|---------------|-----------|
| FAC-001 | El sistema debe permitir crear facturas de venta con todos los campos requeridos por la DIAN (NIT, CUFE, resolución de facturación, etc.). | Alta |
| FAC-002 | El sistema debe generar notas crédito y notas débito asociadas a facturas previamente emitidas. | Alta |
| FAC-003 | El sistema debe validar la estructura del documento antes de enviarlo a la DIAN. | Alta |
| FAC-004 | El sistema debe enviar la factura al servicio web de la DIAN y recibir el acuse de recibo (XML firmado). | Alta |
| FAC-005 | El sistema debe enviar la factura al correo electrónico del cliente en formato PDF y XML. | Alta |
| FAC-006 | El sistema debe registrar el estado de cada factura: borrador, validada, enviada, aceptada, rechazada. | Media |
| FAC-007 | El sistema debe permitir la búsqueda y consulta de facturas por rango de fechas, cliente y estado. | Media |
| FAC-008 | El sistema debe manejar el consecutivo de facturación según la resolución vigente. | Alta |
| FAC-009 | El sistema debe alertar cuando la resolución de facturación esté próxima a vencer o al límite del rango autorizado. | Media |

---

### Flujo Principal

```
[1] Creación de factura
        │
        ▼
[2] Ingreso de datos: cliente, productos/servicios, impuestos
        │
        ▼
[3] Validación de estructura (campos obligatorios, formato DIAN)
        │
        ├── Error → [3a] Notificación al usuario, corrección manual
        │
        ▼
[4] Firma electrónica del documento XML
        │
        ▼
[5] Envío al servicio web de la DIAN
        │
        ├── Rechazada → [5a] Registro del error, reintento o corrección
        │
        ▼
[6] Recepción de acuse de recibo (CUFE confirmado)
        │
        ▼
[7] Envío de factura al cliente (PDF + XML)
        │
        ▼
[8] Registro final en el sistema con estado "Aceptada"
```

---

## 2. Módulo de Contabilidad

### Descripción General
Módulo que centraliza toda la información financiera de la organización, gestiona los periodos contables y genera reportes financieros clave como el **estado de resultados**, balance general y libro mayor.

---

### Requerimientos Funcionales

| ID | Requerimiento | Prioridad |
|----|---------------|-----------|
| CON-001 | El sistema debe mantener un plan de cuentas configurable según el PUC (Plan Único de Cuentas) colombiano. | Alta |
| CON-002 | El sistema debe registrar asientos contables automáticos a partir de las transacciones de otros módulos (facturación, nómina, inventario). | Alta |
| CON-003 | El sistema debe permitir el registro manual de asientos contables. | Alta |
| CON-004 | El sistema debe gestionar periodos contables (apertura, cierre y bloqueo de periodos). | Alta |
| CON-005 | El sistema debe generar el Estado de Resultados en tiempo real o por periodo seleccionado. | Alta |
| CON-006 | El sistema debe generar el Balance General por periodo contable. | Alta |
| CON-007 | El sistema debe generar el Libro Mayor y Libro Diario exportables en formatos PDF y Excel. | Media |
| CON-008 | El sistema debe controlar que no se registren movimientos en periodos ya cerrados. | Alta |
| CON-009 | El sistema debe generar conciliaciones bancarias. | Media |
| CON-010 | El sistema debe permitir la parametrización de centros de costos. | Baja |

---

### Flujo Principal

```
[1] Origen de la transacción (factura, compra, pago de nómina, etc.)
        │
        ▼
[2] Generación automática del asiento contable
        │
        ├── Transacción manual → [2a] Registro manual por el contador
        │
        ▼
[3] Validación del asiento (partida doble, periodo activo)
        │
        ▼
[4] Contabilización en el periodo activo
        │
        ▼
[5] Actualización del Libro Mayor y Libro Diario
        │
        ▼
[6] Consulta y generación de reportes financieros
        │
        ├── Estado de Resultados
        ├── Balance General
        └── Otros informes configurables
        │
        ▼
[7] Cierre de periodo contable (bloqueo de movimientos)
```

---

## 3. Módulo de Inventario

### Descripción General
Módulo que permite controlar las existencias de productos en tiempo real, actualizándose automáticamente con cada operación de **venta o compra**, y gestionando el flujo de entrada y salida del almacén.

---

### Requerimientos Funcionales

| ID | Requerimiento | Prioridad |
|----|---------------|-----------|
| INV-001 | El sistema debe permitir registrar productos con atributos como código, nombre, descripción, unidad de medida, categoría y precio. | Alta |
| INV-002 | El sistema debe actualizar el stock en tiempo real tras cada venta o compra registrada. | Alta |
| INV-003 | El sistema debe gestionar múltiples bodegas o almacenes. | Media |
| INV-004 | El sistema debe registrar movimientos de entrada (compras, devoluciones de cliente) y salida (ventas, devoluciones a proveedor). | Alta |
| INV-005 | El sistema debe emitir alertas cuando el stock de un producto esté por debajo del mínimo configurado. | Alta |
| INV-006 | El sistema debe permitir realizar ajustes de inventario (conteos físicos, mermas, deterioro). | Media |
| INV-007 | El sistema debe generar reportes de rotación de inventario y productos sin movimiento. | Media |
| INV-008 | El sistema debe integrarse con el módulo de facturación para descontar automáticamente las unidades vendidas. | Alta |
| INV-009 | El sistema debe integrarse con el módulo de contabilidad para valorizar el inventario. | Media |
| INV-010 | El sistema debe soportar al menos un método de costeo: PEPS, UEPS o promedio ponderado. | Alta |

---

### Flujo Principal

```
[1] Registro del producto en el catálogo
        │
        ▼
[2] Definición de stock inicial y stock mínimo
        │
        ▼
[3a] ENTRADA — Orden de compra aprobada
        │
        ▼
[4a] Recepción de mercancía en almacén
        │
        ▼
[5a] Actualización del stock (+unidades)
        │
        └──────────────────────────┐
                                   ▼
[3b] SALIDA — Venta / Factura emitida
        │
        ▼
[4b] Despacho de mercancía
        │
        ▼
[5b] Actualización del stock (-unidades)
        │
        ▼
[6] Verificación de stock mínimo
        │
        ├── Stock bajo → [6a] Alerta de reabastecimiento
        │
        ▼
[7] Registro del movimiento en el historial de inventario
        │
        ▼
[8] Sincronización con Contabilidad (valorización del movimiento)
```

---

## 4. Módulo de Nómina Electrónica

### Descripción General
Módulo que gestiona el pago de salarios, prestaciones sociales y deducciones, emitiendo recibos de sueldo y cumpliendo con los requerimientos de la **DIAN para nómina electrónica** (Documento Soporte de Pago de Nómina Electrónica — DSPNE).

---

### Requerimientos Funcionales

| ID | Requerimiento | Prioridad |
|----|---------------|-----------|
| NOM-001 | El sistema debe registrar empleados con sus datos laborales: salario, cargo, tipo de contrato, fecha de ingreso. | Alta |
| NOM-002 | El sistema debe calcular automáticamente devengados (salario, horas extra, bonificaciones) y deducciones (salud, pensión, retención en la fuente). | Alta |
| NOM-003 | El sistema debe generar el comprobante de pago de nómina (recibo de sueldo) en formato descargable para cada empleado. | Alta |
| NOM-004 | El sistema debe generar el archivo XML del Documento Soporte de Pago de Nómina Electrónica según el estándar DIAN. | Alta |
| NOM-005 | El sistema debe firmar electrónicamente el documento de nómina y enviarlo a la DIAN. | Alta |
| NOM-006 | El sistema debe registrar la respuesta de la DIAN (aceptado / rechazado) y almacenarla. | Alta |
| NOM-007 | El sistema debe gestionar nóminas quincenales y mensuales. | Alta |
| NOM-008 | El sistema debe calcular las provisiones de prestaciones sociales (primas, cesantías, vacaciones). | Media |
| NOM-009 | El sistema debe integrarse con contabilidad para generar los asientos del gasto de nómina. | Media |
| NOM-010 | El sistema debe generar el resumen de pagos a seguridad social (PILA) para su liquidación. | Media |

---

### Flujo Principal

```
[1] Configuración del periodo de nómina (quincena / mes)
        │
        ▼
[2] Cálculo de devengados por empleado
        │  (salario base, horas extra, bonificaciones)
        │
        ▼
[3] Cálculo de deducciones
        │  (salud, pensión, retención en la fuente, embargos)
        │
        ▼
[4] Revisión y aprobación por el área de RRHH/Contabilidad
        │
        ├── Con observaciones → [4a] Ajuste y nuevo cálculo
        │
        ▼
[5] Generación del comprobante de pago (recibo de sueldo)
        │
        ▼
[6] Generación del XML de Nómina Electrónica (DSPNE — DIAN)
        │
        ▼
[7] Firma electrónica del documento
        │
        ▼
[8] Envío a la DIAN
        │
        ├── Rechazado → [8a] Revisión del error, corrección y reenvío
        │
        ▼
[9] Confirmación de aceptación por parte de la DIAN
        │
        ▼
[10] Pago efectivo a empleados (transferencia / dispersión)
        │
        ▼
[11] Registro contable del gasto de nómina
```

---

## 📌 Integraciones entre Módulos

| Módulo Origen | Módulo Destino | Descripción de la Integración |
|---------------|----------------|-------------------------------|
| Facturación | Inventario | Descuento automático de stock al emitir factura de venta |
| Facturación | Contabilidad | Generación de asiento contable por cada factura emitida |
| Inventario | Contabilidad | Valorización de movimientos de entrada/salida |
| Nómina | Contabilidad | Registro del gasto de nómina y provisiones |

---

*Documento generado como base para el análisis y diseño del sistema. Sujeto a revisión y validación con los stakeholders del proyecto.*
