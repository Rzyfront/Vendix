SRC_W, SRC_H = 1960, 1230
TITULO_SUP = 'TUTORIAL 06'
TITULO = 'Categorías de productos'
CIERRE = 'Listo, tu catálogo ya tiene categorías'
CIERRE_SUB = 'Productos  ›  Categorías'
HDR = (1776, 112, 1906, 152)
ACC = (1490, 466, 1900, 512)
GUARDAR = (1786, 1096, 1906, 1146)
MODAL = (20, 60, 1940, 1170)
STEPS = [
    dict(segs=[(0,1)], anchors=[(0, 0), (13.5, 5.4), (19.5, 6.4), (20.2, 7.0), (24.0, 8.2), (26.0, 9.2), (37.6, 10.2), (50.8, 13.4),
                     (52.2, 14.1), (53.0, 'END')], cuts=[(27.0, 37.4), (43.0, 50.3)], foci=[
        (13.5, 19.6, (300, 470, 1900, 512), 'Editar producto', None),
        (24.5, 26.2, (300, 560, 1360, 800), 'Clasificación', None),
        (37.4, 51.8, (830, 660, 1280, 710), 'Categorías', 1.6),
        (51.9, 53.0, HDR, 'Guardar', 1.6)]),
    dict(segs=[(0,1)], anchors=[(56.0, 0), (57.6, 3.4), (59.6, 6.4), (62.5, 'END')], foci=[
        (56.0, 58.0, (1460, 350, 1890, 900), 'Filtros', None),
        (58.0, 59.6, (1476, 676, 1856, 728), 'Categoría', 1.5),
        (59.7, 62.5, (300, 470, 1440, 920), 'Solo Construcción', None)]),
    dict(segs=[(0,1)], anchors=[(66.0, 0), (69.6, 2.2), (70.4, 2.8), (76.5, 4.3), (78.8, 6.9), (80.2, 7.6), (109.3, 9.5),
                     (111.4, 11.2), (114.2, 13.8), (116.4, 15.8), (117.4, 'END')], cuts=[(71.0, 76.0), (81.0, 108.9)], foci=[
        (66.5, 70.3, (60, 440, 240, 480), 'Categorías', 1.7),
        (76.5, 78.8, (310, 380, 1910, 740), 'Tus categorías', None),
        (78.8, 80.2, ACC, 'Nueva Categoría', 1.6),
        (80.2, 111.4, (556, 350, 976, 412), 'Nombre', 1.6),
        (111.4, 114.2, (984, 350, 1404, 412), 'Slug', 1.6),
        (114.2, 115.6, (556, 444, 1404, 544), 'Imagen (opcional)', 1.5),
        (115.7, 116.8, (1176, 942, 1384, 1004), 'Crear Categoría', 1.6)]),
    dict(segs=[(0,1)], anchors=[(117.6, 0), (124.0, 3.2), (124.8, 4.2), (128.2, 6.4), (136.8, 7.6), (140.4, 8.4), (141.4, 9.0), (143.0, 'END')],
         cuts=[(119.8, 123.0), (129.0, 135.8)], foci=[
        (117.6, 124.0, (1724, 772, 1764, 810), 'Productos', 1.7),
        (124.4, 126.2, MODAL, 'Productos de Vestimenta', None),
        (126.2, 140.0, (50, 564, 1864, 644), 'Marca los productos', 1.3),
        (140.0, 141.0, GUARDAR, 'Guardar', 1.6),
        (141.4, 143.0, (310, 770, 1910, 812), 'Vestimenta: 2 productos', None)]),
]
STEP_TITLES = ['Asigna categorías', 'Filtra por categoría', 'Crea una categoría', 'Agrega productos']
# --- estilo T01 ---
TITULO_LARGO = 'Cómo organizar productos con categorías'
CHECKS = ['Asigna categorías a tus productos', 'Filtra tu catálogo por categoría', 'Crea categorías y agrégales productos']
CY0 = 1230 - 1102.5 / 2
