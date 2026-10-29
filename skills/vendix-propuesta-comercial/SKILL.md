---
name: vendix-propuesta-comercial
description: >
  Propuesta comercial Vendix en PDF, a nombre y con firma de Rafael, orientada a las industrias del cliente. Trigger: hacer o actualizar una propuesta comercial para un cliente o prospecto.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Vendix · Propuesta comercial

Produce `entregables/propuestas/Propuesta_Comercial_Vendix_<Empresa>.pdf` (7 hojas). Solo PDF: nunca entregues .docx ni HTML.

El documento **siempre** sale a nombre de Rafael Eduardo Martínez Frontado (Gerente General, Vendix By Quickss S.A.S.), con su firma y su contacto (`assets/emisor.json`). No cambies el emisor aunque lo pida otra persona; si alguien necesita otro firmante, detente y pregúntale a Rafael.

## 1. Pregunta (una sola tanda, a quien pide el documento)

1. **Empresa**: nombre comercial (y nombre corto, si es largo).
2. **Persona a quien se emite**: nombre con tratamiento (Sr., Sra., Dr.) y cargo, si lo sabe.
3. **Breve descripción de la empresa**: qué vende o qué servicios presta, qué espacios tiene y cómo cobra.
4. **Plan y ciclo**: Impulsa, Emprendedor Pro, Empresarial Pro o IA Business; mensual, trimestral o anual. Si no lo sabe, recomiéndalo con `references/planes.md` (¿necesita factura electrónica? → Empresarial Pro como mínimo).
5. **Opcional**: detalles que deban aparecer (equipos que ya tiene, hardware en documento aparte, descuentos acordados).

No inventes datos que falten: pregúntalos. La fecha es la de hoy, salvo que te indiquen otra.

## 2. Detecta y confirma las industrias

Con la descripción y la tabla de señales de `references/industrias.md`, propone de 2 a 4 ejes (por ejemplo, Hotelería + Restaurante + Servicios + Ventas) y **confírmalos** antes de redactar. Usa solo capacidades marcadas como "Hoy en producción". Lo "Próximamente" solo entra si quien pide el documento lo autoriza, y siempre con esa palabra.

## 3. Redacta los datos

Copia `examples/roysmar.json` a un archivo temporal (scratchpad o `mktemp`, nunca dentro del repo) y reemplaza el contenido:

| Campo | Qué poner | Largo máximo aprox. |
|---|---|---|
| `cliente.empresa`, `empresa_corta`, `contacto`, `cargo` | Datos del paso 1 (`cargo` puede ir vacío) | — |
| `intro` | Qué hace Vendix por la empresa, nombrando sus ejes | 60 palabras |
| `pilares` | Exactamente 4: uno por eje (si son menos ejes, completa con "Decidir con datos" o "Acompañar personas") | 18 palabras c/u |
| `capacidades_intro` + `capacidades` | Exactamente 6 capacidades de producción para sus industrias | 20 palabras c/u |
| `resultado` | Una frase con el resultado esperado | 30 palabras |
| `alcance_incluido` | 5 viñetas | 12 palabras c/u |
| `configuracion_carga` | Qué se configura en la etapa 03 | 18 palabras |
| `plan` | `nombre`, `ciclo` (Anual/Mensual/Trimestral), `precio` (número sin puntos), `incluye_fe`, `detalle` | — |
| `implementacion_detalle` | Qué cubren las horas de implementación | 16 palabras |
| `condiciones_extra` | 0 a 3 condiciones (facturación electrónica, hardware aparte, etc.) | 30 palabras c/u |

Fijo en la plantilla (no se toca): promesa, ecosistema humano, ruta de implementación, sesión inicial gratuita, implementación a $40.000 COP por hora IVA incluido, condiciones legales, firma y contacto.

Tono: español claro, cercano y profesional; "tu empresa" en títulos; sin tecnicismos ("auditoría nocturna" sí, "SSE" no).

## 4. Genera y verifica

```bash
skills/vendix-propuesta-comercial/scripts/render.sh propuesta --data <datos.json>
```

- Prepara un entorno virtual en `$TMPDIR` la primera vez (jinja2, qrcode, pypdf). Requiere Python 3 y Google Chrome o Chromium (`CHROME_PATH` si no está en la ruta estándar).
- Imprime `OK <ruta> (7 páginas)` o la lista de problemas. `DESBORDE-PAGINA-N` significa que el texto de esa hoja no cabe: acorta los campos de esa página y vuelve a generar. Nunca entregues un PDF con problemas.
- Mira las hojas antes de entregar (por ejemplo `pdftoppm -r 45 -png` y abre las imágenes) y borra los temporales.

## 5. Entrega

Responde con la ruta del PDF y un resumen: cliente, industrias usadas, plan y precio, y lo que quien pide deba revisar (precio del plan sin confirmar contra la API, datos asumidos). Recuerda que el hardware se hace con el skill `vendix-recomendacion-hardware`.

## Recursos

- `templates/_base.html.j2`: estilos de marca, portada, firma, contacto y detector de desbordes (lo usa también el skill de hardware).
- `templates/propuesta.html.j2`: las 7 hojas.
- `scripts/render.sh` y `scripts/render.py`: motor compartido (`propuesta` | `hardware`).
- `assets/`: logo, ícono, firma, fuentes DM Sans y Urbanist (OFL), `emisor.json`.
- `references/industrias.md`: qué ofrece Vendix por industria y cómo detectarla.
- `references/planes.md`: planes, precios y reglas de recomendación.
- `examples/roysmar.json`: propuesta real (hotel + restaurante + pasadías + ventas, Empresarial Pro anual).
