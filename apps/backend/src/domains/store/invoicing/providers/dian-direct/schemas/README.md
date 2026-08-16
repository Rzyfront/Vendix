# XSD oficiales — Caja de Herramientas DIAN

Copia literal, sin editar, de los esquemas que la DIAN publica en:

```
https://www.dian.gov.co/impuestos/factura-electronica/Documents/Caja_de_herramientas_Factura_Electronica_Validacion_Previa.zip
  → Version 1.8/XSD/{common,maindoc}
```

(El espejo de `micrositios.dian.gov.co` responde 502; usar el de `dian.gov.co`.)

## Estos archivos NO se leen en tiempo de ejecución

El `Dockerfile` del backend copia a la imagen final sólo `dist/`, `node_modules/`,
`prisma/` y `package*.json`, y `nest-cli.json` no declara `assets`. Un
`readFileSync(__dirname + '/…xsd')` compilaría, pasaría en desarrollo y lanzaría
`ENOENT` en producción — la misma clase de fallo que ya nos costó un incidente
con la interoperabilidad de `pdfkit` entre `tsc` y `swc`.

Por eso el modelo de contenido se **compila a TypeScript** en tiempo de autoría:

```bash
node scripts/generate-dian-ubl-content-model.js
```

que lee este directorio y regenera

```
../constants/dian-ubl-content-model.ts
```

Ese `.ts` sí viaja a `dist/` como cualquier otro módulo. Los `.xsd` quedan
versionados aquí para que el generador sea reproducible sin volver a bajar el ZIP
de 22 MB, y para poder auditar que la tabla generada corresponde con el esquema
oficial.

## Alcance de lo generado

El generador extrae **el modelo de contenido**: qué hijos admite cada tipo
complejo, en qué orden, y con qué `minOccurs`/`maxOccurs`. No extrae facetas de
tipos simples (patrones, longitudes, rangos) — esas las cubre el validador de
negocio (`FiscalDocumentValidator`) y `dian-money.util.ts`, que además hablan en
español y citan la regla del Anexo Técnico.

## Versión

El ZIP publicado por la DIAN es de la **versión 1.8** (Res. 000012/2021). El
Anexo Técnico vigente es el **1.9** (Res. 000165/2023), pero la DIAN no publicó
XSD nuevos con él: la estructura UBL no cambió entre ambas versiones — cambiaron
reglas de validación, que no viven en el esquema.
