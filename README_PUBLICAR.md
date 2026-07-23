# PUBLICAR EN RENDER CON ENLACES PERMANENTES

Render usa un sistema de archivos temporal. Esta versión evita que los mapas se pierdan
guardando cada proyecto en Cloudflare R2.

Lee primero `README_R2_RENDER.md` y configura en Render estas variables:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
SECRET_KEY
```

Después reemplaza en tu repositorio todos los archivos por los de esta carpeta y haz commit.
Render desplegará la actualización automáticamente.

La página inicial debe mostrar:

```text
✓ Almacenamiento permanente R2 activo
```

El enlace de cada mapa mantiene el formato:

```text
https://TU-SERVICIO.onrender.com/map/xxxxxxxxxxxx
```

Los mapas creados después de activar R2 conservarán el Excel procesado, las notas, prioridades,
asignaciones, fechas y polígonos dibujados.
