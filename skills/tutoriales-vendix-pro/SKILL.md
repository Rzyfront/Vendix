---
name: tutoriales-vendix-pro
description: >
  Edita una grabación de pantalla de Vendix y la entrega como tutorial con el formato oficial de marca.
  Trigger: alguien sube o enlaza un video de Vendix para editar o convertir en tutorial.
metadata:
  author: rzyfront
  version: "1.0"
---

# Tutoriales Vendix Pro

La persona solo sube la grabación (archivo o enlace de Google Drive). Tú haces todo lo demás y entregas el MP4 final. Todos los tutoriales deben salir **idénticos en estructura**: esta skill reproduce exactamente el formato aprobado (Tutoriales 02 a 07: Caja, Métodos de pago, Producto rápido, Producto completo, Categorías, Marcas). No cambies el diseño salvo que el usuario lo pida explícitamente.

Todo lo necesario está dentro de la skill: `assets/` (música, entrada de marca, logo final, logos, fuente) y `scripts/`. `SK` = carpeta de esta skill.

## Estructura fija del video (en este orden)

1. **Entrada de marca (6 s)** — `assets/intro_vendix.mp4` ("Vendix · Tu Multitienda Digital", con su sonido). Sobre ella entran con motion graphics tres tags: `TUTORIAL NN` (verde), el título corto y `N pasos`, más una línea verde. No hay otra tarjeta de título: **nunca doble entrada**.
2. **Pasos (3 a 6)** — la grabación a pantalla completa (16:9, sin marco), sincronizada con la voz:
   - La voz arranca con el saludo: *"Saludos para todos. El día de hoy les voy a enseñar cómo …"* y sigue en segunda persona ("tú": haz clic, escribe…).
   - **Píldora de pasos** arriba al centro: `Paso X de N` en verde + título del paso + rayitas de progreso.
   - **Contramarca** arriba a la derecha (no tapar el logo del sidebar): ícono en cuadro verde oscuro `#012315` (color del imagotipo oficial) y texto que alterna cada 7 s con deslizamiento entre **Vendix / Tu Multitienda Digital** y **Título / Tutorial · N pasos**. El texto secundario va en verde `#4FC286`.
   - **Focos**: rectángulo verde, etiqueta verde de 1 a 4 palabras y resto oscurecido en verde oscuro. **Zoom** ×1,4–1,8 en elementos pequeños. Uno cada 3–4 s aprox.
   - **Subtítulos**: Plus Jakarta Sans, una línea en caja verde oscura, centrados abajo, palabra que se dice en verde.
   - **Barra de progreso** fina verde en el borde inferior.
3. **Cierre** — fondo verde oscuro con barra verde izquierda, ícono arriba a la derecha, "Así de fácil" y 3 checks verdes que aparecen uno a uno. Sobre esta diapositiva la voz se despide (con subtítulos): *"Así, con estos simples pasos puedes …. Espero que les haya servido mucho y nos vemos en el siguiente video. ¡Adiós!"*
4. **Logo final** — `assets/Vendix Logo Reveal.mp4` a ×1,5.
5. **Música** — `assets/Fondo tutoriales Vendix.mp3` (MD5 `08c77fefdbc1748d278a07a411d38cdf`) en bucle bajo todo el video, baja −12 dB cuando habla la voz, fundido de 1 s al final. Nunca otra música ni música generada.

Especificaciones: 1920×1080, 30 fps, H.264 + AAC. Voz **Erinome** (`google/gemini-3.8-flash-tts`, OpenRouter) a ×1,3, sin pausas > 0,3 s. Pico ≤ −1 dB (`scripts/revisar_niveles.sh`). Duración orientativa 1:30–2:30; si la grabación no da para más, no rellenes: avisa.

## Proceso

Trabaja en una carpeta temporal por tutorial, p. ej. `<scratchpad>/T08_inventario` (`P`). No corras dos renders pesados a la vez.

### 1. Proyecto y grabación
```bash
bash $SK/scripts/nuevo_proyecto.sh $P "<ruta o enlace de Drive>"
```
Descarga (enlaces de Drive compartidos "con cualquier persona con el enlace") y normaliza a `grabacion.mp4` (30 fps, ancho 1960). Si la grabación incluye varios flujos largos, pregunta si se hace un video por flujo.

### 2. Entender la grabación
```bash
python3 $SK/scripts/analizar.py hojas $P 4          # miniaturas con el segundo marcado (grid/hoja_XX.png)
python3 $SK/scripts/analizar.py actividad $P        # qué zona cambia cada 0,5 s (clics, modales, escritura)
python3 $SK/scripts/analizar.py cuadricula $P 12.5,30,41   # cuadros con coordenadas para los focos
```
Mira las hojas y anota: cada acción (segundo de la grabación), tiempos muertos y errores de tipeo a cortar, y datos sensibles visibles (autocompletados con nombres, etc.) para desenfocar.

