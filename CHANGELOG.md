# Changelog

Todos los cambios relevantes de Cubic. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); las versiones siguen [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Cambiado
- **Licencia: Cubic pasa de MIT a GPL-3.0-or-later a partir de la próxima versión.** Las versiones 1.0.0 y 1.1.0 ya publicadas siguen bajo MIT.

### Añadido
- `LICENSE` con el texto de la GPL v3.
- README en inglés (`README.en.md`) y secciones de requisitos, estado y licencia en el README.
- `docs/ARCHITECTURE.md`: organización del código y flujo de datos.
- Workflow de GitHub Actions que compila y publica el AppImage y el código fuente de terceros al crear un tag `v*`.

## [1.1.0] - 2026-11-27

Publicada bajo licencia MIT.

### Añadido
- Soporte de **Horizon** (Minecraft Java 26.3 reescrito en Rust): instalación, preparación de recursos, arranque y panel en la interfaz.
- **Intro animada** (mod Animated Mojang Logo): versiones fijadas con descarga verificada al compilar, interruptor global y por instancia, y créditos en *Acerca de*.
- Licencias y avisos de los mods incluidos (`LICENSES/`, `THIRD_PARTY_NOTICES.md`).
- Descargas verificables con SHA-256 y opción de bajar un JDK.
- Pruebas automáticas, incluida la de «Detener».

### Cambiado
- Arranque más rápido: solo se lee el índice de cada jar para saber qué mod es.
- Las peticiones idénticas en curso se comparten; el diálogo «Instalar» comprueba las instancias en paralelo (máximo 4).
- Los logs se redibujan una vez por fotograma.
- Código unificado (navegación, parámetros de URL, apertura de carpetas) y código sin uso eliminado.

### Corregido
- En Inicio aparecía la palabra «null» sobre el botón Jugar.
- El botón «Probar key» de CurseForge perdía su icono.
- Las cuentas muestran «Sesión caducada» y «Reiniciar sesión» en cuanto falla al jugar.
- Se puede quitar una key de CurseForge recién guardada aunque no valide.
- Se avisa si falla el guardado de un ajuste.
- El panel de Horizon ya no acumula suscripciones al repintar.
- `instance.json` ya no se reescribe si la intro animada no cambió.

## [1.0.0] - 2026-11-26

Primera versión pública, bajo licencia MIT.

### Añadido
- Launcher de Minecraft Java con cuentas Microsoft y offline, instancias, loaders Vanilla/Fabric/Quilt, contenido de Modrinth y CurseForge y descarga automática de Java.

[Sin publicar]: https://github.com/SugarSV11/Cubic/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/SugarSV11/Cubic/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SugarSV11/Cubic/releases/tag/v1.0.0
