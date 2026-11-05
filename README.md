# El Rincón de la Gymkana

Gymkanas de anatomía y de embriología (Medicina, Universidad de Chile) para estudiar en el navegador, en el computador o en el teléfono.
Cada gymkana es un mazo de Anki con fotos de preparados: la foto con un alfiler (o una flecha o una bandera) y la
misma foto con el nombre de la estructura.

- **Modo Anki**: repetición espaciada como en Anki. Ves la foto, muestras la respuesta y te calificas (Otra vez,
  Difícil, Bien, Fácil). Las nuevas salen al azar, con límite de nuevas y de repasos por día.
- **Modo CA**: como en la gymkana. Cada estación muestra la foto y tú escribes el nombre. La corrección es automática:
  acepta tildes, mayúsculas, abreviaturas («m.», «a.», «n.»), sinónimos entre paréntesis, otro orden de las palabras y
  faltas chicas de ortografía, pero no cambia «interna» por «externa» ni «arteria» por «vena». Igual se puede cambiar
  a mano. Hay tiempo por estación (opcional) y corrección en cada estación o al final.
- Filtros por las etiquetas del mazo: semana, región, fuente de las fotos y nivel (esenciales o extras).
- El avance (repetición espaciada, rondas a medias, historial y las que más fallas) queda en el navegador. «Bajar
  copia» y «Cargar copia» lo pasan a otro dispositivo.

Hecho por Nico Ulriksen.

## Gymkanas
| id | Gymkana | Estaciones |
|---|---|---|
| `anato2-c2` | Anatomía II · Certamen 2 (S4–S8) | 3.317 (1.519 esenciales y 1.798 extras) |
| `histo-c2` | Histología y embriología · Certamen 2, identificar embriones (clases 14–21 sin respiratorio, TP 9 y 10) | ver `gymkanas/indice.json` |

## Embriología (`histo-c2`)
Sale de los mazos de Anki del Certamen 2 de Histología y embriología: las tarjetas de imagen (siglas del atlas de Rojas,
Prieto y Ottone) y las oclusiones de cortes reales (placas EOL del curso y algunas de las clases), una estación por
máscara. Solo cortes, microscopía y fotos; ningún esquema. El `tarjetas.json` lo escribe
`trabajo/…/Certamen 2/Gymkana de embriología/armar_estaciones.py` a partir de los `.apkg`, con el mismo código, versión
y nivel que en Anki (las estaciones de una oclusión llevan el código de la nota y «/N», el número de la máscara). Si un
mazo cambia: correr ese script y después `armar_gymkana.py histo-c2`.

En `gymkanas.json`, `nombre_grupos`, `imagenes`, `marca` y `nota_extras` cambian los textos de la portada de una
gymkana (por defecto, los de anatomía).

## Cómo se agrega o actualiza una gymkana
Las fotos no se suben tal cual: el mazo del Certamen 2 pesa 630 MB y aquí ocupa ~100 MB.
`herramientas/armar_gymkana.py` guarda cada foto base una sola vez. La base es la mediana de las preguntas de esa
foto, que borra los alfileres. De cada tarjeta guarda solo los recortes donde su imagen difiere de la base. La página
pone los recortes encima de la base, en su lugar, y la imagen queda igual a la del mazo. El script comprueba cada
imagen rearmada contra la original.

1. En `herramientas/gymkanas.json`, agrega una entrada con la carpeta de su `tarjetas.json` (de tipo `imagen`, con
   `origen`, `etiquetas`, `codigo`). Agrega también los nombres de las semanas y las regiones.
2. Ejecuta, desde esta carpeta, con un Python que tenga numpy, scipy y Pillow con WebP:
   ```bash
   ~/.claude/skills/video-a-apunte/.venv/bin/python herramientas/armar_gymkana.py <id>
   ```
   Escribe `gymkanas/<id>/datos.json`, `gymkanas/<id>/img/` y la entrada de `gymkanas/indice.json`. Las imágenes se
   nombran por su contenido, así que rearmar sin cambios no cambia ningún archivo.
3. Prueba en local (`python3 -m http.server 8770`) y sube con `git add -A && git commit && git push`.

Si cambias `app.js` o `estilos.css`, sube también el número `?v=` de los dos en `index.html`. GitHub Pages deja que el
navegador guarde esos archivos 10 minutos, y sin el número nuevo alguien puede seguir viendo la versión anterior.

Los niveles salen de `niveles*.json` («Extras»). La versión y la fecha de cada tarjeta salen de `versiones.json`, junto
al `tarjetas.json`. El pie de cada tarjeta lleva su código, como en Anki («T-A2-G2-0001.1»).

## Archivos
- `index.html`, `estilos.css`, `app.js`: la página, sin dependencias.
- `gymkanas/indice.json`: la lista de gymkanas de la portada.
- `gymkanas/<id>/datos.json`: las tarjetas (encabezado, nombre, extra, fuente, etiquetas, versión y recortes).
- `gymkanas/<id>/img/*.webp`: fotos base y recortes.
- `herramientas/`: el generador y la descripción de cada gymkana.
