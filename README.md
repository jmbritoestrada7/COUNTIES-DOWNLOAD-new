# Mapa colaborativo de Counties

Aplicación web independiente para:

- Crear un mapa con enlace único.
- Subir Excel con counties descargados.
- Resaltar los counties en el mapa.
- Dibujar polígonos o rectángulos para solicitar nuevas listas.
- Guardar automáticamente los dibujos.
- Ver cambios en tiempo real entre varias personas conectadas al mismo enlace.

## Formato del Excel

Columnas obligatorias:

- `COUNTY` o `CONDADO`
- `STATE` o `ESTADO` (abreviatura como MO/TX/FL o nombre completo)

Columnas opcionales:

- `STATUS`
- `DATE` o `FECHA`
- `NOTES` o `NOTAS`

## Ejecutar en Windows

1. Instala Python 3.11 o 3.12.
2. Abre CMD dentro de esta carpeta.
3. Ejecuta:

```bat
py -m pip install -r requirements.txt
py app.py
```

4. Abre `http://localhost:5000`.

## Compartir por internet

`localhost` solo funciona en tu computadora. Para obtener un enlace visible desde cualquier lugar, publica esta carpeta en un servidor Python, por ejemplo Render, Railway, Fly.io o un VPS.

Comando de inicio recomendado:

```bash
python app.py
```

En producción cambia `SECRET_KEY` y usa almacenamiento persistente para la carpeta `data`.

## Nota técnica

Los límites de counties y el mapa base se cargan desde servicios públicos mediante internet. Los proyectos se guardan como JSON en `data/projects`.


## Campo STR
El Excel puede incluir una columna llamada `STR`, `Sell Through Rate`, `AVG STR`, `Tasa de venta` o `Porcentaje de venta`.
Se aceptan valores como `35%`, `35` o `0.35`; todos se muestran como porcentaje.

## Etiquetas de counties
Los nombres se muestran únicamente cuando el mapa alcanza zoom 7 o superior para evitar etiquetas demasiado grandes o amontonadas.
