# Cubic

Un launcher de Minecraft Java **simple, sobrio y rápido**, hecho con Electron.

- 🔑 **Varias cuentas**: Microsoft (con refresco automático) y offline (UUID calculado igual que Mojang).
- 📦 **Instancias**: cada una con su versión, loader (Vanilla, Fabric o Quilt), RAM, icono y su propia carpeta de mods, config, mundos y resourcepacks. Las librerías, assets y versiones se **comparten** entre instancias (no se descarga nada dos veces).
- 🧩 **Navegador de mods integrado**: Modrinth y CurseForge, con mods, resourcepacks y shaders. Instala el archivo correcto y sus dependencias obligatorias.
- ☕ **Java automático**: descarga el Java que necesita cada versión desde Adoptium. No tienes que instalar nada.
- 🎮 Botón **JUGAR**, barra de progreso con texto y panel de logs.

> **¿Venías de «Sugar Launcher»?** Al abrir Cubic por primera vez migra solo tus cuentas, instancias, Java y ajustes desde `~/.config/Sugar Launcher/`. Esa carpeta vieja se puede borrar después.

Todos los datos van en la carpeta de datos de la app (en Linux: `~/.config/Cubic/`). **No toca tu `~/.minecraft`.**

---

## Cómo usarlo

1. **Cuentas** → *Cuenta Microsoft* e inicia sesión (se necesita Minecraft Java comprado).
   Después puedes crear cuentas *offline* (igual que en Prism Launcher, hace falta tener antes una Microsoft).
2. **Instancias** → *Nueva instancia*: elige nombre, versión (solo estables; activa el interruptor para ver snapshots), loader y RAM.
3. **Inicio** → elige la instancia y pulsa **JUGAR**. La primera vez descarga Java y el juego (unos cientos de MB).
4. **Mods** → busca, pulsa *Instalar* y elige en qué instancia (solo salen las compatibles).
   En **Instancias → (abrir una) → pestañas** puedes activar/desactivar o borrar mods, resourcepacks y shaders.

### CurseForge (opcional)
CurseForge exige una API key gratuita:
1. Entra a <https://console.curseforge.com/> e inicia sesión.
2. Copia tu clave en *API keys* (empieza por `$2a$10$` y tiene 60 caracteres).
3. Pégala en la **pestaña CurseForge** del navegador de mods (o en **Ajustes → CurseForge**), pulsa **Probar key** y luego **Guardar**. Los mods se cargan al instante.

La key se limpia sola (espacios, saltos de línea, comillas) y se envía solo desde el proceso principal, en la cabecera `x-api-key`. Si CurseForge la rechaza, el launcher te dice el código HTTP y qué revisar.

Los **shaders** necesitan el mod Iris: solo se instalan en instancias Fabric o Quilt, y Iris (con Sodium) se añade solo. Dentro del juego se activan en *Opciones → Gráficos → Shaders*. Los resource packs se activan en *Opciones → Paquetes de recursos*.

Si un autor no permite descargas desde apps externas, el launcher te avisa y te ofrece abrir su página en el navegador.
Modrinth no necesita clave.

> **Forge / NeoForge** no están incluidos: `minecraft-launcher-core` no los soporta de forma fiable. Fabric y Quilt sí.

---

## Para desarrollar (Bazzite / Fedora Atomic)

El sistema es inmutable, así que todo se hace dentro de un contenedor (distrobox/toolbox). **No instales nada en el sistema.**

```bash
# 1) Crear el contenedor (una sola vez)
distrobox create --name sugarlauncher --image registry.fedoraproject.org/fedora-toolbox:43 --yes

# 2) Instalar Node 22 y las librerías gráficas que necesita Electron (dentro del contenedor)
distrobox enter sugarlauncher -- sudo dnf install -y nodejs npm nss nspr atk at-spi2-atk at-spi2-core \
  gtk3 libXcomposite libXdamage libXrandr libxkbcommon alsa-lib mesa-libgbm libdrm cups-libs xdg-utils

# 3) Instalar dependencias del proyecto
cd ~/Proyectos/sugar-launcher
distrobox enter sugarlauncher -- npm install

# 4) Ejecutar
distrobox enter sugarlauncher -- npm start
```

## Empaquetar

```bash
cd ~/Proyectos/sugar-launcher

# AppImage para Linux  →  dist/Cubic-1.0.0.AppImage
distrobox enter sugarlauncher -- npm run dist

# Instalador NSIS para Windows  →  dist/Cubic-Setup-1.0.0.exe
# (se recomienda compilarlo en Windows; desde Linux puede requerir wine)
npm run dist:win
```

Para ejecutar el AppImage fuera del contenedor:

```bash
chmod +x dist/Cubic-1.0.0.AppImage
./dist/Cubic-1.0.0.AppImage
```

## Estructura

```
main.js            punto de entrada (ventana sin marco, seguridad)
preload.js         puente seguro entre la interfaz y el sistema (contextIsolation)
main/              lógica: cuentas, instancias, lanzador, Java, Modrinth, CurseForge, instalador
renderer/          interfaz en HTML + CSS + JS puro
  js/screens/      una pantalla por archivo (inicio, instancias, mods, cuentas, ajustes)
  js/lib/          utilidades (DOM, iconos Lucide locales, toasts, modales, Markdown seguro, campo de key)
  fonts/           Inter (licencia OFL) incluida localmente
build/icon.png     icono (512x512)
```

## Diseño

Tema oscuro neutro con un único acento morado (`#8B5CF6`), tipografía Inter e iconos Lucide incluidos localmente (sin CDN, sin emojis). Las animaciones usan solo `transform` y `opacity` y respetan `prefers-reduced-motion`.

## Seguridad

- `contextIsolation` activado, `nodeIntegration` desactivado y `sandbox` activado.
- Todas las peticiones de red las hace el proceso principal; la interfaz tiene una CSP estricta.
- Las descripciones de mods (Markdown/HTML de terceros) pasan por un filtro de etiquetas permitidas.
- Los refresh tokens y la API key se guardan en archivos con permisos `0600`.
- Las descargas verifican el hash SHA-1 cuando el sitio lo proporciona.
