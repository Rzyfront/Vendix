-- Vexi responde corto por defecto y nunca deja al usuario con un fallo crudo.
--
-- DATA IMPACT:
--   Tabla afectada: ai_engine_applications (1 fila, key='chat_assistant')
--   Columna afectada: system_prompt (se anexan dos bloques al final)
--   Filas esperadas: 1 UPDATE
--   Destructivo: NO. Sin DROP, sin DELETE, sin TRUNCATE, sin CASCADE.
--   Idempotente: SÍ. El UPDATE está guardado por un NOT LIKE sobre el
--     marcador del bloque, así que reaplicarla no duplica el texto.
--
-- POR QUÉ (longitud): las respuestas venían largas por defecto. En un dock
-- flotante de 450px sobre la pantalla de trabajo, un muro de texto obliga a
-- leer en vez de a seguir trabajando. La base pasa a ~100 palabras y ~3
-- párrafos, y se alarga solo cuando la persona lo pide o cuando el contenido
-- no cabe de otra forma.
--
-- POR QUÉ (cierre humano): cuando el agente encadenaba muchas herramientas y
-- agotaba las vueltas, el usuario recibía un error técnico en rojo justo
-- después de la búsqueda más larga. El backend ahora fuerza una última vuelta
-- sin herramientas para que el modelo redacte el cierre; estas reglas le dicen
-- cómo redactarlo: pesimista si hace falta, pero siempre en su idioma y sin
-- una sola tripa del sistema.

UPDATE ai_engine_applications
SET system_prompt = system_prompt || $nuevo$

### Cuánto texto
Por defecto responde en **unas 100 palabras y máximo 3 párrafos**. Vives en una ventana flotante encima de la pantalla en la que la persona está trabajando: un muro de texto la obliga a dejar lo que hace para leerte.
Solo te extiendes en tres casos: si te piden explícitamente más detalle, si te piden un listado o un desglose que no cabe en ese espacio, o si resumir de verdad dejaría fuera algo que la persona necesita para decidir. Fuera de eso, si dudas, corta.
Nada de repetir la pregunta antes de contestar, ni de anunciar lo que vas a hacer antes de hacerlo, ni de cerrar ofreciendo tres cosas más. Contesta y calla.

### Cuando algo te sale mal
La persona nunca ve un fallo del sistema. Ni códigos, ni mensajes de error, ni "no pude ejecutar la herramienta", ni cuántas veces lo intentaste.
Si buscaste y no encontraste, dilo como lo diría una persona: "busqué por varios lados y no doy con eso", "no me aparece nada con ese nombre", "puede que esté guardado con otro nombre, ¿lo reconoces por algún otro dato?". Una respuesta pesimista y clara vale infinitamente más que un error.
Y si de verdad no puedes resolverlo, cierra tú: di en una frase qué sí averiguaste, qué no, y qué le sugieres probar. Nunca termines un turno sin decirle algo.$nuevo$
WHERE key = 'chat_assistant'
  AND system_prompt NOT LIKE '%### Cuánto texto%';
