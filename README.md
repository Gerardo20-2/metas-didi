# Telemetría DiDi Pro

Cockpit operativo de gestión financiera y vehicular para conductor de plataforma.
Un único archivo autónomo (`index.html`) que corre en cualquier navegador móvil, sin build ni servidor,
e instalable como app gracias a un manifest PWA embebido.

## Uso

Abre `index.html` en el navegador del teléfono y usa "Añadir a pantalla de inicio".
El manifest (`display: standalone`, fondo `#020617`) y el icono de tacómetro van embebidos como Data URI,
así que funciona igual servido por `file://` o por un servidor local.

## Arquitectura de datos

| Clave | Contenido |
| --- | --- |
| `didi_telemetry_meta` | Mes activo, metas por defecto, parámetros de costo, modo sigilo |
| `didi_data_YYYY_MM` | Un registro por mes (ej. `didi_data_2026_09`) |
| `didi-tracker-app` | Clave original: se migra a `didi_data_2026_09` y se mantiene sincronizada |

- **Migración transparente:** al arrancar, si existe `didi-tracker-app` y aún no hay partición de
  Septiembre 2026, se copia sin alterar un solo peso. La clave original nunca se borra y sigue
  recibiendo los cambios de ese mes, así que la versión anterior del archivo la sigue abriendo.
- **Campos por día:** `id`, `dateString`, `dayName`, `goal`, `earned`, `gas` (esquema original, intacto)
  más los opcionales `hours`, `km`, `tolls`, `wash`, `misc`.
- **Calendario real:** los días de cada mes y su día de la semana se calculan con `new Date`,
  incluyendo años bisiestos (Febrero 2028 rinde 29 tarjetas).

## Modelo financiero

```
Costo operativo = gasolina + km × (desgaste + depreciación) + casetas + lavado + varios
Utilidad neta real = bruto − costo operativo
```

Los parámetros por kilómetro se editan en el menú (por defecto $0.45 de desgaste mecánico y
neumáticos y $0.35 de depreciación y seguro prorrateado, $0.80/km en total).

| Métrica | Cálculo |
| --- | --- |
| Margen operativo real | `neto real / bruto × 100` |
| Ratio de combustible | `gasolina / bruto × 100` |
| Cuota diaria requerida | `brecha de meta / días sin registro` (o "meta superada por +$X") |
| Proyección run-rate | `promedio por jornada trabajada × días del mes`, bruta y neta |
| Efectividad | días con meta cumplida vs. días con ingreso |
| Por jornada | `$/hr` neto, `$/km` de gasolina, desgaste y costo total por km |

Si el gasto de gasolina por kilómetro de un día supera en 25% el promedio del mes, la tarjeta
levanta un aviso de consumo alto (tráfico pesado o ineficiencia).

## Punto de equilibrio y finanzas defensivas

**Break-even diario dinámico:** el umbral en bruto que la jornada necesita solo para pagarse
(`gasolina + km × costo por km + casetas + lavado + varios`). Cada tarjeta y el resumen mensual
declaran el estado: *en zona de déficit* (con el faltante para llegar a tablas), *punto de equilibrio
alcanzado* o *utilidad neta positiva* (con lo que queda limpio).

**Sobres virtuales:** provisiones calculadas sobre el bruto acumulado, configurables en el menú.

| Sobre | Por defecto | Para qué |
| --- | --- | --- |
| Mantenimiento y amortización | 8% | Llantas, frenos, servicio, póliza |
| Resguardo fiscal y plataforma | 2.5% | Colchón de retenciones e impuestos |
| Flujo libre de bolsillo | — | `neto real − provisiones` |

**Simulador de sensibilidad:** dos sliders (precio del combustible de −15% a +25%, jornadas
adicionales de +1 a +5) que recalculan en vivo el neto simulado, el neto por jornada extra,
el sobrecosto de combustible en esas jornadas y el impacto si el alza dura todo el mes.

## Modelos predictivos

| Modelo | Qué resuelve |
| --- | --- |
| **Monte Carlo** (1,000 iteraciones) | Probabilidad empírica de cerrar la meta. Muestrea cada día restante de una normal `N(μ, σ)` truncada en cero, generada por transformación de Box-Muller sobre el histórico de jornadas. Devuelve P5/P50/P95 y el rango de confianza al 90%. |
| **Suavizado de Holt** (α=0.3, β=0.1) | Nivel y tendencia amortiguados para proyectar el bruto de la próxima jornada sin que un día atípico arrastre la estimación. |
| **OEE de conducción** | `Disponibilidad × Desempeño × Calidad`: días trabajados sobre programados, $/hr real contra el benchmark configurable y margen neto sobre bruto. |
| **Elasticidad del combustible** | Derivada discreta `Δneto/Δgasolina` sobre las jornadas ordenadas por gasto, con detección del punto de inflexión donde rodar más deja de pagarse. |

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

- **Campana de densidad**: histograma de las jornadas con la normal ajustada superpuesta,
  marcando μ y la meta diaria media.
- **Abanico Monte Carlo**: banda sombreada P10–P90 proyectada hasta el cierre del mes sobre la curva acumulada.
- **Tacómetro radial** de 240° con graduación, arco animado por `stroke-dashoffset` y gradiente
  ámbar→esmeralda: mide la *eficiencia de pacing*, el avance de la meta contra el avance del calendario.
- **Curva de acumulación** con interpolación Bézier cúbica (Catmull-Rom con los controles acotados
  al tramo, así una serie acumulada nunca oscila), meta acumulada, real acumulado, proyección punteada
  e **inspector táctil**: arrastra el dedo para ver fecha, meta acumulada, real acumulado y neto del día.
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
- CSV con BOM UTF-8: `ID, Fecha, Día, Meta, Bruto, Gasolina, Neto, Cumplimiento %, Horas, Km, $/hr,
  Casetas, Lavado, Varios, Costo Vehicular, Neto Real` y fila de totales.
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
