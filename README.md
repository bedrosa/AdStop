# AdStop

Extensión para bloquear anuncios y rastreadores, con filtros abiertos y ajustes guardados localmente. Preparada para Chrome y Brave, y para otros navegadores Chromium como Edge, Opera y Vivaldi. Se genera además un paquete experimental para Firefox.

## Instalar en Chrome o Brave

Descarga el ZIP para Chromium desde [Releases](https://github.com/bedrosa/AdStop/releases/latest) y descomprímelo. No hace falta instalar Node para utilizar ese paquete.

1. Abre `chrome://extensions` en Chrome o `brave://extensions` en Brave
2. Activa **Modo de desarrollador**
3. Pulsa **Cargar descomprimida**
4. Selecciona la carpeta descomprimida que contiene `manifest.json`
5. Fija AdStop en la barra de extensiones y recarga las webs que tenías abiertas

Si trabajas con el código fuente, ejecuta la compilación y carga `dist/chromium`. En Edge se utiliza `edge://extensions` con el mismo paquete. Chrome y Brave necesitan una versión basada en Chromium 128 o posterior.

No se modifica tu perfil del navegador ni se instala automáticamente la extensión. Las pruebas usan perfiles temporales separados.

## Uso

- El botón central permite o bloquea anuncios en el dominio abierto, incluidos sus subdominios. Se recarga esa pestaña al cambiarlo
- Desde Ajustes puedes pausar o reanudar AdStop en todas las webs
- El botón de luna o sol cambia entre modo claro y oscuro en el popup y los ajustes. La elección se guarda y se comparte entre ambas ventanas
- El contador muestra solicitudes de anuncios y rastreadores bloqueadas en la página abierta, con un listado de dominios y sus respectivos bloqueos
- El contador se actualiza en directo y se reinicia al recargar o navegar a otra página. Cada pestaña mantiene su registro independiente y el icono muestra su cifra
- Total anuncios bloqueados suma los bloqueos de todas las pestañas y se conserva al cerrar el navegador, recargar la extensión o cambiar los ajustes. Empieza a contar desde que instalas esta versión
- En Ajustes puedes activar filtros visuales, scripts de las listas, cobertura ampliada y los controles de plataformas de streaming
- Webs permitidas desactiva la protección para ese dominio y sus subdominios
- Dominios bloqueados impide cargar sus recursos. No bloquea abrir esos dominios como página principal
- Los filtros personales de elementos utilizan CSS estándar, por ejemplo `ejemplo.com##.banner-publicidad`

Los cambios de Ajustes se aplican al guardar. Recarga las pestañas abiertas para que desaparezcan los efectos de scripts y estilos ya aplicados.

## Filtros incluidos

Las fuentes se declaran en `filters/sources.json`:

- uBlock Origin Filters
- uBlock Origin Quick fixes
- uBlock Origin Unbreak
- Pie Custom
- EasyList
- EasyPrivacy
- EasyList Spanish

Las reglas de red se convierten con `@adguard/dnr-converter`, utilizando el analizador de `@adguard/agtree`. Los scriptlets compatibles provienen de `@adguard/scriptlets`. Los selectores extendidos se aplican con `@adguard/extended-css`. Se incluyen recursos locales de sustitución para las reglas de red que los necesitan.

La compilación conserva todas las excepciones de red en un conjunto base de hasta 30.000 reglas y coloca el resto en un conjunto ampliado. AdStop comprueba la cuota antes de activar este último. Tener otras extensiones de filtrado puede reducir la cuota disponible.

El popup muestra bloqueos de red observados en esa página. Solo suma acciones de bloqueo y sustituciones por recursos locales, sin contar excepciones, cambios de cabeceras ni múltiples coincidencias sobre la misma solicitud. No suma los elementos ocultados con CSS ni estima cuántos anuncios se retiraron dentro de una respuesta de vídeo. El listado agrupa hasta 200 dominios y reúne el resto bajo Otros dominios.

El detalle de solicitudes utiliza `declarativeNetRequestFeedback`, disponible en Chrome y Brave cuando AdStop se carga como extensión descomprimida, que es la instalación descrita en esta guía. Publicarlo en una tienda requiere adaptar el registro de bloqueos a las capacidades que ese navegador permita en extensiones publicadas. [Referencia de Chrome](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#event-onRuleMatchedDebug).

Las copias originales están en `filters/upstream`, con sus cabeceras. `filters/lock.json` registra origen, fecha y SHA-256 de cada descarga. La compilación verifica esas huellas y falla si los archivos no coinciden. `reports/filters.json` detalla reglas no compatibles y errores de conversión. El formato de uBlock no es completamente equivalente a Manifest V3 y no todas sus funciones pueden trasladarse.

## Plataformas de streaming

Los ajustes incluyen controles para Netflix, Disney+, Prime Video, HBO Max y Max, Apple TV, Paramount+, Hulu, Peacock, SkyShowtime, Discovery+, Movistar Plus+, DAZN, Crunchyroll, Pluto TV, Rakuten TV, Tubi, ViX, Filmin, Fubo, Atresplayer, Mitele y RTVE Play, además de los módulos de YouTube y Twitch.

Cada control adicional activa o desactiva la protección de red, los filtros visuales y los scripts en los dominios declarados en `src/shared/platforms.js`. Las reglas proceden de las listas incluidas. No equivale a certificar que se eliminan todos los anuncios de todos los planes o regiones. Prime Video incluye `primevideo.com`, y Apple TV incluye `tv.apple.com`.

Netflix incorpora una adaptación del script de Pie para neutralizar propiedades publicitarias del reproductor. Conserva el contrato de Object.defineProperty y deja intactas las propiedades del contenido. Los filtros de Pie también incluyen reglas de reproducción para Prime Video, Max, Hulu, Pluto TV y Peacock que se aplican cuando sus scriptlets son compatibles.

YouTube tiene un módulo local para limpiar datos publicitarios del reproductor en la respuesta inicial, fetch y XMLHttpRequest. También pulsa los botones de salto detectados y silencia o acelera los anuncios cortos que llegan a mostrarse. Los filtros y scriptlets de las listas complementan este módulo.

Twitch integra vaft de TwitchAdSolutions, fijado a una revisión concreta y distribuido con su licencia MIT. Intenta obtener una variante del directo sin publicidad y evita reproducir los segmentos identificados como anuncios. Puede haber pausas, bajadas de calidad o anuncios que se escapen. Su repositorio original fue archivado en marzo de 2026, por lo que este módulo necesita seguimiento propio. No utiliza un servicio de proxy externo.

Estas integraciones no garantizan bloquear todos los anuncios. Las plataformas cambian sus sistemas, experimentos y respuestas según cuenta, región y sesión. Los anuncios integrados en un mismo flujo de vídeo o protegidos por DRM pueden seguir apareciendo. Las pruebas automáticas verifican solicitudes y respuestas controladas, no certifican el resultado en emisiones reales ni en todas las variantes de anuncios del servidor.

Para diagnosticar conflictos, prueba AdStop como único bloqueador. En Brave puedes desactivar Shields solo en la web que estés comprobando. No cambies varios bloqueadores de Twitch a la vez.

## Firefox y Safari

`dist/firefox` contiene un manifiesto adaptado a Firefox 140 o posterior. Para probarlo, abre `about:debugging`, entra en Este Firefox y carga su `manifest.json` como complemento temporal. Usa el mismo conjunto de filtros MV3 compilado para Chromium. Este paquete no tiene la misma validación de navegador que el de Chromium y necesita firma de Mozilla para instalarse permanentemente en Firefox estándar.

Safari requiere empaquetado y firma con las herramientas de Apple. Este proyecto no entrega un paquete instalable de Safari. Los navegadores móviles solo pueden utilizarlo si admiten extensiones de este tipo. No bloquea publicidad dentro de aplicaciones externas al navegador.

## Mantener el proyecto

Requiere Node 22 o posterior. Desde PowerShell en esta carpeta:

```powershell
npm.cmd ci
npm.cmd run filters:update
npm.cmd test
npm.cmd run build
npm.cmd run package
```

Después abre la página de extensiones y pulsa **Recargar** en AdStop. Las extensiones cargadas como descomprimidas no se actualizan automáticamente desde una tienda. Puedes ejecutar `actualizar.cmd` para preparar de nuevo las listas y los paquetes.

La actualización descarga solo fuentes declaradas en el proyecto. Si una descarga falla, no se compila una lista parcial como actualización válida. Los paquetes funcionan sin descargas de filtros ni de código durante la navegación. Para una instalación desde una tienda, las nuevas listas se publican como una nueva versión de la extensión.

Para las pruebas en Chromium:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:browser
```

`npm.cmd run check` ejecuta las pruebas de reglas, compila y pasa las comprobaciones de navegador. Los resultados y capturas se guardan en `test-results`. El navegador de pruebas se ejecuta sin ventana y con un perfil temporal propio. `npm.cmd run test:brave` permite comprobar la instalación y las reglas personales en Brave si está instalado en su ruta habitual de Windows.

El flujo de GitHub Actions comprueba cambios y prepara un paquete actualizado semanalmente. Los paquetes de cada ejecución se pueden descargar desde sus artefactos. Las versiones publicadas están en Releases. No publica en tiendas ni cambia automáticamente la instalación de tu navegador.

## Estructura

```text
src/background.js          Ajustes, cuotas, reglas personales y scripts
src/shared/                Validación, ámbitos y limpieza del reproductor
src/content/               Filtros visuales y módulo de YouTube
src/ui/                    Ventana de la extensión y ajustes
filters/local.txt          Reglas propias
filters/sources.json       Fuentes que se descargan al actualizar
filters/lock.json          Fecha y huellas de las fuentes
filters/upstream/          Copias originales de las listas
vendor/twitch.js           Módulo Twitch de la revisión fijada
scripts/                   Actualización, compilación y empaquetado
tests/                     Comprobaciones de reglas y navegador
dist/                      Extensiones listas para cargar
releases/                  ZIP de extensiones y código fuente
reports/filters.json       Conversión y reglas omitidas
```

Para actualizar la integración de Twitch revisa la revisión fijada en `scripts/update-filters.mjs`, verifica su código y licencia y vuelve a ejecutar la actualización y las pruebas. El archivo de proveedor se compila sin comentarios y sin renombrar identificadores, porque el módulo utiliza funciones serializadas dentro de workers.

## Privacidad y licencia

AdStop no envía historial, estadísticas ni ajustes a un servidor propio. Los ajustes y el total acumulado se guardan en `chrome.storage.local`. Ese total conserva solo una cifra, sin historial de dominios. La elección del tema se guarda en el almacenamiento local de las páginas de la extensión. Los registros por página se guardan en `chrome.storage.session`, desaparecen al cerrar el navegador y se eliminan al cerrar su pestaña o iniciar otra navegación. Guardan dominios, contadores e identificadores temporales de solicitudes, sin rutas ni parámetros de las URL.

El acceso a webs HTTP y HTTPS permite bloquear recursos, aplicar filtros y ejecutar las integraciones solicitadas. `webNavigation` permite reiniciar el contador cuando cambia la página y `declarativeNetRequestFeedback` permite registrar los bloqueos de AdStop. No pide acceso a cookies, contraseñas ni al historial guardado del navegador. El módulo de Twitch utiliza las solicitudes de reproducción de la propia plataforma para buscar variantes del directo, con las credenciales que esa sesión ya utiliza.

AdStop se distribuye bajo GPL-3.0-only. Conserva el código fuente, las licencias y las atribuciones al redistribuirlo. Consulta `THIRD_PARTY_NOTICES.md` para conocer las fuentes y sus licencias.
