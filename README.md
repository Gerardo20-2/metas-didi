# Telemetría DiDi — Septiembre 2026

Dashboard de telemetría financiera y rendimiento operativo para conductor de plataforma.
Un único archivo autónomo (`index.html`) que corre en cualquier navegador móvil sin build ni servidor.

## Cómo usarlo

Abre `index.html` en el navegador del teléfono (o publícalo en GitHub Pages y guárdalo
en la pantalla de inicio). No necesita instalación ni conexión tras la primera carga.

## Datos

- Persistencia en `localStorage` bajo la clave **`didi-tracker-app`**.
- Estructura de cada día intacta respecto a la versión anterior:
  `id`, `dateString`, `dayName`, `goal`, `earned`, `gas`.
- Migración no destructiva: los registros previos se conservan tal cual y solo se
  completan los campos faltantes contra la plantilla base del mes (30 días de
  Septiembre 2026 con las metas por defecto: 400 lunes/miércoles/jueves,
  150 martes/viernes, 1000 sábados/domingos).

## Motor de telemetría

| Métrica | Cálculo |
| --- | --- |
| Utilidad neta real | `bruto − gasolina` |
| Tasa de retorno / margen operativo | `neto / bruto × 100` |
| Índice de eficiencia de combustible | `gasolina / bruto × 100` |
| Proyección mensual (run-rate) | `promedio diario de jornadas trabajadas × 30`, bruto y neto |
| Efectividad de jornadas | días con meta cumplida vs. días con ingreso registrado |
| Neto por día | `earned − gas`, con margen e indicador de color por tarjeta |

## Interfaz

- Dark mode sobre `slate-950`, tarjetas `slate-900` con bordes `slate-700/50`.
- Sparkline SVG nativo con meta acumulada, ingreso real acumulado y proyección punteada.
- Detección del día actual (`new Date().getDate()`): badge **HOY** y botón de salto directo.
- Filtros: Todos · Cumplidos (≥100%) · Progreso (<100% y >0) · Sin registro ($0).

## Herramientas de datos

Desde el ícono de la barra superior:

- **Exportar respaldo** — `.json` con timestamp (`didi-respaldo-AAAAMMDD-HHMM.json`).
- **Importar respaldo** — restaura desde un `.json` exportado.
- **Exportar a CSV** — `ID, Fecha, Día, Meta, Bruto, Gasolina, Neto, Cumplimiento %`,
  con BOM UTF-8 y fila de totales para abrir directo en Excel.
- **Limpiar registros** — confirmación de dos pasos.

## Stack

React 18 + Babel standalone + Tailwind CSS, todos por CDN. Iconografía SVG inline,
sin dependencias de fuentes de iconos. Los campos monetarios son `inputMode="decimal"`
con saneamiento de teclado que impide `NaN`, signos, notación científica o puntos duplicados.
