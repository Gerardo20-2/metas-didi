# Telemetría DiDi Pro

Cockpit operativo de flujo de caja real para conductor de plataforma.
Un único archivo autónomo (`index.html`) que corre en cualquier navegador móvil, sin build ni servidor,
e instalable como app gracias a un manifest PWA embebido.

## Uso

Abre `index.html` en el navegador del teléfono y usa "Añadir a pantalla de inicio".
El manifest (`display: standalone`, fondo `#020617`) y el icono de tacómetro van embebidos como Data URI,
así que funciona igual servido por `file://` o por un servidor local.

## Arquitectura de datos

| Clave | Contenido |
| --- | --- |
| `didi_telemetry_meta` | Mes activo, metas por defecto, ticket y meta por hora, estrategia de cuota, modo sigilo |
| `didi_data_YYYY_MM` | Un registro por mes (ej. `didi_data_2026_09`) |
| `didi-tracker-app` | Clave original: se migra a `didi_data_2026_09` y se mantiene sincronizada |

- **Migración transparente:** al arrancar, si existe `didi-tracker-app` y aún no hay partición de
  Septiembre 2026, se copia sin alterar un solo peso. La clave original nunca se borra y sigue
  recibiendo los cambios de ese mes, así que la versión anterior del archivo la sigue abriendo.
- **Campos por día:** `id`, `dateString`, `dayName`, `goal`, `earned`, `gas` (esquema original, intacto)
  más los opcionales `hours`, `km`, `tolls`, `wash`, `misc`.
- **Calendario real:** los días de cada mes y su día de la semana se calculan con `new Date`,
  incluyendo años bisiestos (Febrero 2028 rinde 29 tarjetas).

## Modelo financiero: caja real de bolsillo

`earned` es el **depósito neto** que la plataforma ya transfirió: comisiones, ISR e IVA quedaron
retenidos en origen. La app nunca vuelve a descontarle nada que no haya salido de la cartera,
y no modela amortizaciones ni provisiones teóricas.

```
Ganancia real de bolsillo = depositado − gasolina − casetas − lavado − varios
Retención de combustible  = gasolina / depositado × 100
Tasa de retorno efectiva  = bolsillo / depositado × 100
```

| Métrica | Cálculo |
| --- | --- |
| Punto de equilibrio diario | Depósito mínimo para cubrir el efectivo del turno (`gasolina + gastos de ruta`) |
| Cuota diaria requerida | Brecha de meta repartida entre las jornadas pendientes |
| Por jornada | `$/hr` de bolsillo, `$/km` de gasolina y gasto total por km |

## Proyección estratificada por perfil de día

La demanda de un sábado no se parece a la de un martes, así que la proyección abandona el
promedio plano: cada jornada pendiente se estima con la **media observada de su propio día
de la semana**, y si ese día todavía no tiene registros cae de vuelta a su meta programada.

```
Proyección = acumulado real + Σ media(día_semana(d))  para cada día pendiente d
```

Los perfiles se agrupan además en demanda base (lunes a jueves) y alta demanda (viernes a domingo).

## Rebalanceo dinámico de metas

Un conmutador en el tablero decide qué hacer con el excedente:

- **Alivio de jornada:** reparte lo que falta entre las jornadas pendientes y muestra cuánto
  menos necesitas ganar cada día para cerrar igual el 100% de la meta mensual.
- **Modo récord:** mantiene las metas diarias fijas y proyecta con cuánto cierras por encima.
- **Días de descanso ganados:** excedente acumulado dividido entre el ingreso medio por jornada.

## Velocímetro de turno

Con las horas capturadas, la tarjeta del día compara el ritmo real (`depositado / horas`) contra
el objetivo (`meta / horas`) y estima el cierre: *"a este ritmo, liberas la meta en ~2 h 15 min"*.

## Ficha de rendimiento en Canvas

El menú exporta una imagen PNG de **1080×1920** (lienzo lógico de 540×960 escalado a 2x DPI)
dibujada con la API nativa de `<canvas>`, sin html2canvas: encabezado del mes, cifra monumental
de bolsillo, seis métricas clave, curva de avance trazada sobre el propio canvas, efectividad
de jornadas y mejor día.

## Modelos predictivos

| Modelo | Qué resuelve |
| --- | --- |
| **Monte Carlo** (1,000 iteraciones) | Probabilidad empírica de cerrar la meta. Muestrea cada día restante de una normal `N(μ, σ)` truncada en cero, generada por transformación de Box-Muller sobre el histórico de jornadas. Devuelve P5/P50/P95 y el rango de confianza al 90%. |
| **Suavizado de Holt** (α=0.3, β=0.1) | Nivel y tendencia amortiguados para proyectar el bruto de la próxima jornada sin que un día atípico arrastre la estimación. |
| **OEE de conducción** | `Disponibilidad × Desempeño × Calidad`: días trabajados sobre programados, $/hr real contra el benchmark configurable y retorno efectivo sobre el depósito. |
| **Elasticidad del combustible** | Derivada discreta `Δbolsillo/Δgasolina` sobre las jornadas ordenadas por gasto, con detección del punto de inflexión donde rodar más deja de pagarse. |

El abanico P10–P90 del gráfico se traza analíticamente: la suma de *k* jornadas i.i.d. normales
es normal con media `k·μ` y desviación `σ·√k`, así que el percentil sale de la cuantil normal sin
guardar una matriz de 1,000 × días. El Monte Carlo usa una sola `Float64Array` de 1,000 totales:
la simulación completa corre en ~2 ms.

## Control estadístico (SPC)

