# Arquitectura de Cubic

Cubic es una aplicación **Electron** con dos procesos y un puente entre ellos. No usa frameworks: la interfaz es HTML, CSS y JavaScript (módulos ES) sin paso de compilación.

```
┌────────────────────────── proceso principal (Node) ──────────────────────────┐
│ main.js ── crea la ventana, bloquea navegación, pregunta al cerrar           │
│   └─ main/ipc.js ── registra TODOS los canales que la interfaz puede usar    │
│        ├─ accounts.js    cuentas Microsoft (msmc) y offline                  │
│        ├─ instances.js   carpetas e instance.json de cada instancia          │
│        ├─ launcher.js    versiones, perfiles Fabric/Quilt, arranque (MCLC)   │
│        │    ├─ java.js           descarga de Java (Adoptium)                 │
│        │    ├─ horizon.js        loader Horizon (Minecraft 26.3 en Rust)     │
│        │    └─ animated-logo.js  intro animada por instancia                 │
│        ├─ mods-ipc.js    búsqueda e instalación con dependencias             │
│        │    ├─ modrinth.js       API v2                                      │
│        │    └─ curseforge.js     API v1 (requiere key)                       │
│        └─ store.js / paths.js / http.js / bus.js   utilidades comunes        │
└──────────────▲──────────────────────────────────────────────┬────────────────┘
               │ ipcRenderer.invoke (window.api.*)            │ bus.send(...)
         preload.js (contextBridge)                          eventos: status, log,
               │                                              game-closed, horizon…
┌──────────────┴──────────── interfaz (renderer, sandbox) ────▼────────────────┐
│ renderer/index.html + styles.css                                             │
│ js/app.js     navegación entre pantallas y barra lateral                     │
│ js/state.js   estado global + eventos                                        │
│ js/screens/   home · instances · mods · accounts · settings                  │
│ js/lib/       dom, iconos, avisos, modales, Markdown seguro, key CurseForge  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Proceso principal (`main/`)

| Módulo | Responsabilidad |
|---|---|
| `main.js` | Punto de entrada. Ejecuta la migración desde «Sugar Launcher», crea una ventana sin marco con `contextIsolation`, `sandbox` y sin `nodeIntegration`, impide abrir ventanas y navegar, y avisa si se cierra con el juego abierto. Instancia única. |
| `ipc.js` | Única puerta de entrada desde la interfaz: `init`, ajustes, cuentas, versiones, instancias, Horizon, `game:launch`/`game:stop`, enlaces externos y carpeta de licencias. |
| `bus.js` | Envía mensajes del proceso principal a la interfaz (`status`, `log` y otros eventos). |
| `paths.js` | Rutas de datos dentro de `userData` (`~/.config/Cubic/` en Linux): `shared/`, `instances/`, `java/`, `horizon/`, `config.json`, `accounts.json`. |
| `store.js` | Lectura y escritura de JSON (ajustes y cuentas). Los archivos sensibles se guardan con permisos `0600`. |
| `http.js` | Peticiones y descargas. Escribe a un archivo temporal, verifica SHA-1/SHA-256/SHA-512 si se conoce el hash y comparte peticiones idénticas en curso. |
| `accounts.js` | Inicio de sesión Microsoft con `msmc` (con refresco del token) y cuentas offline. |
| `instances.js` | Crear, duplicar, editar y borrar instancias. Cada una tiene su carpeta con `mods`, `config`, `saves`, `resourcepacks` y `shaderpacks`. |
| `launcher.js` | Lee el manifiesto de versiones de Mojang, prepara perfiles de Fabric/Quilt, se asegura de que haya Java y lanza el juego con `minecraft-launcher-core`. Librerías, assets y versiones van en `shared/` y los usan todas las instancias. |
| `java.js` | Descarga el JDK adecuado desde Adoptium según la versión de Minecraft. |
| `modrinth.js`, `curseforge.js` | Clientes de las APIs oficiales. |
| `mods-ipc.js` | Navegador de contenido: búsqueda, resolución de dependencias e instalación en una o varias instancias. |
| `horizon-core.js` / `horizon.js` | Reglas puras (comprobables sin Electron) y la parte con efectos: descarga de la build oficial, preparación de recursos con un JDK 25 y arranque. |
| `animated-logo-core.js` / `animated-logo.js` | Reglas puras y la aplicación por instancia del mod de intro animada. Solo copia o renombra jars; nunca los modifica. |
| `migrate.js` | Migración única de datos desde la carpeta antigua «Sugar Launcher». |

## Interfaz (`renderer/`)

- `preload.js` expone `window.api` con `contextBridge`. La interfaz solo puede llamar a esos métodos, y los errores del IPC llegan con el mensaje limpio.
- `js/app.js` define las cinco pantallas y la navegación con transición. Cada pantalla exporta `render(contenedor, params)` y puede devolver una función de limpieza.
- `js/state.js` guarda el estado compartido (cuentas, instancias, ajustes) y un sistema de eventos simple.
- `js/lib/md.js` convierte las descripciones de mods a HTML con una lista de etiquetas permitidas.
- La CSP de `index.html` no deja cargar scripts remotos; toda la red pasa por el proceso principal.

## Flujo de datos: pulsar «Jugar»

1. `screens/home.js` llama a `api.game.launch({ instanceId, accountId })`.
2. `ipc.js` lo pasa a `launcher.launch()`.
3. `launcher.js` refresca la cuenta si es Microsoft (`accounts.js`), consulta el manifiesto de versiones, prepara el perfil del loader, asegura Java (`java.js`) y aplica o quita la intro animada (`animated-logo.js`). Si el loader es Horizon, el arranque lo hace `horizon.js`.
4. Durante las descargas y el juego, `bus.status()` y `bus.log()` mandan progreso y log a la interfaz, que redibuja una vez por fotograma.
5. Al cerrarse el juego, `game-closed` vuelve a habilitar el botón.

## Flujo de datos: instalar un mod

`screens/mods.js` → `api.mods.*` → `mods-ipc.js` → `modrinth.js` o `curseforge.js` (búsqueda y versiones) → resolución de dependencias → `http.download()` con verificación de hash → carpeta `mods/`, `resourcepacks/` o `shaderpacks/` de la instancia (`instances.js`). Los shaders añaden Iris y Sodium en instancias Fabric o Quilt.

## Compilación y pruebas

- `npm test` ejecuta `node --test test/*.test.js`: pruebas de flujo, IPC, HTTP, datos, arranque, Horizon e intro animada.
- `npm run dist` usa `electron-builder`. Antes de empaquetar, `scripts/fetch-animated-logo.js` descarga los jars de la intro animada definidos en `animated-logo.lock.json` y comprueba su sha512 contra Modrinth.
- `npm run fetch:sources` descarga a `dist-sources/` el código fuente de lo que va incluido, para adjuntarlo a cada release.
- `.github/workflows/release.yml` hace todo lo anterior al subir un tag `v*` y publica el AppImage y las fuentes de terceros.
