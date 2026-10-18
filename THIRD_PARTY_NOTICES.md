# Fuentes y licencias de AdStop

AdStop se distribuye bajo GPL-3.0-only. El archivo LICENSE contiene el texto de la licencia. El código fuente y los archivos de filtros forman parte del proyecto y deben acompañar su redistribución conforme a sus licencias.

## Filtros

- uBlock Origin Filters, Quick fixes y Unbreak provienen de https://github.com/uBlockOrigin/uAssets y se distribuyen bajo GPL-3.0
- Pie Custom proviene de https://github.com/piedotorg/pie-adblock-rules y se distribuye bajo GPL-3.0. Copyright The People's Internet Experiment. El proyecto reconoce también aportaciones de uAssets y AdGuard
- EasyList y EasyPrivacy provienen de https://easylist.to y ofrecen GPL-3.0-or-later o CC-BY-SA-3.0. Esta distribución utiliza la opción GPL
- EasyList Spanish proviene de https://github.com/easylist/easylistspanish y ofrece GPL-3.0-or-later o CC-BY-SA-3.0. Esta distribución utiliza la opción GPL

Se conservan las cabeceras y atribuciones originales en filters/upstream. Las fechas y huellas exactas de las descargas están en filters/lock.json. Las reglas se convierten a DNR y CSS, se deduplican y se separan conforme a la cuota del navegador. Las reglas no compatibles figuran en reports/filters.json.

## Bibliotecas de AdGuard

El conversor @adguard/dnr-converter, el analizador @adguard/agtree, los scripts de @adguard/scriptlets y el motor @adguard/extended-css son obra de Adguard Software Ltd. y sus colaboradores. Se distribuyen bajo GPL-3.0. Los scriptlets compatibles, los recursos de sustitución y el motor de selectores extendidos se incluyen en el paquete como código local. El conversor y el analizador se usan durante la compilación.

- https://github.com/AdguardTeam/tsurlfilter
- https://github.com/AdguardTeam/Scriptlets

Las versiones exactas se conservan en package-lock.json. Se eliminan comentarios de los archivos compilados y se conserva la atribución en este documento y el texto GPL en licenses/GPL-3.0.txt.

## Twitch

El módulo se basa en vaft de pixeltris y colaboradores, proyecto TwitchAdSolutions, bajo licencia MIT. Se fija la revisión f8f86706daf90daa534b26bce5b2f01238667d5f.

https://github.com/pixeltris/TwitchAdSolutions

Se elimina la cabecera de recurso de uBlock y los comentarios mediante esbuild, sin minificar identificadores. El código resultante se conserva en vendor/twitch.js. La licencia íntegra está en vendor/LICENSE-twitch.txt y en licenses/Twitch-MIT.txt en el paquete.

El repositorio original fue archivado en marzo de 2026. Su inclusión permite revisar y mantener la implementación localmente, pero no implica actualizaciones futuras de su autor ni garantiza que Twitch permita evitar todos los anuncios.

## Herramientas de desarrollo

esbuild se distribuye bajo MIT, fflate bajo MIT y Playwright bajo Apache-2.0. Estas herramientas no se cargan en las páginas del usuario. Sus licencias se incluyen en las respectivas dependencias de desarrollo.
