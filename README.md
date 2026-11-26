<div align="center">

<img src="build/icon.png" width="112" alt="Icono de Cubic">

# Cubic

**Un launcher de Minecraft Java simple, sobrio y rápido.**

[![Versión](https://img.shields.io/github/v/release/SugarSV11/Cubic?label=versi%C3%B3n&color=8B5CF6&style=flat-square)](https://github.com/SugarSV11/Cubic/releases/latest)
[![Descargas](https://img.shields.io/github/downloads/SugarSV11/Cubic/total?label=descargas&color=8B5CF6&style=flat-square)](https://github.com/SugarSV11/Cubic/releases)
![Linux](https://img.shields.io/badge/Linux-AppImage-8B5CF6?style=flat-square&logo=linux&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-45-8B5CF6?style=flat-square&logo=electron&logoColor=white)

### [⬇ Descargar para Linux](https://github.com/SugarSV11/Cubic/releases/latest/download/Cubic-1.0.0.AppImage)

<br>

<img src="docs/inicio.png" width="820" alt="Pantalla de inicio de Cubic">

</div>

## Características

| | |
|---|---|
| **Cuentas** | Microsoft (con refresco automático) y offline |
| **Instancias** | Cada una con su versión, loader, RAM, icono, mods, configuración y mundos |
| **Loaders** | Vanilla, Fabric y Quilt |
| **Contenido** | Mods, resource packs y shaders desde Modrinth y CurseForge, con sus dependencias |
| **Java** | Se descarga solo desde Adoptium, según la versión del juego |
| **Espacio** | Librerías, assets y versiones compartidas entre instancias |

<div align="center">
<table>
<tr>
<td width="50%"><img src="docs/instancias.png" alt="Pantalla de instancias"></td>
<td width="50%"><img src="docs/mods.png" alt="Navegador de mods"></td>
</tr>
<tr>
<td align="center"><sub>Instancias</sub></td>
<td align="center"><sub>Navegador de mods</sub></td>
</tr>
</table>
</div>

## Instalación

Descarga el AppImage desde [Releases](https://github.com/SugarSV11/Cubic/releases/latest) y ejecútalo:

```bash
chmod +x Cubic-1.0.0.AppImage
./Cubic-1.0.0.AppImage
```

## Primeros pasos

1. **Cuentas** → *Cuenta Microsoft* e inicia sesión (se necesita Minecraft Java comprado). Después puedes crear cuentas offline.
2. **Instancias** → *Nueva instancia*: elige nombre, versión, loader y RAM.
3. **Inicio** → elige la instancia y pulsa **Jugar**. La primera vez descarga Java y el juego.
4. **Mods** → busca, pulsa *Instalar* y elige la instancia.

<details>
<summary><b>Activar CurseForge (opcional)</b></summary>
<br>

CurseForge exige una API key gratuita. Modrinth no necesita ninguna.

1. Entra a <https://console.curseforge.com/> e inicia sesión.
2. Copia tu clave en *API keys* (empieza por `$2a$10$` y tiene 60 caracteres).
3. Pégala en la pestaña **CurseForge** del navegador de mods (o en **Ajustes**), pulsa **Probar key** y luego **Guardar**.

Si un autor no permite descargas desde apps externas, Cubic te avisa y ofrece abrir su página en el navegador.

</details>

<details>
<summary><b>Shaders y resource packs</b></summary>
<br>

Los shaders necesitan Iris: solo se instalan en instancias Fabric o Quilt, e Iris (con Sodium) se añade solo. Se activan en *Opciones → Gráficos → Shaders*. Los resource packs se activan en *Opciones → Paquetes de recursos*.

</details>

<details>
<summary><b>Dónde se guardan los datos</b></summary>
<br>

En Linux, en `~/.config/Cubic/`. Cubic no toca tu `~/.minecraft`.

Si venías de «Sugar Launcher», al abrir Cubic por primera vez se migran solos tus cuentas, instancias, Java y ajustes.

</details>

> Forge y NeoForge no están incluidos.

## Desarrollo

<details>
<summary><b>Compilar desde el código (Bazzite / Fedora Atomic)</b></summary>
<br>

El sistema es inmutable, así que todo se hace dentro de un contenedor.

```bash
git clone https://github.com/SugarSV11/Cubic.git
cd Cubic

# Crear el contenedor (una sola vez)
distrobox create --name sugarlauncher --image registry.fedoraproject.org/fedora-toolbox:43 --yes

# Node y las librerías que necesita Electron (dentro del contenedor)
distrobox enter sugarlauncher -- sudo dnf install -y nodejs npm nss nspr atk at-spi2-atk at-spi2-core \
  gtk3 libXcomposite libXdamage libXrandr libxkbcommon alsa-lib mesa-libgbm libdrm cups-libs xdg-utils

# Dependencias, ejecutar y empaquetar
distrobox enter sugarlauncher -- npm install
distrobox enter sugarlauncher -- npm start
distrobox enter sugarlauncher -- npm run dist    # → dist/Cubic-1.0.0.AppImage
```

Existe `npm run dist:win` para generar un instalador de Windows, pero todavía no se ha probado.

</details>

<details>
<summary><b>Estructura del proyecto</b></summary>
<br>

```
main.js            punto de entrada (ventana sin marco, seguridad)
preload.js         puente seguro entre la interfaz y el sistema
main/              cuentas, instancias, lanzador, Java, Modrinth, CurseForge, instalador
renderer/          interfaz en HTML, CSS y JavaScript puro
  js/screens/      una pantalla por archivo
  js/lib/          utilidades (DOM, iconos, avisos, modales, Markdown seguro)
  fonts/           Inter (licencia OFL) incluida localmente
build/icon.png     icono
docs/              capturas
```

</details>

<details>
<summary><b>Seguridad</b></summary>
<br>

- `contextIsolation` y `sandbox` activados, `nodeIntegration` desactivado.
- Las peticiones de red las hace el proceso principal; la interfaz tiene una CSP estricta.
- Las descripciones de mods pasan por un filtro de etiquetas permitidas.
- Los tokens de sesión y la API key se guardan en archivos con permisos `0600`.
- Las descargas verifican el hash SHA-1 cuando el sitio lo proporciona.

</details>

---

<div align="center">
<sub>Las capturas usan datos de ejemplo. Cubic no está afiliado a Mojang ni a Microsoft.</sub>
</div>
