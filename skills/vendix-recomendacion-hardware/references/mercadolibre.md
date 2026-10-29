# Leer una publicación de Mercado Libre

`WebFetch` y `curl` reciben 403 en las páginas de producto. Usa el navegador del MCP de Playwright.

1. Limpia el link: quita todo desde `#` (parámetros de rastreo). Para listados `/up/MCOU...?pdp_filters=item_id:MCO123`, conserva `pdp_filters`; el link corto `https://articulo.mercadolibre.com.co/MCO-123` abre la misma publicación y es mejor para el QR.
2. `browser_navigate` al link.
3. `browser_evaluate` con esta función y guarda el resultado:

```js
() => {
  const q = s => document.querySelector(s)?.innerText?.trim();
  const txt = sel => [...document.querySelectorAll(sel)].map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const warranty = [...new Set([...document.querySelectorAll('p, span')].map(e => e.innerText).filter(t => /garant|devoluci/i.test(t) && t.length < 120))];
  return JSON.stringify({
    url: location.href,
    header: q('.ui-pdp-header'),                       // estado, vendidos, título, calificación
    price: q('.ui-pdp-price__second-line'),            // precio actual y % OFF
    original: q('.ui-pdp-price__original-value'),      // precio anterior
    seller: txt('[class*=seller]').filter(t => t.length < 160).slice(0, 2),
    stock: q('.ui-pdp-stock-information'),
    warranty: warranty.slice(0, 4),
    specs: txt('.andes-table tr').slice(0, 80),
    description: q('.ui-pdp-description__content')?.slice(0, 1500),
    image: document.querySelector('.ui-pdp-gallery__figure img')?.src
  });
}
```

4. Si un dato no aparece (garantía, vendedor), escríbelo como advertencia ("La publicación no indica la garantía: confirmarla con el vendedor"). Nunca lo inventes.
5. El MCP deja archivos `.playwright-mcp/page-*.yml` y `console-*.log` en el repo: bórralos al terminar (la carpeta está en `.gitignore`).

Lectura útil de la ficha técnica:
- **Edición del sistema operativo "De prueba"**: Windows sin licencia activada.
- **Con pantalla táctil: No**: el equipo se opera con teclado y mouse.
- **Versión Wi-Fi** en tablets: sin datos móviles, necesita señal en el punto de uso.
- **Accesorios incluidos**: confirma cables (RJ11 para cajón, USB para impresora).
- Pocas ventas del vendedor (menos de 50) o ninguna garantía visible: inclúyelo en "Puntos a tener en cuenta".
