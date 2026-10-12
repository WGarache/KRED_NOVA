# Kred Nova · ERP de Cobros — versión GitHub Pages

Versión **estática** (HTML + JavaScript) del sistema. Tiene las mismas pantallas y reglas que la versión Python:
interés flat mensual, cuotas diarias (lunes a sábado), semanales y quincenales, sin mora, pagos adelantados,
clientes que solo se inactivan, fiador, garantías con foto, ruta del gestor, recibos, estado de cuenta, reportes y bitácora.

## ⚠️ Importante: cómo guarda los datos

GitHub Pages solo publica archivos; no ejecuta Python ni tiene base de datos.
Por eso **cada navegador guarda sus propios datos** (en la memoria del navegador):

- Lo que registra en su celular **no aparece** en la computadora de otra persona.
- Si se borran los datos de navegación, se pierden los registros (vuelven los de demostración).
- Los usuarios y la contraseña `demo1234` están dentro del código: **no hay seguridad real**.

Sirve para **mostrar y probar** el sistema a distancia. Para operar con datos reales compartidos
se necesita la versión Python en un servidor.

## Publicar en GitHub Pages (sin instalar nada)

1. Cree una cuenta en https://github.com (si no tiene).
2. Arriba a la derecha: **+ → New repository**.
   - Nombre: `kred-nova` (o el que prefiera).
   - Marque **Public** (Pages gratis requiere repositorio público).
   - Pulse **Create repository**.
3. En la página del repositorio pulse **uploading an existing file**.
4. Descomprima `kred_nova_pages.zip` en su PC y **arrastre todos los archivos de adentro**
   (`index.html`, `app.js`, `kred.css`, `logo.png`, `estrella.png`, `icono.png`, `manifest.json`, `.nojekyll`, `LEEME.md`).
   No arrastre la carpeta, sino su contenido.
   > El archivo `.nojekyll` puede estar oculto en Windows; si no lo ve, no pasa nada.
5. Pulse **Commit changes**.
6. Vaya a **Settings → Pages**.
   - En **Source** elija **Deploy from a branch**.
   - En **Branch** elija **main** y carpeta **/ (root)** → **Save**.
7. Espere 1–2 minutos y recargue esa página. Aparecerá la dirección:
   **https://SU-USUARIO.github.io/kred-nova/**

## Usuarios de prueba (contraseña `demo1234`)

| Usuario | Rol |
|---|---|
| `gerente` | Gerente: todo, inactiva clientes, bitácora |
| `cajero` | Cajero: clientes, créditos, pagos, reportes |
| `gestor1`, `gestor2` | Gestor: su ruta y su cartera (ideal en celular) |
| `admin` | Administrador |

## Consejos

- En Android: Chrome → **⋮ → Agregar a pantalla principal** para usarla como app.
- **Estado de cuenta**: botón *Imprimir o guardar PDF* (en el celular elija "Guardar como PDF").
- **Recibo**: botón *WhatsApp* para enviarlo al cliente.
- **Bitácora → Restablecer datos de demostración** vuelve todo al estado inicial.
- Para actualizar la página, suba de nuevo el archivo modificado en GitHub (**Add file → Upload files**).

## Ajustes

Al inicio de `app.js`:
- `FERIADOS`: días sin cobro para créditos diarios (actualícelos cada año).
- `COBRAR_DOMINGOS`: `true` si cobran domingos.
- `USUARIOS` y `CLAVE_DEMO`: usuarios de prueba.

Los colores están en las primeras líneas de `kred.css`.