### 3. Guion
- `$P/vo.txt`: un bloque por paso separado por línea en blanco; frases cortas, una acción por frase, solo lo que se ve en pantalla. El bloque 1 empieza con el saludo fijo.
- `$P/despedida.txt`: la despedida fija con el resumen del tema.
- Ejemplos: `references/vo_ejemplo.txt`, `references/despedida_ejemplo.txt`.

### 4. Voz (cuesta créditos: genérala una vez)
```bash
OPENROUTER_API_KEY=... python3 $SK/scripts/generar_voz.py $P          # todos los pasos + despedida
OPENROUTER_API_KEY=... python3 $SK/scripts/generar_voz.py $P 3 fin    # solo los que cambien
```
En sesiones cloud la key la inyecta el proxy (pide la credencial para `openrouter.ai` si no existe y exporta un valor cualquiera). Gemini TTS solo acepta `response_format: "pcm"`; el script ya lo maneja.

### 5. Configuración `$P/cfg.py`
Copia `references/cfg_ejemplo.py` y adapta:
- `SRC_W, SRC_H` (lo imprime `nuevo_proyecto.sh`), `CY0`/`CX0` para encuadrar la ventana 16:9 (p. ej. `CY0 = SRC_H - (SRC_W*9/16)/2` recorta la barra del navegador).
- `TITULO_SUP = 'TUTORIAL NN'`, `TITULO` (corto, para tags y contramarca), `TITULO_LARGO`, `CIERRE`, `CIERRE_SUB`, `STEP_TITLES` (uno por paso), `CHECKS` (3 frases del cierre).
- `STEPS`: un `dict` por paso con
  - `anchors=[(seg_grabación, seg_salida), …, (seg, 'END')]`: **sincronía** — la acción de la grabación en `seg_grabación` se ve en `seg_salida` dentro del paso. Pon un ancla por cada acción nombrada en la voz, igual o hasta ~0,5 s después de que la voz la diga (nunca antes).
  - `cuts=[(ini, fin), …]`: tramos de la grabación a eliminar (esperas, errores).
  - `foci=[(ini, fin, (x0, y0, x1, y1), 'Etiqueta', zoom|None), …]` en coordenadas de `grabacion.mp4`.

Para saber cuándo dice la voz cada frase:
```bash
python3 $SK/scripts/analizar.py frases $P
```

### 6. Revisar antes de exportar
```bash
cd $P && python3 $SK/scripts/render.py $P x.mp4 3.0,8.5,14.0   # PNG prev_*.png en esos segundos del cuerpo
```
Comprueba que cada foco cae sobre su elemento y en el momento de su frase, que la píldora y la contramarca no tapan nada importante y que no se ven datos sensibles.

### 7. Montaje final
```bash
bash $SK/scripts/montar.sh $P "$P/Tutorial08_Inventario.mp4"
```
Renderiza, añade entrada con tags, logo final, voz, despedida y música, y ejecuta la revisión de niveles (debe decir OK). Envía primero un video al usuario para validarlo antes de hacer tandas.

## Lista de revisión antes de entregar
- [ ] Entrada de marca con tags correctos (número, título, pasos) y sin segunda tarjeta de título
- [ ] Saludo al inicio y despedida sobre "Así de fácil", ambos con subtítulos
- [ ] Cada acción ocurre cuando la voz la nombra (ni antes ni varios segundos después)
- [ ] Píldora "Paso X de N" correcta; contramarca arriba a la derecha alternando
- [ ] Focos sobre el elemento correcto; zoom en elementos pequeños
- [ ] Subtítulos fieles a `vo.txt` ("Vendix", botones y cifras bien escritos)
- [ ] Música de la skill, baja con la voz; pico ≤ −1 dB
- [ ] Logo final a ×1,5; 1920×1080, 30 fps

## Errores ya resueltos (no repetir)
- **Video adelantado a la voz**: acelerar tramos completos desincroniza. Usa `anchors` por acción.
- **Doble entrada**: la tarjeta de título después de la entrada de marca sobra; la entrada con tags ya presenta el video.
- **Contramarca tapando el logo del sidebar**: va arriba a la derecha.
- **Ícono con fondo verde brillante**: el fondo del ícono es verde oscuro `#012315`, como el imagotipo oficial (`assets/imagotipo_horizontal.png`).
- **Música casi inaudible**: la pista ya viene a −21 dB de media; no la bajes más que el ducking de −12 dB.
- **Frase verde del cierre encima de los subtítulos**: con despedida, esa frase no se dibuja.
- **Foco fuera del encuadre** rompía el render: el script lo omite; revisa el encuadre (`CX0`/`CY0`).
- **TTS en `wav`/`mp3` devuelve 400**: solo `pcm`.
- **Pausas > 0,3 s** tras el posprocesado: `generar_voz.py` las recorta.
