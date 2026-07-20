# PUBLICAR EL MAPA PARA ABRIRLO DESDE CUALQUIER EQUIPO

El enlace `127.0.0.1` solo funciona en la computadora donde se ejecuta Python.
Para obtener un enlace público permanente, publica esta carpeta en Railway.

## 1. Subir el proyecto a GitHub

1. Crea una cuenta en GitHub si todavía no tienes una.
2. Crea un repositorio nuevo, por ejemplo `mapa-counties`.
3. Sube TODOS los archivos de esta carpeta al repositorio.

## 2. Crear el servicio en Railway

1. Entra en Railway.
2. Selecciona **New Project**.
3. Selecciona **Deploy from GitHub repo**.
4. Elige el repositorio `mapa-counties`.
5. Railway instalará automáticamente `requirements.txt` y usará el comando incluido en `railway.json`.

## 3. Crear almacenamiento persistente (MUY IMPORTANTE)

Sin volumen, los mapas pueden perderse al reiniciarse o volver a publicarse.

1. Dentro del servicio de Railway, abre **Volumes**.
2. Crea un volumen.
3. Usa como ruta de montaje: `/data`
4. En **Variables**, agrega:

   - `DATA_DIR` = `/data`
   - `SECRET_KEY` = una combinación larga y privada, por ejemplo 40 caracteres aleatorios

## 4. Generar el dominio público

1. Abre **Settings** del servicio.
2. Busca **Networking / Public Networking**.
3. Pulsa **Generate Domain**.
4. Railway mostrará un enlace parecido a:

   `https://mapa-counties-production.up.railway.app`

Ese enlace abre desde teléfonos y computadoras. Cuando crees un proyecto, el enlace tendrá esta forma:

`https://mapa-counties-production.up.railway.app/map/d73207abf3bf`

## Importante sobre el mapa existente

El proyecto local `d73207abf3bf` está guardado en la carpeta `data` de tu computadora. La carpeta `data` se excluye normalmente de GitHub para no publicar información privada.

Después de publicar:

1. Abre el nuevo enlace público.
2. Crea un mapa nuevo.
3. Sube nuevamente el Excel.
4. Comparte el nuevo enlace público `/map/...`.

## Probar localmente

```powershell
py -m pip install -r requirements.txt
py app.py
```

Localmente seguirá abriendo automáticamente `http://127.0.0.1:5000`.

## Actualización: notas, STR por acreage y fondo satelital

El Excel puede incluir estas columnas exactas:

- State
- County
- Average of STR
- STR 2-5
- STR 5-10
- STR 10-20
- STR 20-60
- STR 60-100
- STR 100+
- Notes (opcional)

Al hacer clic en un county se muestran todos los STR disponibles y un campo para guardar notas. Las notas se sincronizan con otros usuarios conectados. El control de capas ubicado en el lado izquierdo permite alternar entre Calles, Satélite y Topográfico.

Para actualizar la aplicación en Render, reemplaza los archivos del repositorio con esta versión y haz commit. Render volverá a desplegarla automáticamente.
