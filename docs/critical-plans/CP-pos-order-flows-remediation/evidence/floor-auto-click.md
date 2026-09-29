# Mesa sin coordenadas clicable después del fix de auto-layout

Se creó en local mesa QA #20 con `pos_x/pos_y = NULL`. En el plano Mesas de `vendix.com`, Playwright hizo **clic normal** (sin `force`) sobre el tile y se abrió «Abrir QA floor auto 20260923» (`floor-auto-click.png`); antes, una mesa sin coordenadas había quedado debajo de `test2` y Playwright reportó pointer interception. No se abrió sesión para #20; el endpoint DELETE la eliminó (HTTP 200), SQL `count(*) WHERE id=20 = 0`. Tres tests Angular del layout pasaron.