Sobre la utilidad neta de las jornadas trabajadas: media (μ), desviación estándar (σ),
coeficiente de variación y límites de control a 1.5σ.
CV <20% operación predecible · 20–40% variabilidad moderada · >40% operación errática.
Los días fuera de los límites quedan marcados en su tarjeta (▲ pico / ▼ bajo) y son
navegables desde el panel.

## Visualización (SVG puro, sin librerías)

- **Doble área acumulada**: la curva de depósito y la de bolsillo, con el hueco entre ambas
  relleno en carmesí — ese hueco es exactamente el combustible y la ruta que se comieron el mes.
  El inspector táctil reporta fecha, depositado, gasolina y bolsillo acumulados.
- **Campana de densidad**: histograma de las jornadas con la normal ajustada superpuesta,
  marcando μ y la meta diaria media.
- **Abanico Monte Carlo**: banda sombreada P10–P90 proyectada hasta el cierre del mes sobre la curva acumulada.
- **Tacómetro radial** de 240° con graduación, arco animado por `stroke-dashoffset` y gradiente
  ámbar→esmeralda: mide la *eficiencia de pacing*, el avance de la meta contra el avance del calendario.
- **Interpolación Bézier cúbica** (Catmull-Rom con los controles acotados al tramo por `min`/`max`,
  de modo que también funciona en el borde inferior de un área cerrada, que se recorre al revés).
- **Matriz de productividad** tipo calendario: cada celda colorea el cumplimiento del día
  y al tocarla salta a su tarjeta.
- **Rentabilidad por día de la semana**: promedio de utilidad neta de lunes a domingo.

## Ergonomía en cabina

Diseñada para operarse con una mano, con el teléfono en el soporte y el coche en movimiento.

- **Dock de zona del pulgar:** todo lo accionable en marcha (dial de registro, switch de descanso,
  deshacer y filtros) vive fijo en la franja inferior. Las gráficas y KPIs quedan arriba como
  zona de lectura pasiva.
- **Objetivos táctiles:** ningún control del dock baja de 54 px; el dial usa botones de 64 px
  con separación generosa para tolerar el pulso en movimiento.
- **Buffer de deshacer:** cualquier toque en falso se revierte durante 5 segundos desde el dock.
- **Contraste AAA:** la tipografía crítica se mantiene por encima de 7:1 sobre `#0f172a`
  (etiquetas en `slate-300` a 12:1, cifras en `emerald-400` a 9.3:1, negativos en `rose-300` a 9.4:1).
- **Confirmación sonora:** pulsos sintetizados con `AudioContext` (440 Hz al tocar, 660→880 Hz al
  registrar, doble tono en hitos), sin archivos externos y desactivables desde el menú.
  Se combinan con patrones hápticos (`navigator.vibrate([15, 30, 15])` al cerrar un hito).
- **HUD de cabina:** vista a pantalla completa para el soporte del vehículo, con tipografía
  monumental, anillo de progreso hacia la meta del día, cuánto falta, a cuántos viajes equivale
  y botones de inyección rápida de `+$50`, `+$100`, `+$150` y `+$200`.
- **Gestos de deslizamiento:** arrastra una tarjeta a la derecha para cerrar el día justo en su
  meta, o a la izquierda para marcarlo como jornada de descanso. El umbral son 74 px, con
  resistencia elástica más allá y vibración al armarse; soltar antes del umbral cancela.
- **Modo sigilo:** el botón del ojo enmascara todos los montos (`$ ••••` y desenfoque) y deja
  visibles los porcentajes, para consultar el tablero con pasajeros a bordo.
- **Turno en caliente:** cuánto falta para la meta del día, a cuántos viajes equivale según el
  ticket promedio y botones rápidos para sumar el viaje recién cerrado.
- **Háptica:** micro-vibración de 15 ms al modificar un valor, donde el dispositivo la soporte.

## Herramientas de respaldo

- Exportar solo el mes (`didi-mes-YYYY-MM.json`) o la base histórica completa.
- Importador inteligente: acepta el array original, el mes con metadatos y el histórico multimes;
  fusiona sin tocar los meses que el archivo no incluye.
- CSV con BOM UTF-8: `ID, Fecha, Día, Meta, Depositado, Gasolina, Horas, Km, $/hr Bolsillo,
  Casetas, Lavado, Varios, Costo Vehicular, Neto Real` y fila de totales.
- Exportar la ficha de rendimiento como PNG 1080×1920.
- Copiar resumen ejecutivo al portapapeles, listo para WhatsApp.
- Limpieza del mes visible con confirmación de dos pasos (los demás meses no se tocan).

## Motion

Sin librerías de animación: todo es `transform`/`opacity` acelerado por GPU, `requestAnimationFrame`
y SVG. El hook `useAnimatedNumber` interpola las cifras grandes como un odómetro, aislado en el
componente `AnimatedCash` para que la animación no repinte el resto del tablero. Las tarjetas que
cruzan el 100% reciben un destello y un glow esmeralda pulsante. Todo respeta
`prefers-reduced-motion`.

## Stack

React 18, ReactDOM 18 y Babel Standalone desde cdnjs, más Tailwind CSS por CDN.
Cero librerías de gráficos, iconos, animación ni matemáticas: todo es SVG inline, CSS y `Math` nativo.
La matemática vive en hooks desacoplados del render (`useFinancialTelemetry`, `useBreakEven`,
`useAnimatedNumber`); los cálculos pesados van en `useMemo`, los handlers en `useCallback` y las
tarjetas están memoizadas con estadísticas diferidas (`useDeferredValue`) para que escribir no
dispare el recálculo de las 31 tarjetas.

Nota: al abrir Septiembre 2026 sin datos previos, el día 1 conserva la semilla histórica
de $189.61 que traía el archivo original.
