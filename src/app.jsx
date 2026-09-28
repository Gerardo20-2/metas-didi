/* Fuente JSX de la app. Se compila a js/app.js con `npm run build`. */
        const { useState, useEffect, useMemo, useRef, useCallback, useContext, useDeferredValue,
                createContext, memo, forwardRef } = React;

        /* ============================================================================
           1. CONSTANTES DE DOMINIO
           ============================================================================ */
        const META_KEY   = 'didi_telemetry_meta';   // configuración y metadatos
        const DATA_PREFIX = 'didi_data_';           // partición por mes: didi_data_YYYY_MM
        const LEGACY_KEY = 'didi-tracker-app';      // esquema original (mes único)
        const LEGACY_YEAR = 2026;
        const LEGACY_MONTH = 8;                     // Septiembre (0-based)

        const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                             'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        /* Etiqueta corta usada en dateString. 'Sept' se conserva idéntica al archivo original. */
        const MONTH_TAG = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                           'Jul', 'Ago', 'Sept', 'Oct', 'Nov', 'Dic'];

        const DAYS_OF_WEEK = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const DAY_SHORT    = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        /* Orden de columnas del heatmap y del gráfico semanal: lunes a domingo */
        const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

        /* Metas por defecto heredadas del archivo original, indexadas por día de la semana */
        const DEFAULT_GOALS = { 0: 1000, 1: 400, 2: 150, 3: 400, 4: 400, 5: 150, 6: 1000 };

        /* Parámetros operativos. Sin modelos teóricos: el dinero es el que entra y sale.
           `earned` ya es el depósito neto de DiDi (comisiones e impuestos retenidos en origen),
           así que la app nunca vuelve a descontarle nada que no sea un gasto real del turno. */
        const DEFAULT_COSTS = {
            avgTicket: 65,      // ticket promedio por viaje, para el calculador de turno
            targetHourly: 120   // $/hr objetivo, benchmark del componente Desempeño del OEE
        };

        /* Campos monetarios/numéricos editables de cada jornada */
        const NUMERIC_FIELDS = ['goal', 'earned', 'gas', 'hours', 'km', 'tolls', 'wash', 'misc',
                                'cashCollected', 'appDeposit'];

        /* Campos del tablero DiDi + odómetro. `timeOnline` y `timeActive` admiten minutos
           ("450") o formato reloj ("7:30"), por eso no pasan por el saneamiento monetario. */
        const OPS_FIELDS = ['kmStart', 'kmEnd', 'kmDidi', 'timeOnline', 'timeActive', 'trips'];

        const COLORS = {
            emerald: '#10b981',
            amber: '#f59e0b',
            cyan: '#0ea5e9',
            crimson: '#f43f5e',
            slate800: '#1e293b',
            slate700: '#334155',
            slate500: '#64748b',
            slate300: '#cbd5e1'
        };

        /* ============================================================================
           2. UTILIDADES NUMÉRICAS, DE FECHA Y DE FORMATO
           ============================================================================ */
        const num = (value) => {
            if (value === '' || value === null || value === undefined) return 0;
            const parsed = parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const hasValue = (value) => value !== '' && value !== null && value !== undefined && num(value) !== 0;

        /* Saneamiento defensivo: solo dígitos y un punto decimal.
           Bloquea signos, notación científica, separadores duplicados y basura pegada. */
        const sanitizeMoney = (raw) => {
            let value = String(raw === null || raw === undefined ? '' : raw)
                .replace(/,/g, '.')
                .replace(/[^0-9.]/g, '');
            const parts = value.split('.');
            if (parts.length > 2) value = parts[0] + '.' + parts.slice(1).join('');
            const [intPart, decPart] = value.split('.');
            const safeInt = (intPart || '').slice(0, 7);
            if (decPart === undefined) return safeInt;
            return safeInt + '.' + decPart.slice(0, 2);
        };

        /* Enteros sin decimales (conteo de viajes) */
        const sanitizeInt = (raw) => String(raw === null || raw === undefined ? '' : raw)
            .replace(/[^0-9]/g, '').slice(0, 5);

        /* Duración: minutos ("450") o reloj ("7:30"). Un solo separador, a lo más 2 dígitos de minutos. */
        const sanitizeDuration = (raw) => {
            const value = String(raw === null || raw === undefined ? '' : raw)
                .replace(/[.hH]/g, ':')
                .replace(/[^0-9:]/g, '');
            const [head, ...rest] = value.split(':');
            if (rest.length === 0) return head.slice(0, 4);
            return head.slice(0, 2) + ':' + rest.join('').slice(0, 2);
        };

        /* Convierte la duración capturada a minutos; null si está vacía o es inválida */
        const parseDuration = (value) => {
            const text = String(value === null || value === undefined ? '' : value).trim();
            if (!text) return null;
            if (text.includes(':')) {
                const [h, m] = text.split(':');
                const hours = Number(h || 0);
                const minutes = Number(m || 0);
                if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes >= 60) return null;
                const total = hours * 60 + minutes;
                return total > 0 ? total : null;
            }
            const minutes = Number(text);
            return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
        };

        const durationText = (minutes) => {
            if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
            const h = Math.floor(minutes / 60);
            const m = Math.round(minutes - h * 60);
            return `${h} h ${String(m).padStart(2, '0')} min`;
        };

        const money = (value, decimals = 2) => num(value).toLocaleString('es-MX', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });

        const moneyShort = (value) => {
            const n = num(value);
            if (Math.abs(n) >= 1000) return (n / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + 'k';
            return n.toLocaleString('es-MX', { maximumFractionDigits: 0 });
        };

        const pctText = (value, decimals = 1) => (Number.isFinite(value) ? value : 0).toFixed(decimals) + '%';

        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

        const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();

        const monthKeyOf = (year, monthIndex) =>
            `${DATA_PREFIX}${year}_${String(monthIndex + 1).padStart(2, '0')}`;

        const monthLabel = (year, monthIndex) => `${MONTH_NAMES[monthIndex]} ${year}`;

        const monthId = (year, monthIndex) => `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

        const parseMonthId = (value) => {
            const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
            if (!match) return null;
            const year = Number(match[1]);
            const monthIndex = Number(match[2]) - 1;
            if (monthIndex < 0 || monthIndex > 11) return null;
            return { year, monthIndex };
        };

        const shiftMonth = (year, monthIndex, delta) => {
            const date = new Date(year, monthIndex + delta, 1);
            return { year: date.getFullYear(), monthIndex: date.getMonth() };
        };

        const getPercentage = (earned, goal) => {
            const e = num(earned);
            const g = num(goal);
            if (g <= 0) return e > 0 ? 100 : 0;
            return Math.min((e / g) * 100, 1000);
        };

        const getDayStatus = (day) => {
            const earned = num(day.earned);
            if (earned <= 0) return 'sin';
            const goal = num(day.goal);
            if (goal <= 0 || earned >= goal) return 'cumplido';
            return 'pendiente';
        };

        /* ---------------------------------------------------------------------------
           Realimentación sensorial: audio sintetizado + patrones hápticos.
           Sin archivos externos; el AudioContext se crea en el primer gesto real del
           usuario, que es cuando el navegador permite arrancarlo.
           --------------------------------------------------------------------------- */
        const audio = {
            ctx: null,
            enabled: true,
            unlock() {
                if (this.ctx) return this.ctx;
                try {
                    const Ctor = window.AudioContext || window.webkitAudioContext;
                    if (!Ctor) return null;
                    this.ctx = new Ctor();
                } catch (err) {
                    this.ctx = null;
                }
                return this.ctx;
            },
            tone(frequency, durationMs, peakGain) {
                if (!this.enabled) return;
                const ctx = this.unlock();
                if (!ctx) return;
                try {
                    if (ctx.state === 'suspended') ctx.resume();
                    const now = ctx.currentTime;
                    const seconds = durationMs / 1000;
                    const oscillator = ctx.createOscillator();
                    const gain = ctx.createGain();
                    oscillator.type = 'sine';
                    oscillator.frequency.setValueAtTime(frequency, now);
                    /* Envolvente corta: ataque de 4 ms y caída exponencial, sin clics */
                    gain.gain.setValueAtTime(0.0001, now);
                    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.004);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
                    oscillator.connect(gain);
                    gain.connect(ctx.destination);
                    oscillator.start(now);
                    oscillator.stop(now + seconds + 0.02);
                    oscillator.onended = () => { try { gain.disconnect(); } catch (e) { /* ya liberado */ } };
                } catch (err) { /* audio no disponible en este dispositivo */ }
            }
        };

        const vibrate = (pattern) => {
            try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (err) { /* sin soporte */ }
        };

        /* Tres niveles de confirmación, audibles sin mirar la pantalla */
        const feedback = {
            tap() { audio.tone(440, 40, 0.04); vibrate(12); },
            confirm() { audio.tone(660, 40, 0.05); vibrate(18); setTimeout(() => audio.tone(880, 40, 0.045), 46); },
            milestone() { audio.tone(660, 45, 0.05); setTimeout(() => audio.tone(880, 60, 0.06), 55); vibrate([15, 30, 15]); },
            warn() { audio.tone(300, 70, 0.05); vibrate([10, 40, 10]); }
        };

        /* Micro-vibración háptica, limitada para no saturar al teclear */
        let lastHaptic = 0;
        const haptic = (ms = 15) => {
            try {
                const now = Date.now();
                if (now - lastHaptic < 160) return;
                lastHaptic = now;
                if (navigator.vibrate) navigator.vibrate(ms);
            } catch (err) { /* dispositivo sin soporte: se ignora */ }
        };

        /* ============================================================================
           3. CAPA DE ALMACENAMIENTO MULTI-MES
           ============================================================================ */
        const safeGet = (key) => {
            try { return localStorage.getItem(key); } catch (err) { return null; }
        };
        const safeSet = (key, value) => {
            try { localStorage.setItem(key, value); return true; } catch (err) { return false; }
        };
        const safeParse = (raw) => {
            if (!raw) return null;
            try { return JSON.parse(raw); } catch (err) { return null; }
        };

        const normalizeMeta = (raw) => {
            const base = raw && typeof raw === 'object' ? raw : {};
            const costs = base.costs && typeof base.costs === 'object' ? base.costs : {};
            const goals = base.defaultGoals && typeof base.defaultGoals === 'object' ? base.defaultGoals : {};
            const mergedGoals = {};
            for (let wd = 0; wd < 7; wd += 1) {
                const stored = Number(goals[wd]);
                mergedGoals[wd] = Number.isFinite(stored) ? stored : DEFAULT_GOALS[wd];
            }
            return {
                version: 2,
                activeMonth: typeof base.activeMonth === 'string' ? base.activeMonth : null,
                stealth: base.stealth === true,
                sound: base.sound !== false,          // realimentación sonora activa por defecto
                defaultGoals: mergedGoals,
                pacingMode: base.pacingMode === 'record' ? 'record' : 'relief',
                /* Base contable de la vista: caja pura o consumo devengado */
                accountingBasis: base.accountingBasis === 'accrual' ? 'accrual' : 'cash',
                /* Conciliaciones bancarias por semana: { '2026-09': { 1: {bank, reconciled} } } */
                settlements: base.settlements && typeof base.settlements === 'object' ? base.settlements : {},
                costs: {
                    avgTicket: Number(costs.avgTicket) > 0 ? Number(costs.avgTicket) : DEFAULT_COSTS.avgTicket,
                    targetHourly: Number(costs.targetHourly) > 0
                        ? Number(costs.targetHourly) : DEFAULT_COSTS.targetHourly
                }
            };
        };

        const readMeta = () => normalizeMeta(safeParse(safeGet(META_KEY)));
        const writeMeta = (meta) => safeSet(META_KEY, JSON.stringify(normalizeMeta(meta)));

        /* Construye el calendario real del mes: 28, 29, 30 o 31 días según corresponda */
        const buildMonth = (year, monthIndex, defaultGoals) => {
            const goals = defaultGoals || DEFAULT_GOALS;
            const total = daysInMonth(year, monthIndex);
            const isLegacyMonth = year === LEGACY_YEAR && monthIndex === LEGACY_MONTH;
            return Array.from({ length: total }, (_, i) => {
                const date = new Date(year, monthIndex, i + 1);
                const weekday = date.getDay();
                return {
                    id: i + 1,
                    dateString: `${i + 1} ${MONTH_TAG[monthIndex]}`,
                    dayName: DAYS_OF_WEEK[weekday],
                    goal: Number.isFinite(Number(goals[weekday])) ? Number(goals[weekday]) : 0,
                    /* Semilla histórica del archivo original (1 Sept 2026) */
                    earned: isLegacyMonth && i === 0 ? 189.61 : '',
                    gas: '',
                    hours: '',
                    km: '',
                    tolls: '',
                    wash: '',
                    misc: '',
                    cashCollected: '',   // efectivo cobrado en mano
                    appDeposit: '',      // saldo liquidado por la billetera de la app
                    /* Tablero DiDi y odómetro */
                    kmStart: '', kmEnd: '', kmDidi: '',
                    timeOnline: '', timeActive: '', trips: ''
                };
            });
        };

        /* Fusión no destructiva: lo guardado manda, la plantilla solo rellena huecos */
        const mergeMonth = (stored, base) => {
            if (!Array.isArray(stored) || stored.length === 0) return base;
            const byId = new Map();
            base.forEach(day => byId.set(day.id, day));

            stored.forEach((entry, index) => {
                if (!entry || typeof entry !== 'object') return;
                const parsedId = Number(entry.id);
                const id = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : index + 1;
                const template = byId.get(id) || {
                    id: id,
                    dateString: `${id}`,
                    dayName: '',
                    goal: 0, earned: '', gas: '', hours: '', km: '', tolls: '', wash: '', misc: '',
                    cashCollected: '', appDeposit: '',
                    kmStart: '', kmEnd: '', kmDidi: '', timeOnline: '', timeActive: '', trips: ''
                };
                const merged = { ...template, ...entry, id: id };
                merged.dateString = entry.dateString || template.dateString;
                merged.dayName = entry.dayName || template.dayName;
                merged.goal = entry.goal === undefined || entry.goal === null ? template.goal : entry.goal;
                [...NUMERIC_FIELDS, ...OPS_FIELDS].forEach(field => {
                    if (field === 'goal') return;
                    const value = entry[field];
                    merged[field] = value === undefined || value === null ? '' : value;
                });
                byId.set(id, merged);
            });

            return Array.from(byId.values()).sort((a, b) => a.id - b.id);
        };

        const loadMonth = (year, monthIndex, defaultGoals) => {
            const base = buildMonth(year, monthIndex, defaultGoals);
            const stored = safeParse(safeGet(monthKeyOf(year, monthIndex)));
            return mergeMonth(stored, base);
        };

        const saveMonth = (year, monthIndex, days) => {
            const payload = JSON.stringify(days);
            const ok = safeSet(monthKeyOf(year, monthIndex), payload);
            /* Espejo hacia la clave original para que la versión anterior siga abriendo el mes */
            if (ok && year === LEGACY_YEAR && monthIndex === LEGACY_MONTH) safeSet(LEGACY_KEY, payload);
            return ok;
        };

        const listStoredMonths = () => {
            const found = [];
            try {
                for (let i = 0; i < localStorage.length; i += 1) {
                    const key = localStorage.key(i);
                    const match = /^didi_data_(\d{4})_(\d{2})$/.exec(key || '');
                    if (!match) continue;
                    const year = Number(match[1]);
                    const monthIndex = Number(match[2]) - 1;
                    if (monthIndex < 0 || monthIndex > 11) continue;
                    found.push({ year, monthIndex, id: monthId(year, monthIndex) });
                }
            } catch (err) { /* almacenamiento bloqueado */ }
            return found.sort((a, b) => (a.year - b.year) || (a.monthIndex - b.monthIndex));
        };

        /* Migración transparente del esquema legacy a la partición didi_data_2026_09.
           La clave original NO se borra: queda intacta como respaldo. */
        const migrateLegacy = (defaultGoals) => {
            const legacy = safeParse(safeGet(LEGACY_KEY));
            if (!Array.isArray(legacy) || legacy.length === 0) return false;
            const targetKey = monthKeyOf(LEGACY_YEAR, LEGACY_MONTH);
            if (safeGet(targetKey)) return false;
            const merged = mergeMonth(legacy, buildMonth(LEGACY_YEAR, LEGACY_MONTH, defaultGoals));
            return safeSet(targetKey, JSON.stringify(merged));
        };

        /* ============================================================================
           5. MOTOR DE CÁLCULO: COSTO REAL POR JORNADA
           ============================================================================ */
        /* Flujo de caja real por día. `earned` ya es el depósito libre de la plataforma:
           la app solo le resta dinero que salió de la cartera del conductor.
           Salidas = gasolina + casetas + lavado + misceláneos de ruta
           Bolsillo real   = depositado - gasolina - gastos de ruta                    */
        const computeDay = (day, costs, accrual) => {
            const goal = num(day.goal);
            const earned = num(day.earned);        // ingreso líquido reconocido (ya depositado)
            const gasPaid = num(day.gas);          // combustible pagado ese día (base caja)
            const hours = num(day.hours);
            const km = num(day.km);
            const tolls = num(day.tolls);
            const wash = num(day.wash);
            const misc = num(day.misc);
            const cashCollected = num(day.cashCollected);
            const appDeposit = num(day.appDeposit);

            /* Base devengada: el combustible se imputa por consumo (km del día x costo medio
               ponderado del mes), no por la fecha en que se llenó el tanque. La suma mensual
               se conserva intacta porque el costo medio sale de ese mismo total. */
            const accrualRate = accrual && accrual.mode === 'accrual' ? num(accrual.ratePerKm) : 0;
            const gasAccrued = accrualRate > 0 ? km * accrualRate : gasPaid;
            const usesAccrual = accrualRate > 0;
            const gas = usesAccrual ? gasAccrued : gasPaid;

            /* Cascada del estado de resultados */
            const directCosts = gas + tolls;               // costos variables de ruta
            const contributionMargin = earned - directCosts;
            const opex = wash + misc;                      // gastos auxiliares de cabina
            const operatingCashFlow = contributionMargin - opex;

            const cashOut = directCosts + opex;
            const pocket = operatingCashFlow;              // bottom line = flujo de caja libre

            /* Arqueo: efectivo físico que queda tras pagar la ruta de la propia mano */
            const declaredSplit = cashCollected > 0 || appDeposit > 0;
            const cashOnHand = cashCollected - (gasPaid + tolls + misc);
            const splitDelta = declaredSplit ? (cashCollected + appDeposit) - earned : 0;

            const targetHourly = num(costs.targetHourly) > 0 ? num(costs.targetHourly) : DEFAULT_COSTS.targetHourly;
            const realHourly = hours > 0 ? earned / hours : null;
            const requiredHourly = hours > 0 && goal > 0 ? goal / hours : null;
            const remainingToGoal = Math.max(goal - earned, 0);
            const hoursToGoal = realHourly !== null && realHourly > 0 && remainingToGoal > 0
                ? remainingToGoal / realHourly
                : null;

            const safetyRatio = earned > 0 ? (contributionMargin / earned) * 100 : 0;
            const safetyBand = earned <= 0 ? 'idle'
                : safetyRatio >= 65 ? 'healthy'
                : safetyRatio >= 40 ? 'caution'
                : 'critical';

            return {
                goal, earned, hours, km, tolls, wash, misc,
                gasPaid, gasAccrued, gas, usesAccrual,
                cashCollected, appDeposit, declaredSplit, cashOnHand, splitDelta,
                directCosts, contributionMargin, opex, operatingCashFlow,
                routeCash: tolls + wash + misc,
                cashOut, pocket,
                hasData: earned > 0 || gasPaid > 0 || tolls + wash + misc > 0 || km > 0 || hours > 0,
                breakEven: cashOut,
                breakEvenGap: cashOut - earned,
                coverage: cashOut > 0 ? Math.min((earned / cashOut) * 100, 999) : (earned > 0 ? 100 : 0),
                percentage: getPercentage(earned, goal),
                status: getDayStatus(day),
                returnRate: earned > 0 ? (operatingCashFlow / earned) * 100 : 0,
                contributionRatio: earned > 0 ? (contributionMargin / earned) * 100 : 0,
                fuelRetention: earned > 0 ? (gas / earned) * 100 : 0,
                routeRatio: earned > 0 ? ((tolls + wash + misc) / earned) * 100 : 0,
                safetyRatio, safetyBand,
                realHourly, requiredHourly, hoursToGoal, targetHourly,
                pocketPerHour: hours > 0 ? operatingCashFlow / hours : null,
                costPerServiceHour: hours > 0 ? cashOut / hours : null,
                gasPerKm: km > 0 && gas > 0 ? gas / km : null,
                cashPerKm: km > 0 ? cashOut / km : null,
                pocketPerKm: km > 0 ? operatingCashFlow / km : null,
                varianceVsGoal: earned > 0 ? earned - goal : 0
            };
        };

        /* Desviación estándar poblacional sobre las jornadas efectivamente trabajadas */
        const computeSpc = (values) => {
            const n = values.length;
            if (n === 0) return { n: 0, mean: 0, sigma: 0, cv: 0, ucl: 0, lcl: 0, verdict: null };
            const mean = values.reduce((acc, v) => acc + v, 0) / n;
            const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
            const sigma = Math.sqrt(variance);
            const cv = mean !== 0 ? (sigma / Math.abs(mean)) * 100 : 0;
            const verdict = n < 3
                ? { tone: 'neutral', label: 'Muestra insuficiente', detail: 'Registra al menos 3 jornadas para el análisis.' }
                : cv < 20
                    ? { tone: 'positive', label: 'Operación predecible', detail: 'Ingresos estables entre jornadas.' }
                    : cv <= 40
                        ? { tone: 'warning', label: 'Variabilidad moderada', detail: 'Hay dispersión aprovechable entre días.' }
                        : { tone: 'negative', label: 'Operación errática', detail: 'Alta dispersión entre días buenos y malos.' };
            return {
                n, mean, sigma, cv, verdict,
                ucl: mean + 1.5 * sigma,
                lcl: mean - 1.5 * sigma
            };
        };

        /* Consolidado mensual: finanzas, pacing, proyecciones, estadística y series */
        const computeMonthMetrics = (days, costs, totalDaysInMonth, basis) => {
            /* Pre-pase: el costo medio ponderado de combustible por kilómetro sale del
               total del mes, así que la vista devengada reparte exactamente la misma bolsa. */
            let sumGas = 0, sumKm = 0;
            days.forEach(day => { sumGas += num(day.gas); sumKm += num(day.km); });
            const weightedGasPerKm = sumKm > 0 ? sumGas / sumKm : 0;
            const accrual = { mode: basis === 'accrual' ? 'accrual' : 'cash', ratePerKm: weightedGasPerKm };
            const accrualActive = accrual.mode === 'accrual' && weightedGasPerKm > 0;

            let totalGoal = 0, totalEarned = 0, totalGas = 0, totalGasPaid = 0;
            let totalTolls = 0, totalWash = 0, totalMisc = 0;
            let totalDirectCosts = 0, totalOpex = 0, totalCashOut = 0;
            let totalKm = 0, totalHours = 0;
            let totalCashCollected = 0, totalAppDeposit = 0, totalCashOnHand = 0;
            let workedDays = 0, achievedDays = 0, goalDays = 0, pendingDays = 0, emptyDays = 0;
            let scheduledGoalSum = 0;
            let bestDay = null;

            const pocketSeries = [];
            const weekdayAcc = {};
            WEEK_ORDER.forEach(wd => { weekdayAcc[wd] = { earned: 0, pocket: 0, count: 0 }; });

            const cumulativeGoal = [];
            const cumulativeEarned = [];
            const cumulativeGas = [];
            const cumulativePocket = [];
            const dailyPocket = [];
            const gasPerKmSamples = [];
            const auditFlags = [];
            let accGoal = 0, accEarned = 0, accGas = 0, accPocket = 0, lastWorkedIndex = -1;
            let performanceVariance = 0;

            const computed = days.map((day, index) => {
                const c = computeDay(day, costs, accrual);

                totalGoal += c.goal;
                totalEarned += c.earned;
                totalGas += c.gas;
                totalGasPaid += c.gasPaid;
                totalTolls += c.tolls;
                totalWash += c.wash;
                totalMisc += c.misc;
                totalDirectCosts += c.directCosts;
                totalOpex += c.opex;
                totalCashOut += c.cashOut;
                totalKm += c.km;
                totalHours += c.hours;
                totalCashCollected += c.cashCollected;
                totalAppDeposit += c.appDeposit;
                if (c.cashCollected > 0) totalCashOnHand += c.cashOnHand;

                accGoal += c.goal;
                accEarned += c.earned;
                accGas += c.gas;
                accPocket += c.operatingCashFlow;
                cumulativeGoal.push(accGoal);
                cumulativeEarned.push(accEarned);
                cumulativeGas.push(accGas);
                cumulativePocket.push(accPocket);
                dailyPocket.push(c.operatingCashFlow);

                if (c.goal > 0) goalDays += 1;
                if (c.status === 'pendiente') pendingDays += 1;
                if (c.status === 'sin') emptyDays += 1;

                if (c.earned > 0) {
                    workedDays += 1;
                    lastWorkedIndex = index;
                    scheduledGoalSum += c.goal;
                    performanceVariance += c.earned - c.goal;
                    pocketSeries.push(c.operatingCashFlow);
                    if (c.status === 'cumplido') achievedDays += 1;
                    if (!bestDay || c.operatingCashFlow > bestDay.pocket) {
                        bestDay = { pocket: c.operatingCashFlow, earned: c.earned, label: day.dateString, id: day.id };
                    }
                    const wd = DAYS_OF_WEEK.indexOf(day.dayName);
                    const bucket = wd >= 0 ? weekdayAcc[wd] : null;
                    if (bucket) {
                        bucket.earned += c.earned;
                        bucket.pocket += c.operatingCashFlow;
                        bucket.count += 1;
                    }
                }
                if (c.gasPerKm !== null) gasPerKmSamples.push(c.gasPerKm);

                /* --- Auditoría de asientos --- */
                if (c.earned <= 0 && (c.hours > 0 || c.km > 0)) {
                    auditFlags.push({
                        id: day.id, label: day.dateString, type: 'incompleto',
                        severity: 'warn', title: 'Asiento incompleto',
                        detail: `${c.hours > 0 ? `${money(c.hours, 1)} h` : ''}${c.hours > 0 && c.km > 0 ? ' y ' : ''}${c.km > 0 ? `${money(c.km, 0)} km` : ''} sin ingreso capturado`
                    });
                }
                if (c.earned <= 0 && c.km <= 0 && (c.gasPaid > 0 || c.tolls > 0)) {
                    auditFlags.push({
                        id: day.id, label: day.dateString, type: 'huerfano',
                        severity: 'warn', title: 'Costo huérfano',
                        detail: `${money(c.gasPaid + c.tolls, 2)} de costo sin actividad operativa`
                    });
                }
                if (c.earned > 0 && c.contributionMargin < 0) {
                    auditFlags.push({
                        id: day.id, label: day.dateString, type: 'margen',
                        severity: 'error', title: 'Margen de contribución negativo',
                        detail: `Los costos directos superaron lo depositado en ${money(Math.abs(c.contributionMargin), 2)}`
                    });
                }
                if (c.earned > 0 && c.km >= 80 && c.contributionRatio > 95) {
                    auditFlags.push({
                        id: day.id, label: day.dateString, type: 'anomalia',
                        severity: 'info', title: 'Margen inverosímil',
                        detail: `${pctText(c.contributionRatio, 0)} de margen con ${money(c.km, 0)} km: falta registrar combustible`
                    });
                }

                return c;
            });

            const contributionMargin = totalEarned - totalDirectCosts;
            const operatingCashFlow = contributionMargin - totalOpex;
            const pocketProfit = operatingCashFlow;
            const horizon = totalDaysInMonth || days.length || 1;

            const avgEarned = workedDays > 0 ? totalEarned / workedDays : 0;
            const avgPocket = workedDays > 0 ? operatingCashFlow / workedDays : 0;

            const goalGap = totalGoal - totalEarned;
            const remainingDays = days.filter(d => num(d.earned) <= 0).length;
            const requiredDaily = goalGap > 0 && remainingDays > 0 ? goalGap / remainingDays : 0;

            const spc = computeSpc(pocketSeries);
            const avgGasPerKm = gasPerKmSamples.length > 0
                ? gasPerKmSamples.reduce((a, b) => a + b, 0) / gasPerKmSamples.length
                : null;

            const weekdayStats = WEEK_ORDER.map(wd => ({
                weekday: wd, label: DAY_SHORT[wd], name: DAYS_OF_WEEK[wd],
                count: weekdayAcc[wd].count,
                avgEarned: weekdayAcc[wd].count > 0 ? weekdayAcc[wd].earned / weekdayAcc[wd].count : 0,
                avgPocket: weekdayAcc[wd].count > 0 ? weekdayAcc[wd].pocket / weekdayAcc[wd].count : 0
            }));
            const weekdayMeans = {};
            weekdayStats.forEach(stat => { weekdayMeans[stat.weekday] = stat; });
            const bestWeekday = weekdayStats.reduce(
                (best, item) => (item.count > 0 && (!best || item.avgPocket > best.avgPocket) ? item : best), null);

            const groupOf = (weekday) => (weekday === 5 || weekday === 6 || weekday === 0 ? 'peak' : 'base');
            const clusters = { base: { earned: 0, pocket: 0, count: 0 }, peak: { earned: 0, pocket: 0, count: 0 } };
            WEEK_ORDER.forEach(wd => {
                const bucket = weekdayAcc[wd];
                const target = clusters[groupOf(wd)];
                target.earned += bucket.earned;
                target.pocket += bucket.pocket;
                target.count += bucket.count;
            });
            const clusterStats = {
                base: { label: 'Demanda base', detail: 'Lun · Mar · Mié · Jue', count: clusters.base.count,
                        avgEarned: clusters.base.count > 0 ? clusters.base.earned / clusters.base.count : 0,
                        avgPocket: clusters.base.count > 0 ? clusters.base.pocket / clusters.base.count : 0 },
                peak: { label: 'Alta demanda', detail: 'Vie · Sáb · Dom', count: clusters.peak.count,
                        avgEarned: clusters.peak.count > 0 ? clusters.peak.earned / clusters.peak.count : 0,
                        avgPocket: clusters.peak.count > 0 ? clusters.peak.pocket / clusters.peak.count : 0 }
            };

            /* --- Análisis de variaciones presupuestarias --- */
            const avgDailyGoal = goalDays > 0 ? totalGoal / goalDays : 0;
            const volumeVariance = (workedDays - goalDays) * avgDailyGoal;
            const totalVariance = totalEarned - totalGoal;
            /* El residuo recoge los días programados que aún no se trabajan */
            const residualVariance = totalVariance - volumeVariance - performanceVariance;
            const absSum = Math.abs(volumeVariance) + Math.abs(performanceVariance) + Math.abs(residualVariance);
            const variance = {
                total: totalVariance, volume: volumeVariance,
                performance: performanceVariance, residual: residualVariance,
                avgDailyGoal, workedDays, goalDays,
                volumeShare: absSum > 0 ? (Math.abs(volumeVariance) / absSum) * 100 : 0,
                performanceShare: absSum > 0 ? (Math.abs(performanceVariance) / absSum) * 100 : 0,
                residualShare: absSum > 0 ? (Math.abs(residualVariance) / absSum) * 100 : 0
            };

            /* --- Semanas contables (lunes a domingo) --- */
            const weeks = [];
            let current = null;
            days.forEach((day, index) => {
                const c = computed[index];
                const weekday = DAYS_OF_WEEK.indexOf(day.dayName);
                const isMonday = weekday === 1;
                if (!current || isMonday) {
                    current = {
                        index: weeks.length + 1, from: day.dateString, to: day.dateString,
                        fromId: day.id, toId: day.id, dayIds: [],
                        earned: 0, gas: 0, tolls: 0, misc: 0, wash: 0, direct: 0, opex: 0,
                        pocket: 0, worked: 0, goal: 0
                    };
                    weeks.push(current);
                }
                current.to = day.dateString;
                current.toId = day.id;
                current.dayIds.push(day.id);
                current.earned += c.earned;
                current.gas += c.gasPaid;
                current.tolls += c.tolls;
                current.misc += c.misc;
                current.wash += c.wash;
                current.direct += c.gasPaid + c.tolls;
                current.opex += c.wash + c.misc;
                current.pocket += c.earned - (c.gasPaid + c.tolls + c.wash + c.misc);
                current.goal += c.goal;
                if (c.earned > 0) current.worked += 1;
            });
            weeks.forEach(week => {
                week.egress = week.direct + week.opex;
                week.margin = week.earned - week.egress;
                week.marginRatio = week.earned > 0 ? (week.margin / week.earned) * 100 : 0;
            });

            const fuelAbsorption = totalEarned > 0 ? (totalGas / totalEarned) * 100 : 0;
            const costPerServiceHour = totalHours > 0 ? totalCashOut / totalHours : null;
            /* Apalancamiento operativo: qué parte de cada peso sobre la meta llega íntegro a caja */
            const aboveGoal = Math.max(totalEarned - totalGoal, 0);
            const operatingLeverage = contributionMargin !== 0 && operatingCashFlow !== 0
                ? contributionMargin / operatingCashFlow
                : null;
            const marginalRetention = totalEarned > 0 ? (contributionMargin / totalEarned) : 0;

            return {
                computed, accrualActive, weightedGasPerKm, basis: accrual.mode,
                totalGoal, totalEarned, totalGas, totalGasPaid,
                totalTolls, totalWash, totalMisc,
                totalDirectCosts, totalOpex, totalCashOut, totalRouteCash: totalTolls + totalWash + totalMisc,
                totalKm, totalHours,
                totalCashCollected, totalAppDeposit, totalCashOnHand,
                contributionMargin, operatingCashFlow, pocketProfit,
                contributionRatio: totalEarned > 0 ? (contributionMargin / totalEarned) * 100 : 0,
                returnRate: totalEarned > 0 ? (operatingCashFlow / totalEarned) * 100 : 0,
                fuelRetention: fuelAbsorption, fuelAbsorption,
                routeRatio: totalEarned > 0 ? ((totalTolls + totalWash + totalMisc) / totalEarned) * 100 : 0,
                opexRatio: totalEarned > 0 ? (totalOpex / totalEarned) * 100 : 0,
                costPerServiceHour, operatingLeverage, marginalRetention, aboveGoal,
                safetyRatio: totalEarned > 0 ? (contributionMargin / totalEarned) * 100 : 0,
                goalProgress: totalGoal > 0 ? (totalEarned / totalGoal) * 100 : 0,
                workedDays, achievedDays, goalDays, pendingDays, emptyDays,
                effectiveness: workedDays > 0 ? (achievedDays / workedDays) * 100 : 0,
                avgEarned, avgPocket,
                projectedEarned: avgEarned * horizon,
                projectedPocket: avgPocket * horizon,
                goalGap, remainingDays, requiredDaily,
                bestDay, bestWeekday, weekdayStats, weekdayMeans, clusterStats,
                cumulativeGoal, cumulativeEarned, cumulativeGas, cumulativePocket,
                dailyPocket, lastWorkedIndex,
                earnedPerHour: totalHours > 0 ? totalEarned / totalHours : null,
                pocketPerHour: totalHours > 0 ? operatingCashFlow / totalHours : null,
                cashPerKm: totalKm > 0 ? totalCashOut / totalKm : null,
                avgGasPerKm, spc, variance, weeks, auditFlags
            };
        };

        /* ============================================================================
           5a. MOTOR DE ANALÍTICA OPERATIVA (tablero DiDi + odómetro)
           ----------------------------------------------------------------------------
           km_total   = km_fin − km_inicio            (respaldo: campo "Kilómetros")
           η_km       = km_didi / km_total             aprovechamiento del rodado
           η_t        = t_activo / t_conectado         ocupación del turno
           G_didi     = gasolina × η_km                gasolina prorrateada al servicio
           MN         = ingreso − G_didi               margen neto operativo
           R_km       = MN / km_didi                   R_hr = MN / (t_conectado / 60)
           EPV        = ingreso / viajes               ticket promedio efectivo
           IRD        = 100 × Σ wᵢ·xᵢ / Σ wᵢ           pesos 0.40 · 0.35 · 0.15 · 0.10
           ============================================================================ */
        const IRD_WEIGHTS = { rKm: 0.40, rHr: 0.35, etaT: 0.15, etaKm: 0.10 };

        const OperationalAnalytics = {
            calcDailyMetrics(day) {
                const earned = num(day.earned);
                const gas = num(day.gas);
                const kmStart = num(day.kmStart);
                const kmEnd = num(day.kmEnd);
                const kmDidi = num(day.kmDidi);
                const trips = num(day.trips);

                /* Rodado total: odómetro si es coherente; si no, el campo "Kilómetros" */
                const odometerOk = hasValue(day.kmStart) && hasValue(day.kmEnd) && kmEnd > kmStart;
                const odometerError = hasValue(day.kmStart) && hasValue(day.kmEnd) && kmEnd <= kmStart;
                const kmTotal = odometerOk ? kmEnd - kmStart : (num(day.km) > 0 ? num(day.km) : null);
                const kmSource = odometerOk ? 'odometro' : kmTotal !== null ? 'manual' : null;

                /* DiDi no puede reportar más km de los que rodó el auto: se acota y se avisa */
                const kmOverflow = kmTotal !== null && kmDidi > kmTotal;
                const etaKm = kmTotal !== null && kmDidi > 0 ? Math.min(kmDidi / kmTotal, 1) : null;
                const deadKm = kmTotal !== null && kmDidi > 0 ? Math.max(kmTotal - kmDidi, 0) : null;

                /* Tiempo conectado: tablero DiDi; respaldo, las horas al volante */
                const onlineCaptured = parseDuration(day.timeOnline);
                const online = onlineCaptured !== null ? onlineCaptured
                    : (num(day.hours) > 0 ? num(day.hours) * 60 : null);
                const active = parseDuration(day.timeActive);
                const timeOverflow = online !== null && active !== null && active > online;
                const etaT = online !== null && active !== null ? Math.min(active / online, 1) : null;

                /* Sin η_km toda la gasolina se imputa al servicio (criterio conservador) */
                const gasDidi = etaKm !== null ? gas * etaKm : gas;
                const gasPersonal = gas - gasDidi;
                const margin = earned - gasDidi;

                const rKm = kmDidi > 0 ? margin / kmDidi : null;
                const rHr = online !== null ? margin / (online / 60) : null;
                const epv = trips > 0 ? earned / trips : null;
                const tripsPerHour = trips > 0 && online !== null ? trips / (online / 60) : null;

                return {
                    earned, gas, kmStart, kmEnd, kmDidi, trips,
                    kmTotal, kmSource, odometerError, kmOverflow, deadKm, etaKm,
                    online, onlineFromHours: onlineCaptured === null && online !== null,
                    active, timeOverflow, etaT,
                    gasDidi, gasPersonal, gasProrated: etaKm !== null,
                    margin, rKm, rHr, epv, tripsPerHour,
                    worked: earned > 0,
                    hasOps: kmDidi > 0 || onlineCaptured !== null || active !== null || trips > 0 || odometerOk
                };
            },

            /* Normalización contra el mejor valor del mes: x = valor / máximo, acotado a [0, 1].
               Un día con el 90% del mejor $/km obtiene 0.9, no 0 como en min-max. */
            normalizer(allMetrics, key) {
                const values = allMetrics.filter(m => m.worked && m[key] !== null).map(m => m[key]);
                const best = values.length > 0 ? Math.max(...values) : null;
                return (value) => {
                    if (value === null || best === null) return null;
                    if (best <= 0) return 0;   // ningún día con margen positivo
                    return clamp(value / best, 0, 1);
                };
            },

            calcIRD(dayMetrics, allMetrics, norms) {
                if (!dayMetrics.worked) return null;
                const n = norms || {
                    rKm: this.normalizer(allMetrics, 'rKm'),
                    rHr: this.normalizer(allMetrics, 'rHr')
                };
                const parts = {
                    rKm: n.rKm(dayMetrics.rKm),
                    rHr: n.rHr(dayMetrics.rHr),
                    etaT: dayMetrics.etaT,
                    etaKm: dayMetrics.etaKm
                };
                let weighted = 0, weights = 0, used = 0;
                Object.keys(IRD_WEIGHTS).forEach(key => {
                    if (parts[key] === null || parts[key] === undefined) return;
                    weighted += IRD_WEIGHTS[key] * parts[key];
                    weights += IRD_WEIGHTS[key];
                    used += 1;
                });
                /* Sin ningún indicador de rendimiento ($/km o $/hr) no hay puntaje defendible */
                if (parts.rKm === null && parts.rHr === null) return null;
                return {
                    score: Math.round((weighted / weights) * 100),
                    parts, components: used, partial: used < 4
                };
            },

            calcMonth(days) {
                const daily = days.map(day => this.calcDailyMetrics(day));
                const norms = { rKm: this.normalizer(daily, 'rKm'), rHr: this.normalizer(daily, 'rHr') };
                const ird = daily.map(m => this.calcIRD(m, daily, norms));
                const irdById = {};
                days.forEach((day, i) => { irdById[day.id] = ird[i]; });
                return { daily, ird, irdById, aggregates: this.calcWeeklyAndMonthlyAggregates(days, daily, ird) };
            },

            calcWeeklyAndMonthlyAggregates(days, daily, ird) {
                const blank = () => ({
                    count: 0, margin: 0, earned: 0,
                    marginKm: 0, kmDidi: 0, marginHr: 0, minutes: 0,
                    kmTotal: 0, kmDidiOdo: 0, dead: 0,
                    active: 0, onlineT: 0, irdSum: 0, irdCount: 0, trips: 0, tripsEarned: 0
                });
                const add = (acc, m, r) => {
                    acc.count += 1;
                    acc.margin += m.margin;
                    acc.earned += m.earned;
                    if (m.rKm !== null) { acc.marginKm += m.margin; acc.kmDidi += m.kmDidi; }
                    if (m.rHr !== null) { acc.marginHr += m.margin; acc.minutes += m.online; }
                    if (m.etaKm !== null) { acc.kmTotal += m.kmTotal; acc.kmDidiOdo += Math.min(m.kmDidi, m.kmTotal); acc.dead += m.deadKm; }
                    if (m.etaT !== null) { acc.active += Math.min(m.active, m.online); acc.onlineT += m.online; }
                    if (m.trips > 0) { acc.trips += m.trips; acc.tripsEarned += m.earned; }
                    if (r) { acc.irdSum += r.score; acc.irdCount += 1; }
                };
                /* Promedios ponderados: Σ margen / Σ recurso, robustos ante jornadas cortas */
                const finish = (acc) => ({
                    count: acc.count,
                    margin: acc.margin,
                    earned: acc.earned,
                    rKm: acc.kmDidi > 0 ? acc.marginKm / acc.kmDidi : null,
                    rHr: acc.minutes > 0 ? acc.marginHr / (acc.minutes / 60) : null,
                    etaKm: acc.kmTotal > 0 ? acc.kmDidiOdo / acc.kmTotal : null,
                    deadRatio: acc.kmTotal > 0 ? acc.dead / acc.kmTotal : null,
                    deadKm: acc.dead,
                    etaT: acc.onlineT > 0 ? acc.active / acc.onlineT : null,
                    epv: acc.trips > 0 ? acc.tripsEarned / acc.trips : null,
                    trips: acc.trips,
                    ird: acc.irdCount > 0 ? acc.irdSum / acc.irdCount : null
                });

                /* --- Perfil por día de la semana (lunes a domingo) --- */
                const byWeekday = {};
                WEEK_ORDER.forEach(wd => { byWeekday[wd] = blank(); });
                const month = blank();
                days.forEach((day, i) => {
                    const m = daily[i];
                    if (!m.worked) return;
                    add(month, m, ird[i]);
                    const wd = DAYS_OF_WEEK.indexOf(day.dayName);
                    if (wd >= 0) add(byWeekday[wd], m, ird[i]);
                });
                const weekdays = WEEK_ORDER.map(wd => ({
                    weekday: wd, label: DAY_SHORT[wd], name: DAYS_OF_WEEK[wd], ...finish(byWeekday[wd])
                }));
                const pick = (key, dir) => weekdays.reduce((best, w) => {
                    if (w.count === 0 || w[key] === null) return best;
                    if (!best) return w;
                    return dir > 0 ? (w[key] > best[key] ? w : best) : (w[key] < best[key] ? w : best);
                }, null);

                /* --- Semanas calendario (lunes a domingo) y variación WoW --- */
                const weeks = [];
                let current = null;
                days.forEach((day, i) => {
                    if (!current || DAYS_OF_WEEK.indexOf(day.dayName) === 1) {
                        current = { index: weeks.length + 1, from: day.dateString, to: day.dateString, acc: blank() };
                        weeks.push(current);
                    }
                    current.to = day.dateString;
                    if (daily[i].worked) add(current.acc, daily[i], ird[i]);
                });
                const delta = (cur, prev) => (cur === null || prev === null || prev === 0
                    ? null : ((cur - prev) / Math.abs(prev)) * 100);
                let previous = null;
                const weekly = weeks.map(week => {
                    const stats = finish(week.acc);
                    const row = {
                        index: week.index, from: week.from, to: week.to, ...stats,
                        wowMargin: previous ? delta(stats.margin, previous.margin) : null,
                        wowRKm: previous ? delta(stats.rKm, previous.rKm) : null,
                        wowRHr: previous ? delta(stats.rHr, previous.rHr) : null
                    };
                    if (stats.count > 0) previous = stats;
                    return row;
                }).filter(w => w.count > 0);

                /* --- Día estrella: argmax(IRD) --- */
                let starIndex = -1;
                ird.forEach((r, i) => {
                    if (r && (starIndex < 0 || r.score > ird[starIndex].score
                        || (r.score === ird[starIndex].score && daily[i].margin > daily[starIndex].margin))) {
                        starIndex = i;
                    }
                });
                const star = starIndex >= 0 ? {
                    id: days[starIndex].id,
                    label: days[starIndex].dateString,
                    dayName: days[starIndex].dayName,
                    ird: ird[starIndex],
                    metrics: daily[starIndex]
                } : null;

                return {
                    month: finish(month),
                    weekdays,
                    bestHourlyWeekday: pick('rHr', 1),
                    bestKmWeekday: pick('rKm', 1),
                    worstDeadWeekday: pick('deadRatio', 1),
                    weekly,
                    star
                };
            }
        };

        /* ============================================================================
           5b. EQUILIBRIO DE CAJA, PROYECCIÓN ESTRATIFICADA Y PACING ADAPTATIVO
           ============================================================================ */
        /* Traduce el umbral de equilibrio a los tres estados operativos del turno */
        const breakEvenState = (earned, cashOut) => {
            const gap = cashOut - earned;
            if (cashOut <= 0 && earned <= 0) {
                return { key: 'idle', label: 'Sin actividad', detail: 'Jornada sin registro', tone: 'slate', gap: 0 };
            }
            if (gap > 0.005) {
                return { key: 'deficit', tone: 'rose', gap, label: 'En zona de déficit', detail: 'para llegar a tablas' };
            }
            if (gap >= -0.005) {
                return { key: 'even', tone: 'amber', gap: 0, label: 'Punto de equilibrio alcanzado', detail: 'gastos del turno cubiertos' };
            }
            return { key: 'profit', tone: 'emerald', gap: Math.abs(gap), label: 'Ganancia de bolsillo', detail: 'limpios a la cartera' };
        };

        /* Eficiencia de pacing: avance de meta contra avance del calendario */
        const computePacing = (goalProgress, elapsedDays, totalDays) => {
            const elapsedRatio = totalDays > 0 ? clamp(elapsedDays / totalDays, 0, 1) * 100 : 0;
            const efficiency = elapsedRatio > 0 ? (goalProgress / elapsedRatio) * 100 : (goalProgress > 0 ? 200 : 0);
            return {
                elapsedRatio, efficiency, expectedProgress: elapsedRatio,
                verdict: elapsedRatio <= 0 ? 'Mes sin iniciar'
                    : efficiency >= 100 ? 'Adelantado al calendario'
                    : efficiency >= 80 ? 'A ritmo de meta'
                    : efficiency >= 55 ? 'Ligeramente atrasado'
                    : 'Atrasado frente al calendario'
            };
        };

        /* ---------------------------------------------------------------------------
           Proyección estratificada por perfil de día.
           En movilidad la demanda de un sábado no se parece a la de un martes, así que
           cada jornada pendiente se proyecta con la media observada de SU día de la
           semana; si ese día aún no tiene registros, cae de vuelta a su meta programada.
           --------------------------------------------------------------------------- */
        const projectStratified = (days, metrics) => {
            const contributions = [];
            let projected = metrics.totalEarned;
            let fromHistory = 0, fromGoal = 0;

            days.forEach(day => {
                if (num(day.earned) > 0) return;                  // jornada ya registrada
                const weekday = DAYS_OF_WEEK.indexOf(day.dayName);
                const profile = weekday >= 0 ? metrics.weekdayMeans[weekday] : null;
                const hasHistory = profile && profile.count > 0 && profile.avgEarned > 0;
                const value = hasHistory ? profile.avgEarned : num(day.goal);

                projected += value;
                if (hasHistory) fromHistory += 1; else fromGoal += 1;
                contributions.push({
                    id: day.id, label: day.dateString, weekday,
                    dayName: day.dayName, value, source: hasHistory ? 'historia' : 'meta'
                });
            });

            const flat = metrics.projectedEarned;
            return {
                projected, contributions, fromHistory, fromGoal,
                pendingDays: contributions.length,
                flat,
                delta: projected - flat,
                /* Bolsillo proyectado con la misma tasa de retorno observada */
                projectedPocket: metrics.returnRate !== 0
                    ? projected * (metrics.returnRate / 100)
                    : projected - metrics.totalCashOut,
                surplus: projected - metrics.totalGoal
            };
        };

        /* Simulador what-if: jornadas extra y variación del precio del combustible.
           Solo mueve dinero real: depósito esperado, gasolina y gastos de ruta. */
        const simulateScenario = (metrics, fuelDeltaPct, extraDays) => {
            const worked = metrics.workedDays;
            const avgEarned = worked > 0 ? metrics.totalEarned / worked : 0;
            const avgGas = worked > 0 ? metrics.totalGas / worked : 0;
            const avgRoute = worked > 0 ? metrics.totalRouteCash / worked : 0;
            const fuelFactor = 1 + (num(fuelDeltaPct) / 100);
            const days = Math.max(0, Math.round(num(extraDays)));

            const gasPerExtraDay = avgGas * fuelFactor;
            const pocketPerExtraDay = avgEarned - gasPerExtraDay - avgRoute;

            const scenarioEarned = metrics.totalEarned + avgEarned * days;
            const scenarioPocket = metrics.pocketProfit + pocketPerExtraDay * days;
            const fuelImpact = (gasPerExtraDay - avgGas) * days;
            const futureFuelImpact = avgGas * (fuelFactor - 1) * (days + metrics.remainingDays);

            return {
                days, fuelFactor, avgEarned, avgGas, avgRoute,
                pocketPerExtraDay, gasPerExtraDay,
                scenarioEarned, scenarioPocket,
                deltaPocket: scenarioPocket - metrics.pocketProfit,
                fuelImpact, futureFuelImpact,
                scenarioReturn: scenarioEarned > 0 ? (scenarioPocket / scenarioEarned) * 100 : 0,
                hasBaseline: worked > 0
            };
        };

        /* ---------------------------------------------------------------------------
           Rebalanceo dinámico de metas.
           Modo alivio: el excedente ya ganado baja la cuota de los días que faltan.
           Modo récord: las metas quedan fijas y se proyecta el sobrecumplimiento.
           --------------------------------------------------------------------------- */
        const rebalanceGoals = (days, metrics, projection) => {
            const pending = days.filter(d => num(d.earned) <= 0);
            const pendingGoal = pending.reduce((acc, d) => acc + num(d.goal), 0);
            const remaining = Math.max(metrics.goalGap, 0);
            const pendingCount = pending.length;

            /* Modo alivio: repartir lo que falta entre las jornadas pendientes */
            const reliefDaily = pendingCount > 0 ? remaining / pendingCount : 0;
            const originalDaily = pendingCount > 0 ? pendingGoal / pendingCount : 0;
            const dailyRelief = Math.max(originalDaily - reliefDaily, 0);
            const reliefRatio = originalDaily > 0 ? (dailyRelief / originalDaily) * 100 : 0;

            /* Modo récord: mantener la meta diaria y ver con cuánto se cierra */
            const recordSurplus = projection.projected - metrics.totalGoal;

            /* Descansos ganados: excedente acumulado sobre el ingreso medio de jornada */
            const surplusNow = metrics.totalEarned - (metrics.totalGoal - pendingGoal);
            const restDays = metrics.avgEarned > 0 ? surplusNow / metrics.avgEarned : 0;

            return {
                pendingCount, pendingGoal, remaining, originalDaily,
                reliefDaily, dailyRelief, reliefRatio,
                recordSurplus,
                surplusNow,
                earnedRest: Math.max(Math.floor(restDays), 0),
                earnedRestFraction: Math.max(restDays, 0),
                ahead: surplusNow > 0,
                goalReached: metrics.goalGap <= 0
            };
        };

        /* ============================================================================
           5c. HOOKS DE TELEMETRÍA (matemáticas desacopladas del render)
           ============================================================================ */
        /* Odómetro digital: interpola el valor mostrado con requestAnimationFrame */
        const useAnimatedNumber = (value, duration = 620) => {
            const target = Number.isFinite(Number(value)) ? Number(value) : 0;
            const [display, setDisplay] = useState(target);
            const fromRef = useRef(target);
            const startRef = useRef(0);
            const frameRef = useRef(null);
            const currentRef = useRef(target);

            useEffect(() => {
                const reduced = typeof window !== 'undefined' && window.matchMedia
                    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (reduced || Math.abs(target - currentRef.current) < 0.005) {
                    currentRef.current = target;
                    setDisplay(target);
                    return;
                }
                fromRef.current = currentRef.current;
                startRef.current = 0;

                const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
                const step = (timestamp) => {
                    if (!startRef.current) startRef.current = timestamp;
                    const elapsed = timestamp - startRef.current;
                    const progress = clamp(elapsed / duration, 0, 1);
                    const next = fromRef.current + (target - fromRef.current) * easeOutCubic(progress);
                    currentRef.current = next;
                    setDisplay(next);
                    if (progress < 1) frameRef.current = requestAnimationFrame(step);
                };

                frameRef.current = requestAnimationFrame(step);
                return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
            }, [target, duration]);

            return display;
        };

        /* Estado de equilibrio de una jornada (o del mes completo) */
        const useBreakEven = (earned, cost) => useMemo(
            () => breakEvenState(num(earned), num(cost)), [earned, cost]);

        /* Telemetría financiera consolidada del mes visible */
        const useFinancialTelemetry = (days, costs, elapsedDays, basis) => useMemo(() => {
            const base = computeMonthMetrics(days, costs, days.length, basis);
            const pacing = computePacing(base.goalProgress, elapsedDays, days.length);
            const equilibrium = breakEvenState(base.totalEarned, base.totalCashOut);
            const deficitDays = base.computed.filter(c => c.earned > 0 && c.breakEvenGap > 0.005).length;
            const projection = projectStratified(days, base);
            const rebalance = rebalanceGoals(days, base, projection);
            return { ...base, pacing, equilibrium, deficitDays, projection, rebalance };
        }, [days, costs, elapsedDays, basis]);

        /* ============================================================================
           5d. MODELOS PREDICTIVOS Y CONTROL ESTOCÁSTICO
           ============================================================================ */
        /* Normal estándar por transformación de Box-Muller.
           Se cachea la segunda variante del par para no desperdiciar la mitad del cálculo. */
        let spareNormal = null;
        const standardNormal = () => {
            if (spareNormal !== null) {
                const value = spareNormal;
                spareNormal = null;
                return value;
            }
            let u1 = 0, u2 = 0;
            while (u1 === 0) u1 = Math.random();   // evita log(0)
            u2 = Math.random();
            const radius = Math.sqrt(-2 * Math.log(u1));
            const angle = 2 * Math.PI * u2;
            spareNormal = radius * Math.sin(angle);
            return radius * Math.cos(angle);
        };

        /* Percentil sobre una muestra ya ordenada, con interpolación lineal */
        const percentileOf = (sortedSample, p) => {
            const n = sortedSample.length;
            if (n === 0) return 0;
            if (n === 1) return sortedSample[0];
            const position = clamp(p, 0, 1) * (n - 1);
            const lower = Math.floor(position);
            const upper = Math.ceil(position);
            if (lower === upper) return sortedSample[lower];
            const weight = position - lower;
            return sortedSample[lower] * (1 - weight) + sortedSample[upper] * weight;
        };

        /* Monte Carlo sobre los días que quedan por trabajar.
           Memoria acotada: una sola Float64Array de N totales, sin matriz N x días. */
        const MONTE_CARLO_RUNS = 1000;
        const runMonteCarlo = (mu, sigma, remainingDays, currentTotal, goal, runs = MONTE_CARLO_RUNS) => {
            const days = Math.max(0, Math.round(remainingDays));
            const mean = num(mu);
            const sd = Math.max(num(sigma), 0);

            if (days === 0 || mean <= 0) {
                const deterministic = currentTotal;
                return {
                    runs: 0, days, mean, sd,
                    probability: deterministic >= goal ? 100 : 0,
                    p5: deterministic, p10: deterministic, p50: deterministic,
                    p90: deterministic, p95: deterministic,
                    expected: deterministic, goal, degenerate: true
                };
            }

            const totals = new Float64Array(runs);
            let successes = 0;
            let sum = 0;

            for (let i = 0; i < runs; i += 1) {
                let total = currentTotal;
                for (let d = 0; d < days; d += 1) {
                    /* Normal truncada en cero: una jornada no puede facturar en negativo */
                    total += Math.max(0, mean + sd * standardNormal());
                }
                totals[i] = total;
                sum += total;
                if (total >= goal) successes += 1;
            }

            totals.sort();
            return {
                runs, days, mean, sd, goal,
                probability: (successes / runs) * 100,
                p5: percentileOf(totals, 0.05),
                p10: percentileOf(totals, 0.10),
                p50: percentileOf(totals, 0.50),
                p90: percentileOf(totals, 0.90),
                p95: percentileOf(totals, 0.95),
                expected: sum / runs,
                degenerate: false
            };
        };

        /* Banda del abanico: la suma de k jornadas i.i.d. normales es normal con
           media k*mu y desviación sigma*sqrt(k), así que el percentil es analítico.
           Evita guardar una matriz de N x días solo para dibujar la dispersión. */
        const Z_SCORES = { p10: -1.2816, p90: 1.2816 };
        const fanBand = (startValue, mu, sigma, steps) => {
            const low = [], high = [], mid = [];
            for (let k = 1; k <= steps; k += 1) {
                const center = startValue + mu * k;
                const spread = sigma * Math.sqrt(k);
                low.push(Math.max(startValue, center + Z_SCORES.p10 * spread));
                high.push(center + Z_SCORES.p90 * spread);
                mid.push(center);
            }
            return { low, high, mid };
        };

        /* Suavizado exponencial doble (modelo lineal de Holt) */
        const holtLinear = (series, alpha = 0.3, beta = 0.1) => {
            const values = series.filter(v => Number.isFinite(v));
            if (values.length === 0) return { level: 0, trend: 0, forecast: 0, fitted: [], n: 0 };
            if (values.length === 1) {
                return { level: values[0], trend: 0, forecast: values[0], fitted: [values[0]], n: 1 };
            }

            let level = values[0];
            let trend = values[1] - values[0];
            const fitted = [values[0]];

            for (let t = 1; t < values.length; t += 1) {
                const previousLevel = level;
                level = alpha * values[t] + (1 - alpha) * (previousLevel + trend);
                trend = beta * (level - previousLevel) + (1 - beta) * trend;
                fitted.push(level + trend);
            }

            return { level, trend, forecast: Math.max(0, level + trend), fitted, n: values.length, alpha, beta };
        };

        /* OEE de conducción: Disponibilidad x Desempeño x Calidad financiera */
        const computeOEE = (metrics, elapsedDays, days, costs) => {
            let scheduled = 0, worked = 0;
            days.forEach((day, index) => {
                if (index >= elapsedDays) return;            // solo días ya transcurridos
                if (num(day.goal) > 0) scheduled += 1;
                if (num(day.earned) > 0) worked += 1;
            });

            const availability = scheduled > 0 ? clamp(worked / scheduled, 0, 1) : 0;
            const target = num(costs.targetHourly) > 0 ? num(costs.targetHourly) : DEFAULT_COSTS.targetHourly;
            const realHourly = metrics.earnedPerHour;
            const performance = realHourly !== null && target > 0 ? clamp(realHourly / target, 0, 1.5) : null;
            const quality = metrics.totalEarned > 0 ? clamp(metrics.pocketProfit / metrics.totalEarned, 0, 1) : 0;

            const measurable = performance !== null;
            const oee = measurable ? availability * performance * quality : null;

            return {
                availability, performance, quality, oee, measurable,
                scheduled, worked, target, realHourly,
                verdict: !measurable ? 'Captura horas para medir el desempeño'
                    : oee >= 0.55 ? 'Operación de clase alta'
                    : oee >= 0.35 ? 'Operación competente'
                    : oee >= 0.18 ? 'Margen de mejora amplio'
                    : 'Operación por debajo de su potencial'
            };
        };

        /* Elasticidad del combustible: derivada discreta del retorno marginal.
           Ordena las jornadas por gasto en gasolina y mide cuánto neto añade cada peso extra. */
        const computeFuelElasticity = (computed) => {
            const points = computed
                .filter(c => c.earned > 0 && c.gas > 0)
                .map(c => ({ gas: c.gas, net: c.pocket }))
                .sort((a, b) => a.gas - b.gas);

            if (points.length < 3) {
                return { samples: points.length, marginal: [], avgMarginal: null, inflection: null, elasticity: null };
            }

            const marginal = [];
            for (let i = 1; i < points.length; i += 1) {
                const deltaGas = points[i].gas - points[i - 1].gas;
                if (deltaGas <= 0.01) continue;
                marginal.push({
                    gas: points[i].gas,
                    ratio: (points[i].net - points[i - 1].net) / deltaGas
                });
            }
            if (marginal.length === 0) {
                return { samples: points.length, marginal: [], avgMarginal: null, inflection: null, elasticity: null };
            }

            const avgMarginal = marginal.reduce((acc, m) => acc + m.ratio, 0) / marginal.length;
            /* Punto de inflexión: primer tramo donde un peso más de gasolina deja de pagarse */
            const inflection = marginal.find(m => m.ratio < 0) || null;

            /* Elasticidad arco entre la jornada más barata y la más cara en combustible */
            const first = points[0], last = points[points.length - 1];
            const gasChange = (last.gas - first.gas) / ((last.gas + first.gas) / 2);
            const netChange = (last.net - first.net) / (Math.abs(last.net + first.net) / 2 || 1);
            const elasticity = gasChange !== 0 ? netChange / gasChange : null;

            return { samples: points.length, marginal, avgMarginal, inflection, elasticity };
        };

        /* Hook: envuelve los modelos pesados y los memoiza sobre la lista diferida */
        const IDLE_PREDICTION = {
            mu: 0, sigma: 0, worked: 0, cv: 0, enoughData: false, elapsedMs: 0, idle: true,
            monteCarlo: { runs: 0, days: 0, probability: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0,
                          expected: 0, goal: 0, mean: 0, sd: 0, degenerate: true },
            holt: { level: 0, trend: 0, forecast: 0, fitted: [], n: 0 },
            holtPocket: { level: 0, trend: 0, forecast: 0, fitted: [], n: 0 },
            oee: { availability: 0, performance: null, quality: 0, oee: null, measurable: false,
                   scheduled: 0, worked: 0, target: 0, realHourly: null, verdict: 'Sin calcular' },
            fuel: { samples: 0, marginal: [], avgMarginal: null, inflection: null, elasticity: null }
        };

        const usePredictiveModels = (days, metrics, costs, elapsedDays, enabled) => useMemo(() => {
            /* Sin la pestaña de inteligencia abierta no se paga el costo de 1,000 simulaciones */
            if (!enabled) return IDLE_PREDICTION;
            const pocketSeries = [];
            const earnedSeries = [];
            days.forEach((day, index) => {
                const c = metrics.computed[index];
                if (c && c.earned > 0) {
                    pocketSeries.push(c.pocket);
                    earnedSeries.push(c.earned);
                }
            });

            const worked = earnedSeries.length;
            const mu = worked > 0 ? earnedSeries.reduce((a, b) => a + b, 0) / worked : 0;
            const variance = worked > 0
                ? earnedSeries.reduce((acc, v) => acc + Math.pow(v - mu, 2), 0) / worked
                : 0;
            const sigma = Math.sqrt(variance);

            const started = performance && performance.now ? performance.now() : 0;
            const monteCarlo = runMonteCarlo(mu, sigma, metrics.remainingDays,
                                             metrics.totalEarned, metrics.totalGoal);
            const elapsedMs = performance && performance.now ? performance.now() - started : 0;

            const holt = holtLinear(earnedSeries);
            const holtPocket = holtLinear(pocketSeries);
            const oee = computeOEE(metrics, elapsedDays, days, costs);
            const fuel = computeFuelElasticity(metrics.computed);

            return {
                mu, sigma, worked, monteCarlo, holt, holtPocket, oee, fuel, elapsedMs,
                cv: mu > 0 ? (sigma / mu) * 100 : 0,
                enoughData: worked >= 3
            };
        }, [days, metrics, costs, elapsedDays, enabled]);

        /* ============================================================================
           6. ICONOGRAFÍA SVG INLINE
           ============================================================================ */
        const Icon = ({ path, size = 18, className = '', strokeWidth = 1.8 }) => (
            <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth={strokeWidth}
                 strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
                {path}
            </svg>
        );

        const IconSliders   = (p) => <Icon {...p} path={<><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>} />;
        const IconCrosshair = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="8" /><line x1="12" y1="1" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="23" /><line x1="1" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="23" y2="12" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></>} />;
        const IconDownload  = (p) => <Icon {...p} path={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>} />;
        const IconUpload    = (p) => <Icon {...p} path={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>} />;
        const IconGrid      = (p) => <Icon {...p} path={<><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></>} />;
        const IconTrash     = (p) => <Icon {...p} path={<><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></>} />;
        const IconClose     = (p) => <Icon {...p} path={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />;
        const IconTrend     = (p) => <Icon {...p} path={<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>} />;
        const IconFuel      = (p) => <Icon {...p} path={<><line x1="3" y1="22" x2="15" y2="22" /><line x1="4" y1="9" x2="14" y2="9" /><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" /><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5" /></>} />;
        const IconTarget    = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /></>} />;
        const IconWallet    = (p) => <Icon {...p} path={<><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>} />;
        const IconGauge     = (p) => <Icon {...p} path={<><path d="M12 15l4-4" /><path d="M3.5 17a9 9 0 1 1 17 0" /><circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" /></>} />;
        const IconCheck     = (p) => <Icon {...p} path={<polyline points="4 12 9 17 20 6" />} />;
        const IconAlert     = (p) => <Icon {...p} path={<><path d="M12 3l9 16H3l9-16z" /><line x1="12" y1="9" x2="12" y2="13" /><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" /></>} />;
        const IconCalendar  = (p) => <Icon {...p} path={<><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></>} />;
        const IconChevronL  = (p) => <Icon {...p} path={<polyline points="15 5 8 12 15 19" />} />;
        const IconChevronR  = (p) => <Icon {...p} path={<polyline points="9 5 16 12 9 19" />} />;
        const IconChevronD  = (p) => <Icon {...p} path={<polyline points="6 9 12 15 18 9" />} />;
        const IconEye       = (p) => <Icon {...p} path={<><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3.2" /></>} />;
        const IconEyeOff    = (p) => <Icon {...p} path={<><path d="M9.9 5.7A9.9 9.9 0 0 1 12 5.5c7 0 10.5 6.5 10.5 6.5a17.6 17.6 0 0 1-3.6 4.3" /><path d="M6.3 7.4A17.3 17.3 0 0 0 1.5 12S5 18.5 12 18.5a9.9 9.9 0 0 0 4.2-.9" /><line x1="3" y1="3" x2="21" y2="21" /></>} />;
        const IconClock     = (p) => <Icon {...p} path={<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>} />;
        const IconRoute     = (p) => <Icon {...p} path={<><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18h5a4 4 0 0 0 0-8h-3a4 4 0 0 1 0-8h1" /></>} />;
        const IconWrench    = (p) => <Icon {...p} path={<path d="M14.6 6.3a3.7 3.7 0 0 0 4.9 4.8l2 2a5.7 5.7 0 0 1-7.8-7.7z M12.5 11.5L4 20a1.8 1.8 0 0 0 2.5 2.5l8.5-8.5" />} />;
        const IconStats     = (p) => <Icon {...p} path={<><line x1="4" y1="20" x2="4" y2="11" /><line x1="10" y1="20" x2="10" y2="5" /><line x1="16" y1="20" x2="16" y2="14" /><line x1="22" y1="20" x2="22" y2="8" /></>} />;
        const IconClipboard = (p) => <Icon {...p} path={<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" /><line x1="9" y1="10" x2="15" y2="10" /><line x1="9" y1="14" x2="13" y2="14" /></>} />;
        const IconPlus      = (p) => <Icon {...p} path={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} />;
        const IconMinus     = (p) => <Icon {...p} path={<line x1="5" y1="12" x2="19" y2="12" />} />;
        const IconBolt      = (p) => <Icon {...p} path={<polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2" />} />;
        const IconHistory   = (p) => <Icon {...p} path={<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /><polyline points="12 8 12 12 15 14" /></>} />;
        const IconLayers    = (p) => <Icon {...p} path={<><polygon points="12 3 21 8 12 13 3 8 12 3" /><polyline points="3 13 12 18 21 13" /></>} />;

        /* ============================================================================
           7. CONTEXTO DE PRIVACIDAD (MODO SIGILO) Y ÁTOMOS DE INTERFAZ
           ============================================================================ */
        const CashCtx = createContext({
            stealth: false,
            cash: (v, d) => '$' + money(v, d),
            cashShort: (v) => '$' + moneyShort(v)
        });
        const useCash = () => useContext(CashCtx);

        /* Métrica compacta sin tarjeta propia, para franjas dentro de otra tarjeta */
        const UnitStat = ({ label, value, sub, tone = 'neutral', masked }) => (
            <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold truncate">{label}</p>
                <p className={`text-[15px] font-bold num leading-tight mt-0.5 ${tone === 'info' ? 'text-sky-300' : 'text-slate-100'} ${masked ? 'stealth-blur' : ''}`}>{value}</p>
                {sub && <p className="text-[9px] text-slate-500 num truncate">{sub}</p>}
            </div>
        );

        /* Contador fluido aislado: solo este nodo se repinta durante la animación */
        const AnimatedCash = memo(function AnimatedCash({ value, decimals = 2, className = '' }) {
            const { cash, stealth } = useCash();
            const display = useAnimatedNumber(value);
            return <span className={`${className} ${stealth ? 'stealth-blur' : ''}`}>{cash(display, decimals)}</span>;
        });

        const MeterRow = ({ label, value, display, color }) => (
            <div className="space-y-1">
                <div className="flex justify-between items-baseline text-[11px] gap-2">
                    <span className="text-slate-300 font-medium truncate">{label}</span>
                    <span className="text-slate-200 font-bold num shrink-0">{display}</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div className={`${color} h-1.5 rounded-full transition-all duration-500`}
                         style={{ width: `${clamp(value, 0, 100)}%` }}></div>
                </div>
            </div>
        );

        /* true cuando el panel se muestra dentro de un Bundle: sin marco propio */
        const EmbedCtx = createContext(false);

        const SectionCard = ({ title, subtitle, action, children, className = '' }) => {
            const embedded = useContext(EmbedCtx);
            return (
            <section className={embedded ? `p-4 pt-3 ${className}` : `bg-slate-900 rounded-2xl border border-slate-800 p-4 ${className}`}>
                {(title || action) && (
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                            <h2 className="text-slate-100 text-sm font-semibold tracking-tight">{title}</h2>
                            {subtitle && <p className="text-slate-500 text-[11px] mt-0.5">{subtitle}</p>}
                        </div>
                        {action}
                    </div>
                )}
                {children}
            </section>
            );
        };

        /* ----------------------------------------------------------------------------
           Bundle: agrupa análisis complementarios en una sola tarjeta con pestañas
           internas. Solo se monta la vista activa y la elección se recuerda por grupo.
           ---------------------------------------------------------------------------- */
        const BUNDLE_KEY = 'didi_ui_bundle_';
        function Bundle({ id, title, subtitle, icon, action, tabs }) {
            const visible = tabs.filter(Boolean);
            const [active, setActive] = useState(() => {
                const stored = safeGet(BUNDLE_KEY + id);
                return visible.some(t => t.id === stored) ? stored : visible[0].id;
            });
            const current = visible.find(t => t.id === active) || visible[0];
            const pick = (tabId) => {
                setActive(tabId);
                safeSet(BUNDLE_KEY + id, tabId);
                haptic(10);
            };
            return (
                <section className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
                    <div className="flex items-start justify-between gap-3 px-4 pt-4">
                        <div className="min-w-0 flex items-start gap-2">
                            {icon && <span className="text-slate-400 mt-0.5 shrink-0">{icon}</span>}
                            <div className="min-w-0">
                                <h2 className="text-slate-100 text-sm font-semibold tracking-tight">{title}</h2>
                                {subtitle && <p className="text-slate-500 text-[11px] mt-0.5 num">{subtitle}</p>}
                            </div>
                        </div>
                        {action}
                    </div>
                    <div role="tablist" aria-label={title}
                         className="flex gap-1 mx-4 mt-3 p-1 rounded-xl bg-slate-950/60 border border-slate-800 overflow-x-auto">
                        {visible.map(t => {
                            const on = t.id === current.id;
                            return (
                                <button key={t.id} role="tab" aria-selected={on} onClick={() => pick(t.id)}
                                        className={`focus-ring flex-1 min-w-max flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition-colors ${
                                            on ? 'bg-slate-800 text-slate-100 shadow' : 'text-slate-400 hover:text-slate-200'}`}>
                                    {t.label}
                                    {t.count > 0 && (
                                        <span className={`num text-[9px] rounded px-1 border ${
                                            t.countTone === 'warn' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                            : 'bg-sky-500/15 text-sky-300 border-sky-500/30'}`}>{t.count}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <EmbedCtx.Provider value={true}>
                        <div key={current.id} role="tabpanel" className="fade-in">{current.render()}</div>
                    </EmbedCtx.Provider>
                </section>
            );
        }

        const MoneyField = ({ id, label, value, onChange, tone, prefix = '$', compact,
                              sanitize = sanitizeMoney, inputMode = 'decimal', placeholder = '0' }) => {
            const tones = {
                goal:   { label: 'text-slate-400',  box: 'bg-slate-800/70 border-slate-700 text-slate-200 focus:border-slate-500' },
                earned: { label: 'text-emerald-400', box: 'bg-emerald-950/30 border-emerald-800/60 text-emerald-100 font-bold focus:border-emerald-500' },
                gas:    { label: 'text-rose-400',    box: 'bg-rose-950/25 border-rose-900/60 text-rose-100 font-semibold focus:border-rose-500' },
                ops:    { label: 'text-amber-400',   box: 'bg-amber-950/20 border-amber-900/50 text-amber-100 focus:border-amber-500' },
                unit:   { label: 'text-sky-400',     box: 'bg-sky-950/20 border-sky-900/50 text-sky-100 focus:border-sky-500' }
            };
            const t = tones[tone] || tones.goal;
            return (
                <div className="min-w-0">
                    <label htmlFor={id} className={`block text-[9px] font-bold uppercase tracking-wider mb-1 truncate ${t.label}`}>{label}</label>
                    <div className="relative">
                        {prefix && (
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 pointer-events-none num">{prefix}</span>
                        )}
                        <input
                            id={id}
                            type="text"
                            inputMode={inputMode}
                            autoComplete="off"
                            spellCheck="false"
                            value={value === null || value === undefined ? '' : String(value)}
                            onChange={(e) => onChange(sanitize(e.target.value))}
                            onBlur={(e) => onChange(sanitize(e.target.value))}
                            placeholder={placeholder}
                            className={`num w-full border rounded-lg ${compact ? 'py-1.5' : 'py-2'} ${prefix ? 'pl-5' : 'pl-2'} pr-2 text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-slate-600 ${t.box}`}
                        />
                    </div>
                </div>
            );
        };

        const StatPill = ({ label, value, tone = 'slate' }) => {
            const tones = {
                slate: 'bg-slate-800/70 text-slate-300 border-slate-700',
                emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
                amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
                rose: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
                sky: 'bg-sky-500/10 text-sky-300 border-sky-500/30'
            };
            return (
                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold num ${tones[tone]}`}>
                    {label && <span className="opacity-70 font-semibold">{label}</span>}
                    <span>{value}</span>
                </span>
            );
        };

        /* ============================================================================
           8. CURVA ACUMULATIVA CON INSPECTOR TÁCTIL (SCRUBBING)
           ============================================================================ */
        function CumulativeChart({ days, metrics, todayIndex, prediction }) {
            const { cash, cashShort, stealth } = useCash();
            const [cursor, setCursor] = useState(null);
            const svgRef = useRef(null);
            const draggingRef = useRef(false);

            const W = 340, H = 156;
            const padL = 8, padR = 10, padT = 16, padB = 22;
            const count = days.length || 1;

            const { cumulativeGoal, cumulativeEarned, cumulativeGas, cumulativePocket,
                    dailyPocket, lastWorkedIndex, projectedEarned } = metrics;
            const totalGoal = cumulativeGoal[count - 1] || 0;
            const totalReal = cumulativeEarned[count - 1] || 0;

            const realEnd = clamp(Math.max(lastWorkedIndex, todayIndex >= 0 ? todayIndex : 0), 0, count - 1);

            /* Abanico probabilístico: percentil 10 a 90 de la acumulación futura */
            const fan = useMemo(() => {
                const steps = count - 1 - realEnd;
                if (!prediction || !prediction.enoughData || steps <= 0 || prediction.mu <= 0) return null;
                const band = fanBand(cumulativeEarned[realEnd] || 0, prediction.mu, prediction.sigma, steps);
                return { ...band, steps };
            }, [prediction, count, realEnd, cumulativeEarned]);

            const maxY = Math.max(totalGoal, totalReal, projectedEarned,
                                  fan ? fan.high[fan.high.length - 1] : 0, 1);

            const x = useCallback((i) => padL + (i / Math.max(count - 1, 1)) * (W - padL - padR), [count]);
            const y = useCallback((v) => H - padB - (clamp(v / maxY, 0, 1)) * (H - padT - padB), [maxY]);

            const paths = useMemo(() => {
                const toPath = (values, endIndex) => smoothPath(
                    values.slice(0, endIndex + 1).map((v, i) => ({ x: x(i), y: y(v) })));
                const goalPath = toPath(cumulativeGoal, count - 1);
                const realPath = toPath(cumulativeEarned, realEnd);
                const pocketPath = toPath(cumulativePocket, realEnd);
                /* Área entre depositado y bolsillo: el combustible y la ruta que se comieron el mes */
                const pocketPoints = cumulativePocket.slice(0, realEnd + 1).map((v, i) => ({ x: x(i), y: y(v) }));
                const gapPath = `${realPath} ${smoothPath(pocketPoints.slice().reverse()).replace(/^M/, 'L')} Z`;
                const areaPath = `${pocketPath} L${x(realEnd).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
                const projPath = (projectedEarned > 0 && realEnd < count - 1)
                    ? `M${x(realEnd).toFixed(1)},${y(cumulativeEarned[realEnd]).toFixed(1)} L${x(count - 1).toFixed(1)},${y(projectedEarned).toFixed(1)}`
                    : null;

                let fanPath = null;
                let fanMidPath = null;
                if (fan) {
                    const anchorPoint = { x: x(realEnd), y: y(cumulativeEarned[realEnd] || 0) };
                    const upper = [anchorPoint].concat(fan.high.map((v, i) => ({ x: x(realEnd + 1 + i), y: y(v) })));
                    const lower = [anchorPoint].concat(fan.low.map((v, i) => ({ x: x(realEnd + 1 + i), y: y(v) })));
                    const upperPath = smoothPath(upper);
                    const lowerReversed = lower.slice().reverse();
                    const lowerPath = smoothPath(lowerReversed).replace(/^M/, 'L');
                    fanPath = `${upperPath} ${lowerPath} Z`;
                    fanMidPath = smoothPath([anchorPoint].concat(fan.mid.map((v, i) => ({ x: x(realEnd + 1 + i), y: y(v) }))));
                }

                return { goalPath, realPath, pocketPath, gapPath, areaPath, projPath, fanPath, fanMidPath };
            }, [cumulativeGoal, cumulativeEarned, cumulativePocket, realEnd, count, projectedEarned, fan, x, y]);

            const indexFromEvent = useCallback((clientX) => {
                const node = svgRef.current;
                if (!node) return null;
                const rect = node.getBoundingClientRect();
                if (rect.width === 0) return null;
                const viewX = ((clientX - rect.left) / rect.width) * W;
                const ratio = (viewX - padL) / (W - padL - padR);
                return clamp(Math.round(ratio * (count - 1)), 0, count - 1);
            }, [count]);

            const onPointerDown = (e) => {
                draggingRef.current = true;
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
                const idx = indexFromEvent(e.clientX);
                if (idx !== null) { setCursor(idx); haptic(10); }
            };
            const onPointerMove = (e) => {
                if (!draggingRef.current && e.pointerType !== 'mouse') return;
                const idx = indexFromEvent(e.clientX);
                if (idx !== null) setCursor(prev => (prev === idx ? prev : idx));
            };
            const endScrub = (e) => {
                draggingRef.current = false;
                try { if (e && e.pointerId !== undefined) e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
                if (e && e.type === 'pointerup' && e.pointerType !== 'mouse') setCursor(null);
            };

            const gridValues = [0.25, 0.5, 0.75, 1].map(f => maxY * f);
            const ticks = [0, Math.round((count - 1) / 4), Math.round((count - 1) / 2),
                           Math.round(3 * (count - 1) / 4), count - 1]
                .filter((v, i, arr) => arr.indexOf(v) === i);

            const activeDay = cursor !== null ? days[cursor] : null;
            const tooltipLeft = cursor !== null ? clamp((x(cursor) / W) * 100, 16, 84) : 50;

            return (
                <SectionCard
                    title="Curva de acumulación"
                    subtitle="El hueco rojo es el combustible y la ruta que se comieron el depósito"
                    action={<span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold shrink-0 pt-1">Acumulado</span>}>

                    <div className="relative select-none">
                        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
                             className="scrub block w-full h-auto max-w-full overflow-visible"
                             aria-label={`Ingreso real acumulado contra meta acumulada de ${monthLabelFromDays(days)}`}
                             onPointerDown={onPointerDown}
                             onPointerMove={onPointerMove}
                             onPointerUp={endScrub}
                             onPointerCancel={endScrub}
                             onPointerLeave={(e) => { if (e.pointerType === 'mouse') { draggingRef.current = false; setCursor(null); } }}>
                            <defs>
                                <linearGradient id="realFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={COLORS.emerald} stopOpacity="0.34" />
                                    <stop offset="100%" stopColor={COLORS.emerald} stopOpacity="0.04" />
                                </linearGradient>
                                {/* Hueco entre depositado y bolsillo: lo que se comieron gasolina y ruta */}
                                <linearGradient id="gapFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={COLORS.crimson} stopOpacity="0.46" />
                                    <stop offset="100%" stopColor={COLORS.crimson} stopOpacity="0.20" />
                                </linearGradient>
                                {/* Abanico probabilístico P10–P90 */}
                                <linearGradient id="fanFill" x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0%" stopColor={COLORS.cyan} stopOpacity="0.30" />
                                    <stop offset="100%" stopColor={COLORS.cyan} stopOpacity="0.12" />
                                </linearGradient>
                            </defs>

                            {gridValues.map((v, i) => (
                                <line key={`grid-${i}`} x1={padL} x2={W - padR} y1={y(v)} y2={y(v)}
                                      stroke={COLORS.slate800} strokeWidth="1" fill="none" />
                            ))}
                            <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke={COLORS.slate700} strokeWidth="1" fill="none" />

                            {paths.fanPath && (
                                <path d={paths.fanPath} fill="url(#fanFill)" stroke="none" />
                            )}
                            {paths.fanMidPath && (
                                <path d={paths.fanMidPath} fill="none" stroke={COLORS.cyan}
                                      strokeWidth="1.2" strokeOpacity="0.55" strokeDasharray="1 4" strokeLinecap="round" />
                            )}
                            <path d={paths.areaPath} fill="url(#realFill)" stroke="none" />
                            <path d={paths.gapPath} fill="url(#gapFill)" stroke="none" />
                            <path d={paths.goalPath} fill="none" stroke={COLORS.slate500} strokeWidth="1.9"
                                  strokeDasharray="5 4" strokeLinecap="round" />
                            {paths.projPath && (
                                <path d={paths.projPath} fill="none" stroke={COLORS.cyan} strokeWidth="1.8"
                                      strokeDasharray="2 5" strokeLinecap="round" />
                            )}
                            <path d={paths.realPath} fill="none" stroke={COLORS.emerald} strokeWidth="2.4"
                                  strokeLinecap="round" strokeLinejoin="round" />
                            <path d={paths.pocketPath} fill="none" stroke="#34d399" strokeWidth="1.8"
                                  strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.95" />

                            <circle cx={x(realEnd)} cy={y(cumulativeEarned[realEnd] || 0)} r="3.6"
                                    fill={COLORS.emerald} stroke="#022c22" strokeWidth="1.5" />
                            <circle cx={x(realEnd)} cy={y(cumulativePocket[realEnd] || 0)} r="3"
                                    fill="#34d399" stroke="#022c22" strokeWidth="1.4" />
                            {paths.projPath && (
                                <circle cx={x(count - 1)} cy={y(projectedEarned)} r="3"
                                        fill="#0f172a" stroke={COLORS.cyan} strokeWidth="1.6" />
                            )}

                            {cursor !== null && (
                                <g>
                                    <line x1={x(cursor)} x2={x(cursor)} y1={padT - 6} y2={y(0)}
                                          stroke={COLORS.cyan} strokeWidth="1" strokeDasharray="3 3" />
                                    <circle cx={x(cursor)} cy={y(cumulativeGoal[cursor] || 0)} r="3"
                                            fill="#0f172a" stroke={COLORS.slate300} strokeWidth="1.4" />
                                    <circle cx={x(cursor)} cy={y(cumulativeEarned[cursor] || 0)} r="3.8"
                                            fill={COLORS.emerald} stroke="#022c22" strokeWidth="1.4" />
                                    <circle cx={x(cursor)} cy={y(cumulativePocket[cursor] || 0)} r="3.2"
                                            fill="#34d399" stroke="#022c22" strokeWidth="1.3" />
                                </g>
                            )}

                            <text x={padL} y={padT - 5} fill={COLORS.slate500} fontSize="9" fontFamily="system-ui, sans-serif">
                                {stealth ? '$•••' : '$' + moneyShort(maxY)}
                            </text>
                            {ticks.map((t) => (
                                <text key={`tick-${t}`} x={x(t)} y={H - 6} fill={COLORS.slate500} fontSize="9"
                                      fontFamily="system-ui, sans-serif"
                                      textAnchor={t === 0 ? 'start' : (t === count - 1 ? 'end' : 'middle')}>
                                    {t + 1}
                                </text>
                            ))}
                        </svg>

                        {activeDay && (
                            <div className="absolute top-0 pointer-events-none fade-in"
                                 style={{ left: `${tooltipLeft}%`, transform: 'translateX(-50%)' }}>
                                <div className="bg-slate-950/95 border border-slate-700 rounded-lg px-2.5 py-2 shadow-xl min-w-[132px]">
                                    <p className="text-[10px] font-bold text-slate-100 num">
                                        {activeDay.dateString} · <span className="text-slate-500">{DAY_SHORT[DAYS_OF_WEEK.indexOf(activeDay.dayName)] || ''}</span>
                                    </p>
                                    <div className="mt-1 space-y-0.5">
                                        <TooltipRow color={COLORS.slate500} label="Meta acum." value={cash(cumulativeGoal[cursor] || 0, 0)} />
                                        <TooltipRow color={COLORS.emerald} label="Depositado" value={cash(cumulativeEarned[cursor] || 0, 0)} />
                                        <TooltipRow color={COLORS.crimson} label="Gasolina" value={cash(cumulativeGas[cursor] || 0, 0)} />
                                        <TooltipRow color="#34d399" label="Bolsillo" value={cash(cumulativePocket[cursor] || 0, 0)} />
                                        <TooltipRow color={COLORS.cyan} label="Del día" value={cash(dailyPocket[cursor] || 0)} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-slate-800">
                        <Legend color={COLORS.emerald} label="Depositado" value={cash(totalReal, 0)} />
                        <Legend color="#34d399" label="Bolsillo" value={cash(cumulativePocket[realEnd] || 0, 0)} />
                        <span className="flex items-center gap-1.5 text-[11px]">
                            <span className="inline-block w-4 h-2 rounded-sm shrink-0"
                                  style={{ backgroundColor: COLORS.crimson, opacity: 0.42 }}></span>
                            <span className="text-slate-400">Absorbido</span>
                            <span className="text-slate-200 font-semibold num">
                                {cash((cumulativeEarned[realEnd] || 0) - (cumulativePocket[realEnd] || 0), 0)}
                            </span>
                        </span>
                        <Legend color={COLORS.slate500} dashed label="Meta" value={cash(totalGoal, 0)} />
                        {paths.projPath && <Legend color={COLORS.cyan} dashed label="Proyección" value={cash(projectedEarned, 0)} />}
                        {fan && (
                            <span className="flex items-center gap-1.5 text-[11px]">
                                <span className="inline-block w-4 h-2 rounded-sm shrink-0"
                                      style={{ backgroundColor: COLORS.cyan, opacity: 0.28 }}></span>
                                <span className="text-slate-400">Abanico P10–P90</span>
                                <span className="text-slate-200 font-semibold num">
                                    {cash(fan.low[fan.low.length - 1], 0)} – {cash(fan.high[fan.high.length - 1], 0)}
                                </span>
                            </span>
                        )}
                    </div>
                </SectionCard>
            );
        }

        /* Catmull-Rom convertido a Bézier cúbica, con los controles acotados al tramo
           para que una serie acumulada (monótona) nunca rebase ni oscile. */
        const smoothPath = (points) => {
            if (!points.length) return '';
            if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
            const t = 0.22;
            let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
            for (let i = 0; i < points.length - 1; i += 1) {
                const p0 = points[i - 1] || points[i];
                const p1 = points[i];
                const p2 = points[i + 1];
                const p3 = points[i + 2] || p2;
                /* Los límites van por min/max, no por orden de los puntos: una serie
                   recorrida de derecha a izquierda (el borde inferior de un área cerrada)
                   tiene p1.x > p2.x y colapsaría todos los controles sobre p1.x. */
                const loY = Math.min(p1.y, p2.y);
                const hiY = Math.max(p1.y, p2.y);
                const loX = Math.min(p1.x, p2.x);
                const hiX = Math.max(p1.x, p2.x);
                const c1x = clamp(p1.x + (p2.x - p0.x) * t, loX, hiX);
                const c1y = clamp(p1.y + (p2.y - p0.y) * t, loY, hiY);
                const c2x = clamp(p2.x - (p3.x - p1.x) * t, loX, hiX);
                const c2y = clamp(p2.y - (p3.y - p1.y) * t, loY, hiY);
                d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
            }
            return d;
        };

        const monthLabelFromDays = (days) => (days[0] && days[0].dateString ? days[0].dateString.replace(/^\d+\s/, '') : 'mes');

        const TooltipRow = ({ color, label, value }) => (
            <p className="flex items-center justify-between gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-slate-400">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }}></span>
                    {label}
                </span>
                <span className="text-slate-100 font-bold num">{value}</span>
            </p>
        );

        const Legend = ({ color, label, value, dashed }) => (
            <span className="flex items-center gap-1.5 text-[11px]">
                <span className="inline-block w-4 h-0.5 rounded-full shrink-0"
                      style={dashed
                          ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)` }
                          : { backgroundColor: color }}></span>
                <span className="text-slate-400">{label}</span>
                <span className="text-slate-200 font-semibold num">{value}</span>
            </span>
        );

        /* ============================================================================
           9. MATRIZ DE PRODUCTIVIDAD (HEATMAP CALENDÁRICO)
           ============================================================================ */
        const heatFill = (computedDay) => {
            if (!computedDay || computedDay.earned <= 0) return { fill: COLORS.slate800, opacity: 0.45 };
            if (computedDay.percentage >= 100) return { fill: COLORS.emerald, opacity: 1 };
            if (computedDay.percentage >= 50) return { fill: COLORS.emerald, opacity: 0.45 };
            return { fill: COLORS.amber, opacity: 0.38 };
        };

        function ProductivityHeatmap({ days, computed, year, monthIndex, todayId, onPickDay }) {
            const { cash } = useCash();
            const CELL = 13, GAP = 3.4, TOP = 12;
            const firstWeekday = new Date(year, monthIndex, 1).getDay();
            const offset = WEEK_ORDER.indexOf(firstWeekday);       // columna inicial (lunes = 0)
            const rows = Math.ceil((offset + days.length) / 7);
            const W = 7 * CELL + 6 * GAP;
            const H = TOP + rows * (CELL + GAP);

            const best = useMemo(() => {
                let top = 0;
                computed.forEach(c => { if (c.pocket > top) top = c.pocket; });
                return top;
            }, [computed]);

            return (
                <SectionCard
                    title="Matriz de productividad"
                    subtitle="Toca un día para saltar a su tarjeta"
                    action={<span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold shrink-0 pt-1">{MONTH_TAG[monthIndex]} {year}</span>}>

                    <div className="flex justify-center">
                        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
                             className="block h-auto max-w-[320px]"
                             aria-label="Calendario de cumplimiento diario del mes">
                            {WEEK_ORDER.map((wd, col) => (
                                <text key={`h-${wd}`} x={col * (CELL + GAP) + CELL / 2} y={7}
                                      fill={COLORS.slate500} fontSize="5.4" fontWeight="700"
                                      fontFamily="system-ui, sans-serif" textAnchor="middle">
                                    {DAY_SHORT[wd].toUpperCase()}
                                </text>
                            ))}
                            {days.map((day, index) => {
                                const slot = offset + index;
                                const col = slot % 7;
                                const row = Math.floor(slot / 7);
                                const style = heatFill(computed[index]);
                                const isToday = day.id === todayId;
                                return (
                                    <g key={day.id} onClick={() => { haptic(12); onPickDay(day.id); }} style={{ cursor: 'pointer' }}>
                                        <title>{`${day.dateString} · ${cash(computed[index] ? computed[index].pocket : 0)} neto · ${Math.round(computed[index] ? computed[index].percentage : 0)}%`}</title>
                                        <rect x={col * (CELL + GAP)} y={TOP + row * (CELL + GAP)}
                                              width={CELL} height={CELL} rx="3"
                                              fill={style.fill} fillOpacity={style.opacity}
                                              stroke={isToday ? COLORS.cyan : 'none'} strokeWidth={isToday ? 1.4 : 0} />
                                        <text x={col * (CELL + GAP) + CELL / 2} y={TOP + row * (CELL + GAP) + CELL / 2 + 2}
                                              fill={computed[index] && computed[index].percentage >= 100 ? '#022c22' : COLORS.slate300}
                                              fontSize="5.6" fontWeight="700" fontFamily="system-ui, sans-serif"
                                              textAnchor="middle" pointerEvents="none">
                                            {day.id}
                                        </text>
                                    </g>
                                );
                            })}
                        </svg>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-800">
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span>Menos</span>
                            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.slate800, opacity: 0.45 }}></span>
                            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.amber, opacity: 0.38 }}></span>
                            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.emerald, opacity: 0.45 }}></span>
                            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.emerald }}></span>
                            <span>Meta</span>
                        </div>
                        <span className="text-[10px] text-slate-500 num">Mejor jornada {cash(best, 0)}</span>
                    </div>
                </SectionCard>
            );
        }

        /* ============================================================================
           10. RENDIMIENTO POR DÍA DE LA SEMANA
           ============================================================================ */
        function WeekdayPerformance({ weekdayStats, bestWeekday }) {
            const { cash, cashShort, stealth } = useCash();
            const W = 320, H = 108, BASE = 84, TOP = 16;
            const slot = W / 7;
            const barW = 26;
            const maxNet = Math.max(1, ...weekdayStats.map(s => Math.abs(s.avgPocket)));

            return (
                <SectionCard
                    title="Rentabilidad por día de la semana"
                    subtitle="Promedio de utilidad neta real por jornada trabajada"
                    action={bestWeekday && bestWeekday.count > 0
                        ? <StatPill label="Mejor" value={bestWeekday.name} tone="emerald" />
                        : null}>
                    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
                         className="block w-full h-auto"
                         aria-label="Promedio de utilidad neta por día de la semana">
                        <line x1="0" x2={W} y1={BASE} y2={BASE} stroke={COLORS.slate800} strokeWidth="1" />
                        {weekdayStats.map((stat, i) => {
                            const cx = i * slot + slot / 2;
                            const ratio = Math.abs(stat.avgPocket) / maxNet;
                            const height = stat.count > 0 ? Math.max(3, ratio * (BASE - TOP)) : 3;
                            const positive = stat.avgPocket >= 0;
                            const yTop = positive ? BASE - height : BASE;
                            const isBest = bestWeekday && bestWeekday.weekday === stat.weekday && stat.count > 0;
                            const fill = stat.count === 0 ? COLORS.slate800 : positive ? COLORS.emerald : COLORS.crimson;
                            return (
                                <g key={stat.weekday}>
                                    <rect x={cx - barW / 2} y={yTop} width={barW} height={Math.max(height, 3)} rx="3"
                                          fill={fill} fillOpacity={stat.count === 0 ? 0.6 : isBest ? 1 : 0.62} />
                                    {stat.count > 0 && !stealth && (
                                        <text x={cx} y={positive ? yTop - 4 : BASE + height + 9}
                                              fill={isBest ? COLORS.emerald : COLORS.slate500}
                                              fontSize="8" fontWeight="700" fontFamily="system-ui, sans-serif" textAnchor="middle">
                                            {moneyShort(stat.avgPocket)}
                                        </text>
                                    )}
                                    <text x={cx} y={H - 4} fill={isBest ? COLORS.slate300 : COLORS.slate500}
                                          fontSize="8.5" fontWeight="700" fontFamily="system-ui, sans-serif" textAnchor="middle">
                                        {stat.label}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                    {bestWeekday && bestWeekday.count > 0 && (
                        <p className="text-[11px] text-slate-400 mt-2 pt-2 border-t border-slate-800">
                            Los <span className="text-slate-100 font-semibold">{bestWeekday.name}</span> dejan en promedio
                            <span className="text-emerald-400 font-bold num"> {cash(bestWeekday.avgPocket)}</span> netos
                            <span className="text-slate-500 num"> ({bestWeekday.count} {bestWeekday.count === 1 ? 'jornada' : 'jornadas'})</span>.
                        </p>
                    )}
                </SectionCard>
            );
        }

        /* ============================================================================
           10b. TABLERO DE INTELIGENCIA OPERATIVA (IRD, eficiencia y perfil semanal)
           ============================================================================ */
        /* view: 'summary' (día estrella, eficiencia de flota y WoW) o 'weekday' (tabla lunes-domingo) */
        function OperationalIntelPanel({ aggregates, onPickDay, view = 'summary' }) {
            const { cash } = useCash();
            const { star, month, weekdays, weekly, bestHourlyWeekday, worstDeadWeekday } = aggregates;
            const pct = (v) => (v === null ? '—' : pctText(v * 100, 0));
            const perUnit = (v, unit) => (v === null ? '—' : `${cash(v, 1)}${unit}`);
            const deltaText = (v) => (v === null ? '—' : `${v >= 0 ? '▲' : '▼'} ${pctText(Math.abs(v), 0)}`);
            const deltaTone = (v) => (v === null ? 'text-slate-500' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');

            return (
                <div className="p-4 pt-3 space-y-3">
                            {/* Card 1: Día de mayor rentabilidad */}
                            {view === 'summary' && <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/15 p-3">
                                <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-emerald-300 mb-1.5">Día de mayor rentabilidad</p>
                                {star ? (
                                    <button onClick={() => onPickDay(star.id)} className="focus-ring w-full text-left">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-slate-100 font-bold text-base num">★ {star.label} <span className="text-slate-400 text-[11px] font-semibold">{star.dayName}</span></span>
                                            <span className="text-emerald-300 font-bold text-lg num">{star.ird.score}<span className="text-[11px] text-slate-400">/100</span></span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                                            <div>
                                                <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">$/km neto</p>
                                                <p className="text-[13px] font-bold num text-slate-100">{perUnit(star.metrics.rKm, '')}</p>
                                            </div>
                                            <div>
                                                <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">$/hr neto</p>
                                                <p className="text-[13px] font-bold num text-slate-100">{perUnit(star.metrics.rHr, '')}</p>
                                            </div>
                                            <div>
                                                <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Horas</p>
                                                <p className="text-[13px] font-bold num text-slate-100">{star.metrics.online !== null ? money(star.metrics.online / 60, 1) : '—'}</p>
                                            </div>
                                        </div>
                                        {star.ird.partial && (
                                            <p className="text-[9px] text-slate-500 mt-1.5">* Score con {star.ird.components} de 4 indicadores: faltan datos del tablero DiDi.</p>
                                        )}
                                    </button>
                                ) : (
                                    <p className="text-[11px] text-slate-500">Aún no hay jornadas con ingreso y km DiDi u horas conectado.</p>
                                )}
                            </div>}

                            {/* Card 2: Eficiencia de flota */}
                            {view === 'summary' && <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                                <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-sky-300 mb-2">Eficiencia de flota · promedio mensual</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <div className="flex items-baseline justify-between">
                                            <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">Km útiles</span>
                                            <span className="text-[13px] font-bold num text-slate-100">{pct(month.etaKm)}</span>
                                        </div>
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1 overflow-hidden">
                                            <div className="bg-sky-500 h-1.5 rounded-full" style={{ width: `${clamp((month.etaKm || 0) * 100, 0, 100)}%` }}></div>
                                        </div>
                                        <p className="text-[9px] text-slate-500 num mt-1">{month.etaKm !== null ? `${money(month.deadKm, 0)} km fantasma` : 'Sin odómetro + km DiDi'}</p>
                                    </div>
                                    <div>
                                        <div className="flex items-baseline justify-between">
                                            <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">Tiempo activo</span>
                                            <span className="text-[13px] font-bold num text-slate-100">{pct(month.etaT)}</span>
                                        </div>
                                        <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1 overflow-hidden">
                                            <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${clamp((month.etaT || 0) * 100, 0, 100)}%` }}></div>
                                        </div>
                                        <p className="text-[9px] text-slate-500 num mt-1">{month.etaT !== null ? 'Resto: espera de viajes' : 'Sin tiempo conectado + activo'}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 mt-2.5 pt-2.5 border-t border-slate-800 text-center">
                                    <div>
                                        <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">$/km neto</p>
                                        <p className="text-[12px] font-bold num text-slate-100">{perUnit(month.rKm, '')}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">$/hr neto</p>
                                        <p className="text-[12px] font-bold num text-slate-100">{perUnit(month.rHr, '')}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Ticket EPV</p>
                                        <p className="text-[12px] font-bold num text-slate-100">{month.epv !== null ? cash(month.epv) : '—'}</p>
                                    </div>
                                </div>
                            </div>}

                            {/* Card 3: Perfil por día de la semana */}
                            {view === 'weekday' && <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                                <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-amber-300 mb-2">Perfil por día de la semana</p>
                                <table className="w-full text-[11px] num">
                                    <thead>
                                        <tr className="text-[9px] uppercase tracking-wider text-slate-400">
                                            <th className="text-left font-bold pb-1">Día</th>
                                            <th className="text-right font-bold pb-1">$/km</th>
                                            <th className="text-right font-bold pb-1">$/hr</th>
                                            <th className="text-right font-bold pb-1">Km muertos</th>
                                            <th className="text-right font-bold pb-1">IRD</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {weekdays.map(w => {
                                            const bestHr = bestHourlyWeekday && bestHourlyWeekday.weekday === w.weekday;
                                            const worstDead = worstDeadWeekday && worstDeadWeekday.weekday === w.weekday;
                                            return (
                                                <tr key={w.weekday} className={`border-t border-slate-800/70 ${w.count === 0 ? 'text-slate-600' : 'text-slate-200'}`}>
                                                    <td className="py-1 font-semibold">{w.label}<span className="text-slate-500 text-[9px]"> ×{w.count}</span></td>
                                                    <td className="py-1 text-right">{perUnit(w.rKm, '')}</td>
                                                    <td className={`py-1 text-right ${bestHr ? 'text-emerald-400 font-bold' : ''}`}>{perUnit(w.rHr, '')}</td>
                                                    <td className={`py-1 text-right ${worstDead ? 'text-rose-400 font-bold' : ''}`}>{pct(w.deadRatio)}</td>
                                                    <td className="py-1 text-right">{w.ird !== null ? Math.round(w.ird) : '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {(bestHourlyWeekday || worstDeadWeekday) && (
                                    <p className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-800">
                                        {bestHourlyWeekday && <>Mayor $/hr neto: <span className="text-emerald-400 font-semibold">{bestHourlyWeekday.name}</span>. </>}
                                        {worstDeadWeekday && <>Más km fantasma: <span className="text-rose-400 font-semibold">{worstDeadWeekday.name}</span> ({pct(worstDeadWeekday.deadRatio)}).</>}
                                    </p>
                                )}
                            </div>}

                            {/* Comparativo semana contra semana */}
                            {view === 'summary' && weekly.length > 0 && (
                                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                                    <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-slate-300 mb-2">Semana contra semana (WoW)</p>
                                    <table className="w-full text-[11px] num">
                                        <thead>
                                            <tr className="text-[9px] uppercase tracking-wider text-slate-400">
                                                <th className="text-left font-bold pb-1">Semana</th>
                                                <th className="text-right font-bold pb-1">Margen</th>
                                                <th className="text-right font-bold pb-1">WoW</th>
                                                <th className="text-right font-bold pb-1">$/km</th>
                                                <th className="text-right font-bold pb-1">WoW</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {weekly.map(w => (
                                                <tr key={w.index} className="border-t border-slate-800/70 text-slate-200">
                                                    <td className="py-1 font-semibold">{w.from}–{w.to.split(' ')[0]}</td>
                                                    <td className="py-1 text-right">{cash(w.margin, 0)}</td>
                                                    <td className={`py-1 text-right font-bold ${deltaTone(w.wowMargin)}`}>{deltaText(w.wowMargin)}</td>
                                                    <td className="py-1 text-right">{perUnit(w.rKm, '')}</td>
                                                    <td className={`py-1 text-right font-bold ${deltaTone(w.wowRKm)}`}>{deltaText(w.wowRKm)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {view === 'summary' && (
                                <p className="text-[9px] text-slate-500 leading-relaxed">
                                    IRD = 40% $/km neto + 35% $/hr neto (ambos contra el mejor día del mes) + 15% ocupación + 10% km útiles.
                                    La gasolina se prorratea por km útiles; sin odómetro se imputa completa al servicio.
                                </p>
                            )}
                </div>
            );
        }

        /* ============================================================================
           11. CONTROL ESTADÍSTICO DE OPERACIONES (SPC LIGERO)
           ============================================================================ */
        function SpcPanel({ spc, outliers, onPickDay }) {
            const { cash } = useCash();
            const [openState, setOpen] = useState(false);
            /* Dentro de un grupo el panel va siempre abierto y sin su propio encabezado */
            const embedded = useContext(EmbedCtx);
            const open = openState || embedded;
            const verdictTone = {
                positive: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
                warning: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
                negative: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
                neutral: 'bg-slate-800 text-slate-300 border-slate-700'
            };
            const tone = spc.verdict ? verdictTone[spc.verdict.tone] : verdictTone.neutral;

            return (
                <section className={embedded ? 'pt-3' : 'bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden'}>
                    {!embedded && (
                    <button onClick={() => { setOpen(o => !o); haptic(10); }}
                            aria-expanded={open}
                            className="focus-ring w-full flex items-center justify-between gap-3 p-4 text-left">
                        <span className="flex items-center gap-2 min-w-0">
                            <span className="text-sky-400 shrink-0"><IconStats size={16} /></span>
                            <span className="min-w-0">
                                <span className="block text-slate-100 text-sm font-semibold tracking-tight">Inteligencia y variabilidad</span>
                                <span className="block text-slate-500 text-[11px] truncate">
                                    {spc.n > 0 ? `${spc.n} jornadas analizadas · CV ${pctText(spc.cv, 0)}` : 'Sin jornadas registradas'}
                                </span>
                            </span>
                        </span>
                        <span className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
                            <IconChevronD size={18} />
                        </span>
                    </button>
                    )}

                    {open && (
                        <div className="px-4 pb-4 fade-in">
                            {spc.verdict && (
                                <div className={`rounded-xl border px-3 py-2 mb-3 ${tone}`}>
                                    <p className="text-[12px] font-bold">{spc.verdict.label}</p>
                                    <p className="text-[11px] opacity-80 mt-0.5">{spc.verdict.detail}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-2">
                                <div className="bg-slate-800/50 rounded-lg px-2 py-2 border border-slate-800">
                                    <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Media (μ)</p>
                                    <p className="text-sm font-bold text-slate-100 num mt-0.5">{cash(spc.mean, 0)}</p>
                                </div>
                                <div className="bg-slate-800/50 rounded-lg px-2 py-2 border border-slate-800">
                                    <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Desv. (σ)</p>
                                    <p className="text-sm font-bold text-slate-100 num mt-0.5">{cash(spc.sigma, 0)}</p>
                                </div>
                                <div className="bg-slate-800/50 rounded-lg px-2 py-2 border border-slate-800">
                                    <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">CV</p>
                                    <p className="text-sm font-bold text-slate-100 num mt-0.5">{pctText(spc.cv, 1)}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <div className="bg-emerald-950/25 rounded-lg px-2 py-2 border border-emerald-900/40">
                                    <p className="text-[9px] uppercase tracking-wider text-emerald-500 font-bold">UCL (μ + 1.5σ)</p>
                                    <p className="text-sm font-bold text-emerald-300 num mt-0.5">{cash(spc.ucl, 0)}</p>
                                </div>
                                <div className="bg-rose-950/25 rounded-lg px-2 py-2 border border-rose-900/40">
                                    <p className="text-[9px] uppercase tracking-wider text-rose-500 font-bold">LCL (μ − 1.5σ)</p>
                                    <p className="text-sm font-bold text-rose-300 num mt-0.5">{cash(spc.lcl, 0)}</p>
                                </div>
                            </div>

                            {outliers.length > 0 ? (
                                <div className="mt-3 pt-3 border-t border-slate-800">
                                    <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-2">
                                        Días con causa especial
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {outliers.map(item => (
                                            <button key={item.id} onClick={() => { haptic(10); onPickDay(item.id); }}
                                                    className={`focus-ring rounded-lg border px-2 py-1 text-[10px] font-bold num transition-colors ${
                                                        item.type === 'high'
                                                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                                                            : 'bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/20'}`}>
                                                {item.type === 'high' ? '▲' : '▼'} {item.label} · {cash(item.net, 0)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-slate-800">
                                    Ninguna jornada se sale de los límites de control: la operación se mantiene dentro de lo esperado.
                                </p>
                            )}
                        </div>
                    )}
                </section>
            );
        }

        /* ============================================================================
           12. TARJETA DIARIA CON DESGLOSE OPERATIVO
           ============================================================================ */
        const SWIPE_THRESHOLD = 74;   // px para disparar la acción
        const SWIPE_MAX = 104;        // tope del arrastre, con resistencia más allá del umbral

        const DayCard = memo(forwardRef(function DayCard(
            { day, costs, isToday, ucl, lcl, avgGasPerKm, spcSamples, irdScore, irdPartial, isStar,
              onField, onAutoGoal, onRestDay }, ref) {

            const { cash } = useCash();
            const [open, setOpen] = useState(false);
            const [dragX, setDragX] = useState(0);
            const [dragging, setDragging] = useState(false);
            const [burst, setBurst] = useState(false);

            /* dx vive en el ref: en un flick rápido los touchmove y el touchend
               caen en el mismo tick y el estado aún no refleja el arrastre. */
            const gesture = useRef({ x: 0, y: 0, dx: 0, axis: null, armed: false });
            const wasComplete = useRef(false);

            const c = useMemo(() => computeDay(day, costs), [day, costs]);
            const ops = useMemo(() => OperationalAnalytics.calcDailyMetrics(day), [day]);
            const equilibrium = useBreakEven(c.earned, c.breakEven);

            /* Destello cuando la jornada cruza el 100% de la meta */
            useEffect(() => {
                const complete = c.percentage >= 100;
                if (complete && !wasComplete.current) {
                    setBurst(true);
                    const timer = setTimeout(() => setBurst(false), 560);
                    wasComplete.current = complete;
                    return () => clearTimeout(timer);
                }
                wasComplete.current = complete;
            }, [c.percentage]);

            const edge = c.status === 'cumplido' ? 'border-l-emerald-500'
                : c.status === 'pendiente' ? 'border-l-amber-500'
                : 'border-l-slate-800';

            const barColor = c.percentage >= 100 ? 'bg-emerald-500'
                : c.percentage >= 75 ? 'bg-sky-500'
                : c.percentage >= 50 ? 'bg-amber-500'
                : c.percentage > 0 ? 'bg-orange-500'
                : 'bg-slate-800';

            const netTone = !c.hasData ? 'text-slate-600'
                : c.pocket > 0 ? 'text-emerald-400'
                : c.pocket < 0 ? 'text-rose-400'
                : 'text-slate-400';

            const isHigh = spcSamples >= 3 && c.earned > 0 && c.pocket > ucl;
            const isLow = spcSamples >= 3 && c.earned > 0 && c.pocket < lcl;
            const gasAlert = c.gasPerKm !== null && avgGasPerKm !== null
                && avgGasPerKm > 0 && c.gasPerKm > avgGasPerKm * 1.25;

            const extrasCount = [c.tolls, c.wash, c.misc].filter(v => v > 0).length;
            const opsCount = OPS_FIELDS.filter(f => hasValue(day[f])).length;
            const detailBadge = (c.hours > 0 ? 1 : 0) + (c.km > 0 ? 1 : 0) + extrasCount + opsCount;

            const set = useCallback((field) => (value) => onField(day.id, field, value), [day.id, onField]);

            /* ---------- Gesto de deslizamiento ---------- */
            const onTouchStart = (e) => {
                const touch = e.touches[0];
                gesture.current = { x: touch.clientX, y: touch.clientY, dx: 0, axis: null, armed: false };
                setDragging(true);
            };

            const onTouchMove = (e) => {
                const touch = e.touches[0];
                const dx = touch.clientX - gesture.current.x;
                const dy = touch.clientY - gesture.current.y;

                if (gesture.current.axis === null) {
                    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
                    gesture.current.axis = Math.abs(dx) > Math.abs(dy) + 2 ? 'x' : 'y';
                }
                if (gesture.current.axis !== 'x') return;

                /* Resistencia elástica más allá del umbral */
                const sign = dx < 0 ? -1 : 1;
                const magnitude = Math.abs(dx);
                const eased = magnitude <= SWIPE_THRESHOLD
                    ? magnitude
                    : SWIPE_THRESHOLD + (magnitude - SWIPE_THRESHOLD) * 0.35;
                const next = sign * Math.min(eased, SWIPE_MAX);

                if (!gesture.current.armed && magnitude >= SWIPE_THRESHOLD) {
                    gesture.current.armed = true;
                    haptic(12);
                } else if (gesture.current.armed && magnitude < SWIPE_THRESHOLD) {
                    gesture.current.armed = false;
                }
                gesture.current.dx = next;
                setDragX(next);
            };

            const onTouchEnd = () => {
                const travelled = gesture.current.dx;
                setDragging(false);
                setDragX(0);
                gesture.current.dx = 0;
                gesture.current.axis = null;
                gesture.current.armed = false;
                if (travelled >= SWIPE_THRESHOLD) onAutoGoal(day.id);
                else if (travelled <= -SWIPE_THRESHOLD) onRestDay(day.id);
            };

            const revealing = dragging && Math.abs(dragX) > 4;
            const armed = Math.abs(dragX) >= SWIPE_THRESHOLD;

            return (
                <div ref={ref}
                     style={{ scrollMarginTop: '120px', scrollMarginBottom: '24px' }}
                     className="relative rounded-xl overflow-hidden">

                    {/* Capas de acción reveladas por el gesto */}
                    {revealing && (
                        <div className="absolute inset-0 flex items-center justify-between rounded-xl" aria-hidden="true">
                            <div className={`h-full flex items-center gap-2 px-4 rounded-l-xl transition-colors ${
                                dragX > 0 ? (armed ? 'bg-emerald-600' : 'bg-emerald-600/40') : 'bg-transparent'}`}>
                                {dragX > 0 && (
                                    <>
                                        <span className="text-white"><IconTarget size={18} /></span>
                                        <span className="text-white text-[11px] font-bold uppercase tracking-wider">
                                            {armed ? 'Soltar: meta cubierta' : 'Completar meta'}
                                        </span>
                                    </>
                                )}
                            </div>
                            <div className={`h-full flex items-center gap-2 px-4 rounded-r-xl transition-colors ${
                                dragX < 0 ? (armed ? 'bg-slate-600' : 'bg-slate-700/50') : 'bg-transparent'}`}>
                                {dragX < 0 && (
                                    <>
                                        <span className="text-slate-100 text-[11px] font-bold uppercase tracking-wider">
                                            {armed ? 'Soltar: descanso' : 'Día de descanso'}
                                        </span>
                                        <span className="text-slate-100"><IconClock size={18} /></span>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    <div className={`swipe-layer gpu relative bg-slate-900 rounded-xl border border-slate-800 border-l-4 ${edge} p-3 ${
                             dragging ? 'dragging' : ''} ${
                             isToday ? 'ring-1 ring-sky-500/70' : ''} ${
                             c.percentage >= 100 ? 'goal-glow' : ''} ${burst ? 'goal-burst' : ''}`}
                         style={{ transform: `translate3d(${dragX}px, 0, 0)`, touchAction: 'pan-y' }}
                         onTouchStart={onTouchStart}
                         onTouchMove={onTouchMove}
                         onTouchEnd={onTouchEnd}
                         onTouchCancel={onTouchEnd}>

                        <div className="flex justify-between items-start mb-3 gap-2">
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <h3 className="font-bold text-slate-100 text-[15px] num">{day.dateString}</h3>
                                    {isToday && (
                                        <span className="bg-sky-500/15 text-sky-300 border border-sky-500/40 text-[9px] font-extrabold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded">
                                            Hoy
                                        </span>
                                    )}
                                    {irdScore !== null && irdScore !== undefined && (
                                        <IrdBadge score={irdScore} partial={irdPartial} star={isStar} />
                                    )}
                                    {isHigh && <StatPill value="▲ Pico" tone="emerald" />}
                                    {isLow && <StatPill value="▼ Bajo" tone="rose" />}
                                    {gasAlert && (
                                        <span title="Consumo de gasolina por km muy por encima del promedio"
                                              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 px-1.5 py-0.5 text-[10px] font-bold">
                                            <IconFuel size={11} /> Consumo alto
                                        </span>
                                    )}
                                </div>
                                <p className="text-slate-300 text-[10px] uppercase tracking-wider font-bold mt-0.5">{day.dayName}</p>
                            </div>
                            <div className="text-right shrink-0">
                                <span className={`text-lg font-bold num ${
                                    c.status === 'cumplido' ? 'text-emerald-400'
                                    : c.status === 'pendiente' ? 'text-amber-400' : 'text-slate-600'}`}>
                                    {c.percentage.toFixed(0)}%
                                </span>
                                <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">cumplim.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-3">
                            <MoneyField id={`goal-${day.id}`} label="Meta" tone="goal" value={day.goal} onChange={set('goal')} />
                            <MoneyField id={`earned-${day.id}`} label="Depositado" tone="earned" value={day.earned} onChange={set('earned')} />
                            <MoneyField id={`gas-${day.id}`} label="Gasolina" tone="gas" value={day.gas} onChange={set('gas')} />
                        </div>

                        {c.usesAccrual && Math.abs(c.gasAccrued - c.gasPaid) > 0.01 && (
                            <p className="text-[10px] text-sky-300 num mb-2.5">
                                Devengado: {cash(c.gasAccrued)} por {money(c.km, 0)} km
                                <span className="text-slate-400"> · pagado {cash(c.gasPaid)}</span>
                            </p>
                        )}

                        <div className="flex items-center justify-between gap-2 mb-2.5">
                            <span className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">A la cartera</span>
                                {c.earned > 0 && (
                                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${
                                        c.safetyBand === 'healthy' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                                        : c.safetyBand === 'caution' ? 'bg-amber-500/10 text-amber-300 border-amber-500/40'
                                        : 'bg-rose-500/10 text-rose-300 border-rose-500/40'}`}>
                                        {pctText(c.safetyRatio, 0)}
                                    </span>
                                )}
                            </span>
                            <span className={`text-sm font-bold num shrink-0 ${netTone}`}>
                                {c.hasData ? cash(c.pocket) : '—'}
                            </span>
                        </div>

                        <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                            <div className={`${barColor} h-1 rounded-full transition-all duration-500`}
                                 style={{ width: `${Math.min(c.percentage, 100)}%` }}></div>
                        </div>

                        <button onClick={() => { setOpen(o => !o); haptic(10); }}
                                aria-expanded={open}
                                className="focus-ring press w-full mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-slate-800/40 hover:bg-slate-800 border border-slate-800 px-2.5 py-1.5 transition-colors">
                            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400">
                                {open ? <IconMinus size={13} /> : <IconPlus size={13} />}
                                Detalle operativo
                                {!open && detailBadge > 0 && (
                                    <span className="num text-[9px] bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded px-1">{detailBadge}</span>
                                )}
                            </span>
                            <span className="text-[10px] num text-slate-500">
                                {c.hours > 0 && `${c.hours} h`}{c.hours > 0 && c.km > 0 ? ' · ' : ''}{c.km > 0 && `${c.km} km`}
                            </span>
                        </button>

                        {open && (
                            <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-2.5 fade-in">
                            {c.hours > 0 && <ShiftSpeedometer day={day} costs={costs} />}
                            {/* Margen de seguridad de la jornada */}
                            {c.earned > 0 && (
                                <div className="flex items-center justify-between gap-2 mb-2.5">
                                    <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">
                                        Margen de seguridad
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                                            c.safetyBand === 'healthy' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                                            : c.safetyBand === 'caution' ? 'bg-amber-500/10 text-amber-300 border-amber-500/40'
                                            : 'bg-rose-500/10 text-rose-300 border-rose-500/40'}`}>
                                            {c.safetyBand === 'healthy' ? 'Saludable'
                                                : c.safetyBand === 'caution' ? 'Precaución' : 'Crítico'}
                                        </span>
                                        <span className="text-[13px] font-bold num text-slate-100">{pctText(c.safetyRatio, 0)}</span>
                                    </span>
                                </div>
                            )}
                            {/* Punto de equilibrio de la jornada */}
                            {c.hasData && (
                                <div className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 mb-2.5 ${
                                    equilibrium.key === 'deficit' ? 'bg-rose-950/25 border-rose-900/50'
                                    : equilibrium.key === 'even' ? 'bg-amber-950/20 border-amber-900/50'
                                    : equilibrium.key === 'profit' ? 'bg-emerald-950/20 border-emerald-900/40'
                                    : 'bg-slate-800/40 border-slate-800'}`}>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider truncate ${
                                        equilibrium.key === 'deficit' ? 'text-rose-300'
                                        : equilibrium.key === 'even' ? 'text-amber-300'
                                        : equilibrium.key === 'profit' ? 'text-emerald-300' : 'text-slate-400'}`}>
                                        {equilibrium.label}
                                    </span>
                                    <span className="text-[10px] num text-slate-400 shrink-0">
                                        {equilibrium.key === 'deficit' && `${cash(equilibrium.gap)} ${equilibrium.detail}`}
                                        {equilibrium.key === 'profit' && `+${cash(equilibrium.gap)} ${equilibrium.detail}`}
                                        {equilibrium.key === 'even' && equilibrium.detail}
                                        {equilibrium.key === 'idle' && equilibrium.detail}
                                    </span>
                                </div>
                            )}
                                <div className="grid grid-cols-2 gap-2">
                                    <MoneyField id={`hours-${day.id}`} label="Horas al volante" tone="unit" prefix="h" compact
                                                value={day.hours} onChange={set('hours')} />
                                    <MoneyField id={`km-${day.id}`} label="Kilómetros" tone="unit" prefix="km" compact
                                                value={day.km} onChange={set('km')} />
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <MoneyField id={`tolls-${day.id}`} label="Casetas" tone="ops" compact
                                                value={day.tolls} onChange={set('tolls')} />
                                    <MoneyField id={`wash-${day.id}`} label="Lavado" tone="ops" compact
                                                value={day.wash} onChange={set('wash')} />
                                    <MoneyField id={`misc-${day.id}`} label="Varios" tone="ops" compact
                                                value={day.misc} onChange={set('misc')} />
                                </div>

                                <OpsBlock day={day} ops={ops} set={set} />

                                {/* Arqueo de tesorería: cómo se liquidó el ingreso del turno */}
                                <div className="grid grid-cols-2 gap-2">
                                    <MoneyField id={`cash-${day.id}`} label="Efectivo cobrado" tone="earned" compact
                                                value={day.cashCollected} onChange={set('cashCollected')} />
                                    <MoneyField id={`app-${day.id}`} label="Saldo en app" tone="unit" compact
                                                value={day.appDeposit} onChange={set('appDeposit')} />
                                </div>

                                {c.declaredSplit && (
                                    <div className={`rounded-lg border px-2.5 py-2 ${
                                        c.cashOnHand < 0 ? 'bg-rose-950/25 border-rose-900/50'
                                                         : 'bg-slate-800/40 border-slate-800'}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">
                                                Efectivo líquido en mano
                                            </span>
                                            <span className={`text-[13px] font-bold num ${
                                                c.cashOnHand >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
                                                {cash(c.cashOnHand)}
                                            </span>
                                        </div>
                                        <p className="text-[9px] text-slate-400 num mt-0.5">
                                            {c.cashOnHand < 0
                                                ? `Pusiste ${cash(Math.abs(c.cashOnHand))} de tu bolsillo para cubrir la ruta`
                                                : `Cobrado ${cash(c.cashCollected, 0)} − ruta en efectivo ${cash(c.gasPaid + c.tolls + c.misc, 0)}`}
                                        </p>
                                        {Math.abs(c.splitDelta) > 0.01 && (
                                            <p className="text-[9px] text-amber-300 num mt-0.5">
                                                El desglose difiere {cash(Math.abs(c.splitDelta))} del ingreso capturado.
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-1.5">
                                    <DerivedStat label="Margen de contribución" value={cash(c.contributionMargin)}
                                                 hint={`Ratio ${pctText(c.contributionRatio, 0)}`}
                                                 tone={c.contributionMargin < 0 ? 'warn' : 'default'} />
                                    <DerivedStat label="Punto de equilibrio" value={cash(c.breakEven)}
                                                 hint={`Cobertura ${pctText(c.coverage, 0)}`}
                                                 tone={equilibrium.key === 'deficit' ? 'warn' : 'default'} />
                                    <DerivedStat label="Neto por hora" value={c.pocketPerHour !== null ? cash(c.pocketPerHour) : '—'}
                                                 hint={c.realHourly !== null ? `Depósito ${cash(c.realHourly)}/h` : 'Captura las horas'} />
                                    <DerivedStat label="Gasolina por km" value={c.gasPerKm !== null ? cash(c.gasPerKm) : '—'}
                                                 hint={c.gasPerKm !== null && avgGasPerKm ? `Promedio ${cash(avgGasPerKm)}` : 'Captura km y gasolina'}
                                                 tone={gasAlert ? 'warn' : 'default'} />
                                    <DerivedStat label="Gasto por km" value={c.cashPerKm !== null ? cash(c.cashPerKm) : '—'}
                                                 hint={`Ruta ${cash(c.routeCash)}`} />
                                </div>

                                <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/60 border border-slate-800 px-2.5 py-2">
                                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                                        Depositado − gasolina − gastos de ruta
                                    </span>
                                    <span className={`text-[13px] font-bold num ${netTone}`}>{cash(c.pocket)}</span>
                                </div>

                                <p className="text-[10px] text-slate-600 text-center">
                                    Desliza la tarjeta: → cubre la meta · ← marca descanso
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }));

        /* Badge del Índice de Rendimiento Diario */
        const irdTone = (score) => (score >= 80 ? 'emerald' : score >= 60 ? 'sky' : score >= 40 ? 'amber' : 'rose');
        const IRD_TONES = {
            emerald: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40',
            sky: 'bg-sky-500/10 text-sky-300 border-sky-500/40',
            amber: 'bg-amber-500/10 text-amber-300 border-amber-500/40',
            rose: 'bg-rose-500/10 text-rose-300 border-rose-500/40'
        };
        const IrdBadge = ({ score, partial, star }) => (
            <span title={partial
                      ? 'Índice de Rendimiento Diario parcial: faltan datos del tablero DiDi; se reponderó con lo capturado'
                      : 'Índice de Rendimiento Diario (40% $/km · 35% $/hr · 15% ocupación · 10% km útiles)'}
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold num ${IRD_TONES[irdTone(score)]}`}>
                {star && <span aria-label="Día estrella">★</span>}
                Score: {score}/100{partial ? '*' : ''}
            </span>
        );

        /* Captura del tablero DiDi + odómetro y sus métricas derivadas */
        const OpsBlock = ({ day, ops, set }) => {
            const { cash } = useCash();
            const pct = (v) => (v === null ? '—' : pctText(v * 100, 0));
            const warnings = [];
            if (ops.odometerError) warnings.push('El km final debe ser mayor que el inicial.');
            if (ops.kmOverflow) warnings.push(`DiDi reporta más km (${money(ops.kmDidi, 1)}) que el rodado total (${money(ops.kmTotal, 1)}): los km útiles se acotan a 100%.`);
            if (ops.timeOverflow) warnings.push('El tiempo activo supera al conectado: la ocupación se acota a 100%.');
            return (
                <div className="rounded-lg border border-sky-900/50 bg-sky-950/10 p-2 space-y-2">
                    <p className="text-[9px] uppercase tracking-[0.14em] font-bold text-sky-300">Tablero DiDi y odómetro</p>
                    <div className="grid grid-cols-3 gap-2">
                        <MoneyField id={`kmStart-${day.id}`} label="Km inicio" tone="unit" prefix="" compact
                                    value={day.kmStart} onChange={set('kmStart')} />
                        <MoneyField id={`kmEnd-${day.id}`} label="Km fin" tone="unit" prefix="" compact
                                    value={day.kmEnd} onChange={set('kmEnd')} />
                        <MoneyField id={`kmDidi-${day.id}`} label="Km DiDi" tone="unit" prefix="km" compact
                                    value={day.kmDidi} onChange={set('kmDidi')} />
                        <MoneyField id={`timeOnline-${day.id}`} label="Conectado" tone="unit" prefix="" compact
                                    sanitize={sanitizeDuration} inputMode="text" placeholder="HH:MM"
                                    value={day.timeOnline} onChange={set('timeOnline')} />
                        <MoneyField id={`timeActive-${day.id}`} label="Activo" tone="unit" prefix="" compact
                                    sanitize={sanitizeDuration} inputMode="text" placeholder="HH:MM"
                                    value={day.timeActive} onChange={set('timeActive')} />
                        <MoneyField id={`trips-${day.id}`} label="Viajes" tone="unit" prefix="#" compact
                                    sanitize={sanitizeInt} inputMode="numeric"
                                    value={day.trips} onChange={set('trips')} />
                    </div>
                    <p className="text-[9px] text-slate-500 num">
                        Rodado {ops.kmTotal !== null ? `${money(ops.kmTotal, 1)} km${ops.kmSource === 'manual' ? ' (campo Kilómetros)' : ''}` : '—'}
                        {' · '}Conectado {durationText(ops.online)}{ops.onlineFromHours ? ' (de horas al volante)' : ''}
                        {ops.active !== null ? ` · Activo ${durationText(ops.active)}` : ''}
                    </p>
                    {warnings.map(w => <p key={w} className="text-[9px] text-amber-300">{w}</p>)}
                    <div className="grid grid-cols-2 gap-1.5">
                        <DerivedStat label="Ocupación del turno" value={pct(ops.etaT)}
                                     hint={ops.etaT !== null ? `Tiempo muerto ${durationText(Math.max(ops.online - ops.active, 0))}` : 'Captura conectado y activo'}
                                     tone={ops.etaT !== null && ops.etaT < 0.5 ? 'warn' : 'default'} />
                        <DerivedStat label="Km útiles" value={pct(ops.etaKm)}
                                     hint={ops.deadKm !== null ? `${money(ops.deadKm, 1)} km fantasma` : 'Captura odómetro y km DiDi'}
                                     tone={ops.etaKm !== null && ops.etaKm < 0.6 ? 'warn' : 'default'} />
                        <DerivedStat label="Gasolina DiDi" value={cash(ops.gasDidi)}
                                     hint={ops.gasProrated ? `Uso personal ${cash(ops.gasPersonal)}` : 'Sin prorrateo: 100% al servicio'} />
                        <DerivedStat label="Margen neto" value={cash(ops.margin)}
                                     hint="Ingreso − gasolina DiDi" tone={ops.margin < 0 ? 'warn' : 'default'} />
                        <DerivedStat label="$ por km neto" value={ops.rKm !== null ? `${cash(ops.rKm)}/km` : '—'}
                                     hint="MN / km DiDi" />
                        <DerivedStat label="$ por hora neto" value={ops.rHr !== null ? `${cash(ops.rHr)}/h` : '—'}
                                     hint="MN / horas conectado" />
                        <DerivedStat label="Ticket efectivo" value={ops.epv !== null ? cash(ops.epv) : '—'}
                                     hint={ops.tripsPerHour !== null ? `${money(ops.tripsPerHour, 1)} viajes/h` : 'Captura los viajes'} />
                    </div>
                </div>
            );
        };

        const DerivedStat = ({ label, value, hint, tone = 'default' }) => (
            <div className={`rounded-lg border px-2 py-1.5 ${
                tone === 'warn' ? 'bg-amber-950/25 border-amber-900/50' : 'bg-slate-800/40 border-slate-800'}`}>
                <p className="text-[9px] uppercase tracking-wider text-slate-300 font-bold truncate">{label}</p>
                <p className={`text-[13px] font-bold num ${tone === 'warn' ? 'text-amber-300' : 'text-slate-100'}`}>{value}</p>
                {hint && <p className="text-[9px] text-slate-400 num truncate">{hint}</p>}
            </div>
        );

        const FilterChip = ({ active, onClick, label, count, accent }) => {
            const activeClass = accent === 'emerald'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/50'
                : accent === 'amber'
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/50'
                : 'bg-slate-800 text-slate-100 border-slate-600';
            return (
                <button onClick={onClick} aria-pressed={active} title={`${label}: ${count} días`}
                        className={`focus-ring min-w-0 flex flex-col items-center justify-center rounded-xl border px-1.5 py-1.5 transition-colors ${
                            active ? activeClass : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'}`}>
                    <span className="num text-[13px] font-bold leading-none">{count}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider leading-none mt-1 truncate max-w-full">{label}</span>
                </button>
            );
        };

        /* ============================================================================
           13. SELECTOR DE MES
           ============================================================================ */
        function MonthPicker({ year, monthIndex, storedMonths, onSelect, onClose }) {
            const [browseYear, setBrowseYear] = useState(year);
            const stored = useMemo(() => new Set(storedMonths.map(m => m.id)), [storedMonths]);
            const now = new Date();

            return (
                <div className="absolute left-0 right-0 top-full mt-1 z-40 fade-in">
                    <div className="mx-3 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3">
                        <div className="flex items-center justify-between mb-3">
                            <button onClick={() => setBrowseYear(y => y - 1)} aria-label="Año anterior"
                                    className="focus-ring p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white">
                                <IconChevronL size={16} />
                            </button>
                            <span className="text-slate-100 font-bold num">{browseYear}</span>
                            <button onClick={() => setBrowseYear(y => y + 1)} aria-label="Año siguiente"
                                    className="focus-ring p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white">
                                <IconChevronR size={16} />
                            </button>
                        </div>

                        <div className="grid grid-cols-3 gap-1.5">
                            {MONTH_NAMES.map((name, idx) => {
                                const id = monthId(browseYear, idx);
                                const isActive = browseYear === year && idx === monthIndex;
                                const isCurrent = browseYear === now.getFullYear() && idx === now.getMonth();
                                const hasData = stored.has(id);
                                return (
                                    <button key={id} onClick={() => { onSelect(browseYear, idx); haptic(12); }}
                                            className={`focus-ring relative rounded-lg px-1 py-2 text-[11px] font-bold border transition-colors ${
                                                isActive ? 'bg-sky-500/15 text-sky-300 border-sky-500/50'
                                                : 'bg-slate-800/60 text-slate-300 border-slate-800 hover:bg-slate-800'}`}>
                                        {name.slice(0, 3)}
                                        {hasData && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500"></span>}
                                        {isCurrent && !isActive && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-sky-500"></span>}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-800">
                            <button onClick={() => { onSelect(now.getFullYear(), now.getMonth()); haptic(12); }}
                                    className="focus-ring flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg py-2 text-[11px] font-bold transition-colors">
                                <IconHistory size={14} /> Mes actual
                            </button>
                            <button onClick={onClose}
                                    className="focus-ring bg-slate-800/60 hover:bg-slate-800 text-slate-300 rounded-lg py-2 text-[11px] font-bold transition-colors">
                                Cerrar
                            </button>
                        </div>

                        {storedMonths.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-800">
                                <p className="text-[9px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-1.5">Meses con registro</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {storedMonths.map(m => (
                                        <button key={m.id} onClick={() => { onSelect(m.year, m.monthIndex); haptic(12); }}
                                                className="focus-ring rounded-md border border-slate-800 bg-slate-800/50 px-1.5 py-0.5 text-[10px] font-bold text-slate-300 num hover:bg-slate-800">
                                            {MONTH_TAG[m.monthIndex]} {m.year}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        /* ============================================================================
           14. CALCULADOR DE TURNO EN CALIENTE
           ============================================================================ */
        function ShiftSheet({ open, onClose, day, costs, metrics, onQuickAdd, onField }) {
            const { cash } = useCash();
            if (!open) return null;

            const c = day ? computeDay(day, costs) : null;
            const missing = c ? Math.max(c.goal - c.earned, 0) : 0;
            const ticket = num(costs.avgTicket) > 0 ? num(costs.avgTicket) : DEFAULT_COSTS.avgTicket;
            const trips = missing > 0 ? Math.ceil(missing / ticket) : 0;
            const done = c && c.goal > 0 && c.earned >= c.goal;

            return (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Calculador de turno">
                    <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm" onClick={onClose}></div>
                    <div className="relative w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-2xl p-5 sheet-in"
                         style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>

                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h2 className="text-slate-100 font-bold tracking-tight">Turno en caliente</h2>
                                <p className="text-[11px] text-slate-500 num">
                                    {day ? `${day.dateString} · ${day.dayName}` : 'Sin día seleccionado'}
                                </p>
                            </div>
                            <button onClick={onClose} aria-label="Cerrar"
                                    className="focus-ring text-slate-400 hover:text-slate-100 p-1 -mr-1 rounded-lg">
                                <IconClose size={20} />
                            </button>
                        </div>

                        {!day ? (
                            <p className="text-slate-400 text-sm">Cambia al mes en curso para usar el calculador de turno.</p>
                        ) : (
                            <div className="space-y-3">
                                <div className={`rounded-2xl border p-4 text-center ${
                                    done ? 'bg-emerald-950/30 border-emerald-800/60' : 'bg-slate-800/50 border-slate-700'}`}>
                                    <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500">
                                        {done ? 'Meta del día liberada' : 'Falta para liberar la meta'}
                                    </p>
                                    <p className={`text-3xl font-bold num mt-1 ${done ? 'text-emerald-400' : 'text-slate-100'}`}>
                                        {done ? cash(c.earned - c.goal) : cash(missing)}
                                    </p>
                                    {!done && (
                                        <p className="text-[12px] text-sky-300 font-semibold num mt-1">
                                            ≈ {trips} {trips === 1 ? 'viaje' : 'viajes'} de {cash(ticket, 0)}
                                        </p>
                                    )}
                                    {done && <p className="text-[12px] text-emerald-400/80 font-semibold mt-1">Excedente sobre la meta</p>}
                                </div>

                                <div className="grid grid-cols-3 gap-2">
                                    <div className="bg-slate-800/50 border border-slate-800 rounded-lg px-2 py-2 text-center">
                                        <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Meta</p>
                                        <p className="text-sm font-bold text-slate-100 num">{cash(c.goal, 0)}</p>
                                    </div>
                                    <div className="bg-slate-800/50 border border-slate-800 rounded-lg px-2 py-2 text-center">
                                        <p className="text-[9px] uppercase tracking-wider text-emerald-500 font-bold">Depositado hoy</p>
                                        <p className="text-sm font-bold text-emerald-400 num">{cash(c.earned, 0)}</p>
                                    </div>
                                    <div className="bg-slate-800/50 border border-slate-800 rounded-lg px-2 py-2 text-center">
                                        <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Avance</p>
                                        <p className="text-sm font-bold text-slate-100 num">{c.percentage.toFixed(0)}%</p>
                                    </div>
                                </div>

                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 mb-1.5">
                                        Sumar viaje al depósito del día
                                    </p>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[ticket, 100, 150, 250].map((amount, i) => (
                                            <button key={`${amount}-${i}`} onClick={() => onQuickAdd(day.id, amount)}
                                                    className="focus-ring bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-600/40 text-emerald-300 rounded-lg py-2.5 text-[12px] font-bold num transition-colors">
                                                +{Math.round(amount)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <MoneyField id="shift-earned" label="Depositado del día" tone="earned"
                                                value={day.earned} onChange={(v) => onField(day.id, 'earned', v)} />
                                    <MoneyField id="shift-gas" label="Gasolina del día" tone="gas"
                                                value={day.gas} onChange={(v) => onField(day.id, 'gas', v)} />
                                </div>

                                <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 space-y-1.5">
                                    <p className="flex justify-between text-[11px]">
                                        <span className="text-slate-300">Bolsillo del día</span>
                                        <span className={`font-bold num ${c.pocket >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>{cash(c.pocket)}</span>
                                    </p>
                                    <p className="flex justify-between text-[11px]">
                                        <span className="text-slate-400">Cuota diaria pendiente del mes</span>
                                        <span className="font-bold num text-slate-100">
                                            {metrics.requiredDaily > 0 ? cash(metrics.requiredDaily, 0) : 'Meta cubierta'}
                                        </span>
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        /* ============================================================================
           15. PANEL DE HERRAMIENTAS, AUDITORÍA Y RESPALDO
           ============================================================================ */
        const SheetButton = ({ onClick, icon, title, detail, accent = 'slate' }) => {
            const accents = {
                emerald: 'text-emerald-400', sky: 'text-sky-400',
                violet: 'text-violet-400', amber: 'text-amber-400', slate: 'text-slate-300'
            };
            return (
                <button onClick={onClick}
                        className="focus-ring w-full flex items-center gap-3 text-left bg-slate-800/50 hover:bg-slate-800 border border-slate-800 rounded-xl px-3 py-3 transition-colors">
                    <span className={accents[accent]}>{icon}</span>
                    <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-slate-100">{title}</span>
                        <span className="block text-[11px] text-slate-500">{detail}</span>
                    </span>
                </button>
            );
        };

        function ToolsSheet({
            open, onClose, costs, onCostChange, monthName, dayCount, storedMonths, lastSavedAt,
            onExportMonth, onExportAll, onImportFile, onExportCsv, onCopySummary, onClearMonth,
            onExportCard, onCopySettlement, onOpenLedger, soundOn, onToggleSound
        }) {
            const [armed, setArmed] = useState(false);
            const fileRef = useRef(null);

            useEffect(() => { if (!open) setArmed(false); }, [open]);
            useEffect(() => {
                if (!open) return;
                const onKey = (e) => { if (e.key === 'Escape') onClose(); };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [open, onClose]);

            if (!open) return null;


            return (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Herramientas y respaldo">
                    <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm" onClick={onClose}></div>

                    <div className="relative w-full sm:max-w-md bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-2xl p-5 sheet-in max-h-[88vh] overflow-y-auto"
                         style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>

                        <div className="flex items-start justify-between mb-4">
                            <div className="min-w-0">
                                <h2 className="text-slate-100 font-bold tracking-tight">Control y respaldo</h2>
                                <p className="text-[11px] text-slate-500 num truncate">
                                    {monthName} · {dayCount} días · {storedMonths.length} {storedMonths.length === 1 ? 'mes guardado' : 'meses guardados'}
                                    {lastSavedAt ? ` · ${lastSavedAt}` : ''}
                                </p>
                            </div>
                            <button onClick={onClose} aria-label="Cerrar"
                                    className="focus-ring text-slate-400 hover:text-slate-100 p-1 -mr-1 rounded-lg shrink-0">
                                <IconClose size={20} />
                            </button>
                        </div>

                        {/* Parámetros operativos */}
                        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-300 mb-2">
                            Parámetros de la jornada
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            <MoneyField id="cost-ticket" label="Ticket promedio" tone="unit" compact
                                        value={costs.avgTicket} onChange={(v) => onCostChange('avgTicket', v)} />
                            <MoneyField id="target-hourly" label="Meta $/hr" tone="goal" compact
                                        value={costs.targetHourly} onChange={(v) => onCostChange('targetHourly', v)} />
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2">
                            El ticket promedio alimenta el cálculo de viajes restantes; la meta por hora es el
                            referente del componente de desempeño. La app no descuenta comisiones ni impuestos:
                            lo que capturas en <span className="text-emerald-300 font-semibold">Depositado</span> ya
                            es el dinero libre que DiDi te transfirió.
                        </p>

                        {/* Respaldo y auditoría */}
                        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 mt-5 mb-2">Respaldo y auditoría</p>
                        <div className="space-y-2">
                            <SheetButton onClick={onExportMonth} icon={<IconDownload size={18} />} accent="emerald"
                                         title="Exportar mes actual" detail={`Solo ${monthName} en formato .json`} />
                            <SheetButton onClick={onExportAll} icon={<IconLayers size={18} />} accent="emerald"
                                         title="Exportar base histórica" detail={`Los ${storedMonths.length} meses registrados en un archivo`} />
                            <SheetButton onClick={() => fileRef.current && fileRef.current.click()} icon={<IconUpload size={18} />} accent="sky"
                                         title="Importar respaldo" detail="Detecta formato antiguo y multimes; fusiona sin borrar" />
                            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
                                   onChange={(e) => {
                                       const file = e.target.files && e.target.files[0];
                                       if (file) onImportFile(file);
                                       e.target.value = '';
                                   }} />
                            <SheetButton onClick={onExportCsv} icon={<IconGrid size={18} />} accent="violet"
                                         title="Exportar reporte CSV" detail="Con horas, km y $/hr · listo para Excel" />
                            <SheetButton onClick={onExportCard} icon={<IconLayers size={18} />} accent="emerald"
                                         title="Exportar ficha de rendimiento" detail="Imagen .png 1080×1920 lista para compartir" />
                            <SheetButton onClick={onCopySettlement} icon={<IconClipboard size={18} />} accent="sky"
                                         title="Cédula de liquidación" detail="Cuadro contable monoespaciado al portapapeles" />
                            <SheetButton onClick={onOpenLedger} icon={<IconGrid size={18} />} accent="violet"
                                         title="Libro diario contable" detail="Partida doble por jornada, con exportación CSV" />
                            <SheetButton onClick={onCopySummary} icon={<IconClipboard size={18} />} accent="amber"
                                         title="Copiar resumen ejecutivo" detail="Texto listo para WhatsApp o notas" />
                        </div>

                        {/* Realimentación sensorial */}
                        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-400 mt-5 mb-2">Realimentación</p>
                        <button onClick={onToggleSound} role="switch" aria-checked={soundOn}
                                style={{ minHeight: '56px' }}
                                className="focus-ring press w-full flex items-center justify-between gap-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-800 rounded-xl px-3 transition-colors">
                            <span className="flex-1 text-left">
                                <span className="block text-sm font-semibold text-slate-100">Confirmación sonora</span>
                                <span className="block text-[11px] text-slate-400">Pulsos de 440–880 Hz al registrar sin mirar</span>
                            </span>
                            <span className={`shrink-0 w-12 h-7 rounded-full border transition-colors relative ${
                                soundOn ? 'bg-emerald-600/40 border-emerald-500/60' : 'bg-slate-700 border-slate-600'}`}>
                                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-slate-100 transition-transform duration-200 ${
                                    soundOn ? 'translate-x-6' : 'translate-x-0.5'}`}></span>
                            </span>
                        </button>

                        {/* Zona sensible */}
                        <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-500 mt-5 mb-2">Zona sensible</p>
                        {!armed ? (
                            <button onClick={() => setArmed(true)}
                                    className="focus-ring w-full flex items-center gap-3 text-left bg-slate-800/50 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-800/60 rounded-xl px-3 py-3 transition-colors">
                                <span className="text-rose-400"><IconTrash size={18} /></span>
                                <span className="flex-1">
                                    <span className="block text-sm font-semibold text-slate-100">Limpiar {monthName}</span>
                                    <span className="block text-[11px] text-slate-500">Paso 1 de 2 · otros meses no se tocan</span>
                                </span>
                            </button>
                        ) : (
                            <div className="bg-rose-950/30 border border-rose-900/60 rounded-xl p-3">
                                <div className="flex items-start gap-2 mb-3">
                                    <span className="text-rose-400 mt-0.5 shrink-0"><IconAlert size={18} /></span>
                                    <p className="text-[12px] text-rose-200 leading-snug">
                                        Se borrarán ingresos, gasolina, horas, km y gastos de los {dayCount} días de {monthName}.
                                        Las metas vuelven a su valor por defecto. Exporta un respaldo antes: esto no se deshace.
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setArmed(false)}
                                            className="focus-ring bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg py-2.5 transition-colors">
                                        Cancelar
                                    </button>
                                    <button onClick={() => { setArmed(false); onClearMonth(); }}
                                            className="focus-ring bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold rounded-lg py-2.5 transition-colors">
                                        Sí, borrar el mes
                                    </button>
                                </div>
                            </div>
                        )}

                        <p className="text-[10px] text-slate-600 mt-4 leading-relaxed">
                            Los datos viven solo en este navegador: <span className="num">didi_data_AAAA_MM</span> por mes y
                            <span className="num"> didi_telemetry_meta</span> para la configuración. La clave original
                            <span className="num"> didi-tracker-app</span> se conserva sincronizada con Septiembre 2026.
                        </p>
                    </div>
                </div>
            );
        }

        /* ============================================================================
           15b. TACÓMETRO RADIAL DE TELEMETRÍA
           ============================================================================ */
        const polarPoint = (cx, cy, radius, angleDeg) => {
            const rad = (angleDeg * Math.PI) / 180;
            return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
        };

        const arcPath = (cx, cy, radius, startAngle, endAngle) => {
            const start = polarPoint(cx, cy, radius, startAngle);
            const end = polarPoint(cx, cy, radius, endAngle);
            const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
            return `M${start.x.toFixed(2)},${start.y.toFixed(2)} A${radius},${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)},${end.y.toFixed(2)}`;
        };

        function RadialGauge({ value, centerLabel, caption, footnote, tone = 'emerald' }) {
            /* El arco abre hacia abajo, así que el viewBox se recorta ahí para no dejar aire muerto */
            const SIZE = 168, VIEW_H = 140, CX = SIZE / 2, CY = 90, R = 62;
            const START = 150, SWEEP = 240;                 // arco de 240° abierto hacia abajo
            const ratio = clamp(num(value) / 100, 0, 1);
            const arcLength = (SWEEP * Math.PI * R) / 180;
            const ticks = Array.from({ length: 9 }, (_, i) => START + (SWEEP * i) / 8);

            const strokeTone = tone === 'rose' ? COLORS.crimson : tone === 'amber' ? COLORS.amber : 'url(#gaugeGradient)';

            return (
                <div>
                <svg viewBox={`0 0 ${SIZE} ${VIEW_H}`} width="100%" role="img"
                     className="block w-full h-auto max-w-[200px] mx-auto"
                     aria-label={`${caption}: ${centerLabel}`}>
                    <defs>
                        <linearGradient id="gaugeGradient" x1="0" y1="1" x2="1" y2="0">
                            <stop offset="0%" stopColor={COLORS.amber} />
                            <stop offset="55%" stopColor="#84cc16" />
                            <stop offset="100%" stopColor={COLORS.emerald} />
                        </linearGradient>
                    </defs>

                    {/* Graduación */}
                    {ticks.map((angle, i) => {
                        const outer = polarPoint(CX, CY, R + 11, angle);
                        const inner = polarPoint(CX, CY, R + (i % 2 === 0 ? 6 : 8), angle);
                        return (
                            <line key={`tick-${i}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                                  stroke={i / 8 <= ratio ? COLORS.slate500 : COLORS.slate800}
                                  strokeWidth={i % 2 === 0 ? 1.6 : 1} strokeLinecap="round" />
                        );
                    })}

                    {/* Anillo base */}
                    <path d={arcPath(CX, CY, R, START, START + SWEEP)} fill="none"
                          stroke={COLORS.slate800} strokeWidth="11" strokeLinecap="round" />

                    {/* Arco de valor animado por stroke-dashoffset */}
                    <path d={arcPath(CX, CY, R, START, START + SWEEP)} fill="none"
                          stroke={strokeTone} strokeWidth="11" strokeLinecap="round"
                          className="arc-anim"
                          strokeDasharray={`${arcLength.toFixed(2)} ${(arcLength * 2).toFixed(2)}`}
                          strokeDashoffset={(arcLength * (1 - ratio)).toFixed(2)} />

                    <text x={CX} y={CY - 6} textAnchor="middle" fill="#f1f5f9"
                          fontSize="30" fontWeight="800" fontFamily="system-ui, sans-serif"
                          style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {centerLabel}
                    </text>
                    <text x={CX} y={CY + 12} textAnchor="middle" fill={COLORS.slate500}
                          fontSize="8.5" fontWeight="700" letterSpacing="1.4"
                          fontFamily="system-ui, sans-serif">
                        {caption.toUpperCase()}
                    </text>
                </svg>
                {footnote && (
                    <p className="text-center text-[11px] text-slate-500 num -mt-1">{footnote}</p>
                )}
                </div>
            );
        }

        /* ============================================================================
           15b-2. DENSIDAD DE PROBABILIDAD (CAMPANA GAUSSIANA)
           ============================================================================ */
        function DensityChart({ samples, mu, sigma, targetDaily }) {
            const { cashShort, stealth } = useCash();
            const W = 320, H = 96, PAD_B = 16, PAD_T = 8;

            const model = useMemo(() => {
                if (samples.length < 2 || sigma <= 0) return null;
                const lo = Math.max(0, mu - 3 * sigma);
                const hi = Math.max(mu + 3 * sigma, targetDaily * 1.1, lo + 1);
                const bins = 9;
                const width = (hi - lo) / bins;
                const counts = new Array(bins).fill(0);
                samples.forEach(value => {
                    const index = clamp(Math.floor((value - lo) / width), 0, bins - 1);
                    counts[index] += 1;
                });
                const maxCount = Math.max(...counts, 1);

                /* Curva normal ajustada, escalada al alto del histograma */
                const curve = [];
                const steps = 48;
                const peak = 1 / (sigma * Math.sqrt(2 * Math.PI));
                for (let i = 0; i <= steps; i += 1) {
                    const value = lo + ((hi - lo) * i) / steps;
                    const density = (1 / (sigma * Math.sqrt(2 * Math.PI)))
                        * Math.exp(-0.5 * Math.pow((value - mu) / sigma, 2));
                    curve.push({ value, ratio: density / peak });
                }
                return { lo, hi, width, counts, maxCount, curve, bins };
            }, [samples, mu, sigma, targetDaily]);

            if (!model) {
                return (
                    <p className="text-[11px] text-slate-400">
                        Registra al menos dos jornadas para trazar la distribución de ingresos.
                    </p>
                );
            }

            const scaleX = (value) => ((value - model.lo) / (model.hi - model.lo)) * W;
            const barH = (count) => (count / model.maxCount) * (H - PAD_B - PAD_T);
            const curvePath = model.curve
                .map((point, i) => `${i === 0 ? 'M' : 'L'}${scaleX(point.value).toFixed(1)},${(H - PAD_B - point.ratio * (H - PAD_B - PAD_T)).toFixed(1)}`)
                .join(' ');

            return (
                <div>
                    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
                         className="block w-full h-auto"
                         aria-label="Distribución de ingresos diarios contra la meta media esperada">
                        {model.counts.map((count, i) => {
                            const x0 = scaleX(model.lo + i * model.width);
                            const barWidth = (W / model.bins) - 3;
                            const height = barH(count);
                            return (
                                <rect key={`bin-${i}`} x={x0 + 1.5} y={H - PAD_B - height}
                                      width={Math.max(barWidth, 2)} height={Math.max(height, count > 0 ? 2 : 0)}
                                      rx="2" fill={COLORS.emerald} fillOpacity={count > 0 ? 0.35 : 0} />
                            );
                        })}

                        <path d={curvePath} fill="none" stroke={COLORS.cyan} strokeWidth="1.8" strokeLinecap="round" />

                        <line x1={scaleX(mu)} x2={scaleX(mu)} y1={PAD_T - 4} y2={H - PAD_B}
                              stroke={COLORS.emerald} strokeWidth="1.6" />
                        <text x={clamp(scaleX(mu), 16, W - 16)} y={PAD_T - 1} fill={COLORS.emerald}
                              fontSize="8.5" fontWeight="700" textAnchor="middle" fontFamily="system-ui, sans-serif">
                            μ {stealth ? '•••' : cashShort(mu)}
                        </text>

                        {targetDaily > 0 && targetDaily < model.hi && (
                            <>
                                <line x1={scaleX(targetDaily)} x2={scaleX(targetDaily)} y1={PAD_T - 4} y2={H - PAD_B}
                                      stroke={COLORS.amber} strokeWidth="1.6" strokeDasharray="3 3" />
                                <text x={clamp(scaleX(targetDaily), 20, W - 20)} y={H - 4} fill={COLORS.amber}
                                      fontSize="8.5" fontWeight="700" textAnchor="middle" fontFamily="system-ui, sans-serif">
                                    meta {stealth ? '•••' : cashShort(targetDaily)}
                                </text>
                            </>
                        )}

                        <line x1="0" x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke={COLORS.slate700} strokeWidth="1" />
                    </svg>
                </div>
            );
        }

        /* ============================================================================
           15b-3. PANEL PREDICTIVO: MONTE CARLO, HOLT, OEE Y ELASTICIDAD
           ============================================================================ */
        function PredictivePanel({ prediction, metrics, samples, targetDaily }) {
            const embedded = useContext(EmbedCtx);
            const { cash } = useCash();
            const [open, setOpen] = useState(false);
            const mc = prediction.monteCarlo;
            const probability = mc.probability;

            const probTone = probability >= 70 ? 'text-emerald-400'
                : probability >= 40 ? 'text-amber-400' : 'text-rose-400';

            return (
                <section className={embedded ? 'p-4 pt-3' : 'bg-slate-900 rounded-2xl border border-slate-800 p-4'}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                            <h2 className="text-slate-100 text-sm font-semibold tracking-tight">Pronóstico estocástico</h2>
                            <p className="text-slate-400 text-[11px]">
                                {prediction.enoughData
                                    ? `${mc.runs.toLocaleString('es-MX')} simulaciones sobre ${mc.days} ${mc.days === 1 ? 'día restante' : 'días restantes'}`
                                    : 'Necesita al menos 3 jornadas registradas'}
                            </p>
                        </div>
                        <StatPill label="Monte Carlo" value={`${prediction.elapsedMs.toFixed(1)} ms`} tone="sky" />
                    </div>

                    {!prediction.enoughData ? (
                        <p className="text-[12px] text-slate-400">
                            Captura tres jornadas para que el modelo tenga media y desviación con las que simular
                            el resto del mes.
                        </p>
                    ) : (
                        <>
                            <div className="flex items-end justify-between gap-3">
                                <div>
                                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-bold">
                                        Probabilidad de cerrar la meta
                                    </p>
                                    <p className={`text-4xl font-extrabold num leading-none mt-1 ${probTone}`}>
                                        {probability.toFixed(1)}%
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Esperado</p>
                                    <p className="text-lg font-bold num text-slate-100">{cash(mc.expected, 0)}</p>
                                    <p className="text-[10px] text-slate-400 num">meta {cash(mc.goal, 0)}</p>
                                </div>
                            </div>

                            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden mt-3">
                                <div className={`h-2 rounded-full transition-all duration-700 ${
                                    probability >= 70 ? 'bg-emerald-500' : probability >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                     style={{ width: `${clamp(probability, 0, 100)}%` }}></div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mt-3">
                                <div className="rounded-xl bg-rose-950/20 border border-rose-900/40 px-3 py-2">
                                    <p className="text-[9px] uppercase tracking-wider text-rose-400 font-bold">Pesimista · P5</p>
                                    <p className="text-base font-bold num text-rose-300">{cash(mc.p5, 0)}</p>
                                </div>
                                <div className="rounded-xl bg-emerald-950/20 border border-emerald-900/40 px-3 py-2">
                                    <p className="text-[9px] uppercase tracking-wider text-emerald-400 font-bold">Optimista · P95</p>
                                    <p className="text-base font-bold num text-emerald-300">{cash(mc.p95, 0)}</p>
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-400 num mt-1.5 text-center">
                                Rango de confianza al 90% · mediana {cash(mc.p50, 0)}
                            </p>

                            <div className="mt-4 pt-3 border-t border-slate-800">
                                <DensityChart samples={samples} mu={prediction.mu} sigma={prediction.sigma}
                                              targetDaily={targetDaily} />
                                <p className="text-[10px] text-slate-400 text-center num">
                                    Distribución de jornadas · μ {cash(prediction.mu, 0)} · σ {cash(prediction.sigma, 0)}
                                </p>
                            </div>

                            <button onClick={() => { setOpen(o => !o); feedback.tap(); }} aria-expanded={open}
                                    className="focus-ring press w-full mt-3 flex items-center justify-between gap-2 rounded-xl bg-slate-800/50 border border-slate-800 px-3 py-3 transition-colors">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                                    Modelos avanzados
                                </span>
                                <span className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
                                    <IconChevronD size={16} />
                                </span>
                            </button>

                            {open && (
                                <div className="mt-3 space-y-3 fade-in">
                                    {/* Holt */}
                                    <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-bold text-sky-300">Suavizado de Holt</span>
                                            <span className="text-[10px] text-slate-400 num">α 0.3 · β 0.1</span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 mt-2">
                                            <MiniStat label="Nivel" value={cash(prediction.holt.level, 0)} />
                                            <MiniStat label="Tendencia" value={`${prediction.holt.trend >= 0 ? '+' : ''}${cash(prediction.holt.trend, 0)}`}
                                                      tone={prediction.holt.trend >= 0 ? 'text-emerald-400' : 'text-rose-300'} />
                                            <MiniStat label="Mañana" value={cash(prediction.holt.forecast, 0)} tone="text-sky-300" />
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-1.5">
                                            Proyección del depósito de la próxima jornada, amortiguando días atípicos.
                                        </p>
                                    </div>

                                    {/* OEE */}
                                    <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-bold text-violet-300">OEE de conducción</span>
                                            <span className={`text-base font-bold num ${
                                                prediction.oee.oee === null ? 'text-slate-400'
                                                : prediction.oee.oee >= 0.35 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                {prediction.oee.oee === null ? '—' : pctText(prediction.oee.oee * 100, 1)}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 mt-2">
                                            <MiniStat label="Disponibilidad" value={pctText(prediction.oee.availability * 100, 0)}
                                                      hint={`${prediction.oee.worked}/${prediction.oee.scheduled} días`} />
                                            <MiniStat label="Desempeño"
                                                      value={prediction.oee.performance === null ? '—' : pctText(prediction.oee.performance * 100, 0)}
                                                      hint={`vs ${cash(prediction.oee.target, 0)}/h`} />
                                            <MiniStat label="Calidad" value={pctText(prediction.oee.quality * 100, 0)}
                                                      hint="margen neto" />
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-1.5">{prediction.oee.verdict}</p>
                                    </div>

                                    {/* Elasticidad */}
                                    <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-bold text-amber-300">Rendimiento marginal del combustible</span>
                                        </div>
                                        {prediction.fuel.avgMarginal === null ? (
                                            <p className="text-[11px] text-slate-400 mt-1">
                                                Necesita tres jornadas con gasolina registrada.
                                            </p>
                                        ) : (
                                            <>
                                                <div className="grid grid-cols-2 gap-2 mt-2">
                                                    <MiniStat label="Δ Neto / Δ Gasolina"
                                                              value={`${prediction.fuel.avgMarginal.toFixed(2)}×`}
                                                              tone={prediction.fuel.avgMarginal >= 1 ? 'text-emerald-400' : 'text-amber-400'}
                                                              hint="peso neto por peso de gas" />
                                                    <MiniStat label="Elasticidad arco"
                                                              value={prediction.fuel.elasticity === null ? '—' : prediction.fuel.elasticity.toFixed(2)}
                                                              hint="sensibilidad del neto" />
                                                </div>
                                                <p className={`text-[10px] mt-1.5 ${
                                                    prediction.fuel.inflection ? 'text-amber-300' : 'text-slate-400'}`}>
                                                    {prediction.fuel.inflection
                                                        ? `Punto de inflexión cerca de ${cash(prediction.fuel.inflection.gas, 0)} de gasolina: más allá, rodar añade desgaste sin pagar el neto.`
                                                        : 'Cada peso extra de gasolina sigue devolviendo neto positivo: no hay rendimientos decrecientes en el rango registrado.'}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </section>
            );
        }

        const MiniStat = ({ label, value, hint, tone = 'text-slate-100' }) => (
            <div className="rounded-lg bg-slate-900/70 border border-slate-800 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold truncate">{label}</p>
                <p className={`text-[13px] font-bold num ${tone}`}>{value}</p>
                {hint && <p className="text-[9px] text-slate-500 num truncate">{hint}</p>}
            </div>
        );

        /* ============================================================================
           15b-4. ESTADO DE RESULTADOS EN CASCADA
           ============================================================================ */
        const LedgerRow = ({ label, value, detail, tone = 'normal', indent, strong, rule }) => {
            const tones = {
                normal: 'text-slate-100', cost: 'text-rose-300',
                subtotal: 'text-sky-200', result: 'text-emerald-300', muted: 'text-slate-300'
            };
            return (
                <div className={`flex items-baseline justify-between gap-3 py-1.5 ${rule ? 'border-t border-slate-700 mt-1 pt-2' : ''}`}>
                    <span className={`min-w-0 ${indent ? 'pl-3' : ''}`}>
                        <span className={`block text-[11px] ${strong ? 'font-bold' : 'font-medium'} ${
                            tone === 'cost' ? 'text-slate-300' : 'text-slate-200'} truncate`}>{label}</span>
                        {detail && <span className="block text-[9px] text-slate-400 num truncate">{detail}</span>}
                    </span>
                    <span className={`num shrink-0 ${strong ? 'text-[15px] font-extrabold' : 'text-[13px] font-bold'} ${tones[tone]}`}>
                        {value}
                    </span>
                </div>
            );
        };

        function IncomeStatementPanel({ metrics, basis, onBasis }) {
            const { cash } = useCash();
            const [openState, setOpen] = useState(false);
            /* Dentro de un grupo el panel va siempre abierto y sin su propio encabezado */
            const embedded = useContext(EmbedCtx);
            const open = openState || embedded;
            const accrual = basis === 'accrual';

            return (
                <section className={embedded ? 'pt-3' : 'bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden'}>
                    {!embedded && (
                    <button onClick={() => { setOpen(o => !o); feedback.tap(); }} aria-expanded={open}
                            className="focus-ring w-full flex items-center justify-between gap-3 p-4 text-left">
                        <span className="flex items-center gap-2 min-w-0">
                            <span className="text-emerald-400 shrink-0"><IconGrid size={16} /></span>
                            <span className="min-w-0">
                                <span className="block text-slate-100 text-sm font-semibold tracking-tight">Estado de resultados</span>
                                <span className="block text-slate-400 text-[11px] truncate num">
                                    Margen de contribución {pctText(metrics.contributionRatio, 1)} ·
                                    utilidad de caja {cash(metrics.operatingCashFlow, 0)}
                                </span>
                            </span>
                        </span>
                        <span className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
                            <IconChevronD size={18} />
                        </span>
                    </button>
                    )}

                    {open && (
                        <div className="px-4 pb-4 fade-in">
                            {/* Conmutador de base contable */}
                            <div className="grid grid-cols-2 gap-2 mb-3">
                                <button onClick={() => { onBasis('cash'); feedback.tap(); }} aria-pressed={!accrual}
                                        style={{ minHeight: '54px' }}
                                        className={`focus-ring press rounded-xl border px-3 text-left transition-colors ${
                                            !accrual ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-200'
                                                     : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}>
                                    <span className="block text-[12px] font-bold">Flujo de caja</span>
                                    <span className="block text-[10px] opacity-80">Gasto el día que se pagó</span>
                                </button>
                                <button onClick={() => { onBasis('accrual'); feedback.tap(); }} aria-pressed={accrual}
                                        style={{ minHeight: '54px' }}
                                        className={`focus-ring press rounded-xl border px-3 text-left transition-colors ${
                                            accrual ? 'bg-sky-500/15 border-sky-500/60 text-sky-200'
                                                    : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}>
                                    <span className="block text-[12px] font-bold">Devengado</span>
                                    <span className="block text-[10px] opacity-80">Consumo prorrateado por km</span>
                                </button>
                            </div>

                            {accrual && (
                                <p className={`text-[10px] rounded-lg px-2.5 py-2 mb-3 ${
                                    metrics.accrualActive ? 'bg-sky-950/30 border border-sky-900/50 text-sky-200'
                                                          : 'bg-amber-950/30 border border-amber-900/50 text-amber-200'}`}>
                                    {metrics.accrualActive
                                        ? `Costo medio ponderado ${cash(metrics.weightedGasPerKm)} por km. El combustible se imputa por kilómetros recorridos, no por la fecha de la carga; el total del mes no cambia.`
                                        : 'Captura kilómetros en las jornadas para poder prorratear el consumo: sin km la vista devengada no tiene base de reparto.'}
                                </p>
                            )}

                            <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2">
                                <LedgerRow label="Ingresos operativos netos" strong tone="normal"
                                           detail={`${metrics.workedDays} jornadas liquidadas`}
                                           value={cash(metrics.totalEarned)} />

                                <LedgerRow label="(−) Combustible" tone="cost" indent
                                           detail={accrual && metrics.accrualActive
                                               ? `devengado · pagado ${cash(metrics.totalGasPaid, 0)}`
                                               : `${pctText(metrics.fuelAbsorption, 1)} del ingreso`}
                                           value={`(${cash(metrics.totalGas)})`} />
                                <LedgerRow label="(−) Peajes y casetas" tone="cost" indent
                                           value={`(${cash(metrics.totalTolls)})`} />

                                <LedgerRow label="(=) Margen de contribución" strong tone="subtotal" rule
                                           detail={`Ratio ${pctText(metrics.contributionRatio, 1)}`}
                                           value={cash(metrics.contributionMargin)} />

                                <LedgerRow label="(−) Lavado y acondicionamiento" tone="cost" indent
                                           value={`(${cash(metrics.totalWash)})`} />
                                <LedgerRow label="(−) Misceláneos de ruta" tone="cost" indent
                                           value={`(${cash(metrics.totalMisc)})`} />

                                <LedgerRow label="(=) Utilidad neta operativa de caja" strong tone="result" rule
                                           detail={`Margen operativo ${pctText(metrics.returnRate, 1)}`}
                                           value={cash(metrics.operatingCashFlow)} />
                            </div>

                            {/* Ratios de unit economics */}
                            <p className="text-[10px] uppercase tracking-[0.12em] font-bold text-slate-300 mt-4 mb-2">
                                Ratios de eficiencia
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                                <MiniStat label="Absorción de combustible" value={pctText(metrics.fuelAbsorption, 1)}
                                          tone={metrics.fuelAbsorption <= 25 ? 'text-emerald-400' : metrics.fuelAbsorption <= 40 ? 'text-amber-300' : 'text-rose-300'}
                                          hint="del ingreso depositado" />
                                <MiniStat label="Costo por hora de servicio"
                                          value={metrics.costPerServiceHour !== null ? cash(metrics.costPerServiceHour) : '—'}
                                          hint={metrics.totalHours > 0 ? `${money(metrics.totalHours, 1)} h activas` : 'captura horas'} />
                                <MiniStat label="Retención marginal"
                                          value={pctText(metrics.marginalRetention * 100, 1)}
                                          tone="text-sky-300"
                                          hint="de cada peso extra facturado" />
                                <MiniStat label="Apalancamiento operativo"
                                          value={metrics.operatingLeverage !== null ? `${metrics.operatingLeverage.toFixed(2)}×` : '—'}
                                          hint="margen ÷ utilidad de caja" />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-2">
                                Cubiertos los costos de la jornada, cada peso adicional deja
                                {' '}<span className="text-emerald-300 font-bold num">{pctText(metrics.marginalRetention * 100, 0)}</span>
                                {' '}íntegro en caja: los peajes y el combustible ya están pagados.
                            </p>
                        </div>
                    )}
                </section>
            );
        }

        /* ============================================================================
           15b-5. CONCILIACIÓN SEMANAL Y ARQUEO DE TESORERÍA
           ============================================================================ */
        function SettlementPanel({ metrics, settlements, onSettlement, onPickDay }) {
            const { cash } = useCash();
            const [openState, setOpen] = useState(false);
            /* Dentro de un grupo el panel va siempre abierto y sin su propio encabezado */
            const embedded = useContext(EmbedCtx);
            const open = openState || embedded;
            const weeks = metrics.weeks;

            return (
                <section className={embedded ? 'pt-3' : 'bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden'}>
                    {!embedded && (
                    <button onClick={() => { setOpen(o => !o); feedback.tap(); }} aria-expanded={open}
                            className="focus-ring w-full flex items-center justify-between gap-3 p-4 text-left">
                        <span className="flex items-center gap-2 min-w-0">
                            <span className="text-sky-400 shrink-0"><IconCalendar size={16} /></span>
                            <span className="min-w-0">
                                <span className="block text-slate-100 text-sm font-semibold tracking-tight">Conciliación semanal</span>
                                <span className="block text-slate-400 text-[11px] truncate num">
                                    {weeks.length} cortes · efectivo en mano {cash(metrics.totalCashOnHand, 0)}
                                </span>
                            </span>
                        </span>
                        <span className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
                            <IconChevronD size={18} />
                        </span>
                    </button>
                    )}

                    {open && (
                        <div className="px-4 pb-4 space-y-2.5 fade-in">
                            {/* Arqueo dual del mes */}
                            <div className="grid grid-cols-3 gap-2">
                                <MiniStat label="Efectivo cobrado" value={cash(metrics.totalCashCollected, 0)} tone="text-emerald-400" />
                                <MiniStat label="Saldo en app" value={cash(metrics.totalAppDeposit, 0)} tone="text-sky-300" />
                                <MiniStat label="Efectivo líquido" value={cash(metrics.totalCashOnHand, 0)}
                                          tone={metrics.totalCashOnHand >= 0 ? 'text-emerald-400' : 'text-rose-300'}
                                          hint="tras pagar ruta" />
                            </div>
                            {metrics.totalCashOnHand < 0 && (
                                <p className="text-[11px] rounded-lg bg-rose-950/30 border border-rose-900/50 text-rose-200 px-2.5 py-2">
                                    Financiaste {cash(Math.abs(metrics.totalCashOnHand))} de costos operativos con dinero propio:
                                    el efectivo cobrado no alcanzó a cubrir gasolina, peajes y varios.
                                </p>
                            )}

                            {weeks.map(week => {
                                const record = settlements[week.index] || {};
                                const bank = num(record.bank);
                                const diff = bank > 0 ? bank - week.earned : 0;
                                const squared = bank > 0 && Math.abs(diff) < 0.01;
                                return (
                                    <div key={week.index} className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <button onClick={() => onPickDay(week.fromId)}
                                                    className="focus-ring text-left min-w-0">
                                                <span className="block text-[12px] font-bold text-slate-100 num truncate">
                                                    Semana {week.index} · {week.from} – {week.to}
                                                </span>
                                                <span className="block text-[10px] text-slate-400 num">
                                                    {week.worked} {week.worked === 1 ? 'jornada' : 'jornadas'} liquidadas
                                                </span>
                                            </button>
                                            <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                                                record.reconciled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                                                                  : 'bg-slate-700/50 text-slate-300 border-slate-600'}`}>
                                                {record.reconciled ? 'Conciliado' : 'En curso'}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2 mt-2">
                                            <MiniStat label="Facturado" value={cash(week.earned, 0)} tone="text-emerald-400" />
                                            <MiniStat label="Egresos" value={cash(week.egress, 0)} tone="text-rose-300" />
                                            <MiniStat label="Margen" value={cash(week.margin, 0)}
                                                      tone={week.margin >= 0 ? 'text-slate-100' : 'text-rose-300'}
                                                      hint={pctText(week.marginRatio, 0)} />
                                        </div>

                                        <div className="flex items-end gap-2 mt-2">
                                            <div className="flex-1 min-w-0">
                                                <MoneyField id={`bank-${week.index}`} label="Depósito del banco" tone="unit" compact
                                                            value={record.bank === undefined ? '' : record.bank}
                                                            onChange={(v) => onSettlement(week.index, { bank: v })} />
                                            </div>
                                            <button onClick={() => onSettlement(week.index, { reconciled: !record.reconciled })}
                                                    style={{ minHeight: '54px', minWidth: '54px' }}
                                                    aria-pressed={!!record.reconciled}
                                                    aria-label={`Marcar semana ${week.index} como conciliada`}
                                                    className={`focus-ring press rounded-xl border flex items-center justify-center px-3 transition-colors ${
                                                        record.reconciled ? 'bg-emerald-600/20 border-emerald-500/60 text-emerald-300'
                                                                          : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
                                                <IconCheck size={20} />
                                            </button>
                                        </div>

                                        {bank > 0 && (
                                            <p className={`text-[11px] num mt-1.5 ${
                                                squared ? 'text-emerald-300'
                                                        : Math.abs(diff) < 1 ? 'text-amber-300' : 'text-rose-300'}`}>
                                                {squared
                                                    ? 'Cuadra exacto con los registros de la semana.'
                                                    : `Descuadre de ${cash(Math.abs(diff))} ${diff > 0 ? 'a favor del banco' : 'a favor de tus registros'}${Math.abs(diff) < 1 ? ' (ajuste de centavos de la plataforma)' : ''}.`}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            );
        }

        /* ============================================================================
           15b-6. ANÁLISIS DE VARIACIONES PRESUPUESTARIAS
           ============================================================================ */
        function VariancePanel({ metrics }) {
            const embedded = useContext(EmbedCtx);
            const { cash } = useCash();
            const v = metrics.variance;
            const deficit = v.total < 0;

            const bar = (share, tone) => (
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-1">
                    <div className={`${tone} h-1.5 rounded-full transition-all duration-500`}
                         style={{ width: `${clamp(share, 0, 100)}%` }}></div>
                </div>
            );

            const diagnosis = () => {
                if (Math.abs(v.total) < 1) return 'La operación va exactamente sobre el presupuesto del mes.';
                const dominant = v.volumeShare >= v.performanceShare && v.volumeShare >= v.residualShare
                    ? 'volumen' : (v.performanceShare >= v.residualShare ? 'rendimiento' : 'calendario');
                const word = deficit ? 'del déficit' : 'del excedente';
                if (dominant === 'volumen') {
                    return `El ${pctText(v.volumeShare, 0)} ${word} se explica por los días trabajados frente a los programados (volumen); el ${pctText(v.performanceShare, 0)} por el rendimiento de cada jornada.`;
                }
                if (dominant === 'rendimiento') {
                    return `El ${pctText(v.performanceShare, 0)} ${word} viene del rendimiento por jornada respecto al objetivo diario; el ${pctText(v.volumeShare, 0)} del número de días trabajados.`;
                }
                return `El ${pctText(v.residualShare, 0)} ${word} corresponde a jornadas programadas que todavía no se trabajan; el resto se reparte entre volumen y rendimiento.`;
            };

            return (
                <section className={embedded ? 'p-4 pt-3' : 'bg-slate-900 rounded-2xl border border-slate-800 p-4'}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                            <h2 className="text-slate-100 text-sm font-semibold tracking-tight">Análisis de variaciones</h2>
                            <p className="text-slate-400 text-[11px]">Real contra presupuesto, descompuesto por causa</p>
                        </div>
                        <span className={`shrink-0 text-lg font-extrabold num ${deficit ? 'text-rose-300' : 'text-emerald-400'}`}>
                            {v.total >= 0 ? '+' : '−'}{cash(Math.abs(v.total), 0)}
                        </span>
                    </div>

                    <div className="space-y-2.5">
                        <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-2.5">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[11px] font-bold text-slate-100">Variación volumen</span>
                                <span className={`text-[13px] font-bold num ${v.volume >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
                                    {v.volume >= 0 ? '+' : '−'}{cash(Math.abs(v.volume), 0)}
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400 num">
                                {v.workedDays} días trabajados vs. {v.goalDays} programados × meta media {cash(v.avgDailyGoal, 0)}
                            </p>
                            {bar(v.volumeShare, v.volume >= 0 ? 'bg-emerald-500' : 'bg-rose-500')}
                        </div>

                        <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-2.5">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[11px] font-bold text-slate-100">Variación rendimiento</span>
                                <span className={`text-[13px] font-bold num ${v.performance >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
                                    {v.performance >= 0 ? '+' : '−'}{cash(Math.abs(v.performance), 0)}
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400">
                                Suma de lo que cada jornada trabajada quedó por encima o por debajo de su objetivo
                            </p>
                            {bar(v.performanceShare, v.performance >= 0 ? 'bg-emerald-500' : 'bg-rose-500')}
                        </div>

                        <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-2.5">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[11px] font-bold text-slate-100">Jornadas por cursar</span>
                                <span className="text-[13px] font-bold num text-slate-300">
                                    {v.residual >= 0 ? '+' : '−'}{cash(Math.abs(v.residual), 0)}
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400">
                                Presupuesto de días programados que aún no se registran
                            </p>
                            {bar(v.residualShare, 'bg-slate-500')}
                        </div>
                    </div>

                    <p className="text-[11px] text-slate-300 mt-3 pt-3 border-t border-slate-800">{diagnosis()}</p>
                </section>
            );
        }

        /* ============================================================================
           15b-7. AUDITOR DE ASIENTOS Y CONTROL INTERNO
           ============================================================================ */
        function AuditorPanel({ flags, onPickDay }) {
            const [openState, setOpen] = useState(false);
            /* Dentro de un grupo el panel va siempre abierto y sin su propio encabezado */
            const embedded = useContext(EmbedCtx);
            const open = openState || embedded;
            const errors = flags.filter(f => f.severity === 'error').length;
            const warns = flags.filter(f => f.severity === 'warn').length;

            const severityStyle = {
                error: 'bg-rose-950/30 border-rose-900/60 text-rose-200',
                warn: 'bg-amber-950/25 border-amber-900/50 text-amber-200',
                info: 'bg-sky-950/25 border-sky-900/50 text-sky-200'
            };

            return (
                <section className={embedded ? 'pt-3' : 'bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden'}>
                    {!embedded && (
                    <button onClick={() => { setOpen(o => !o); feedback.tap(); }} aria-expanded={open}
                            className="focus-ring w-full flex items-center justify-between gap-3 p-4 text-left">
                        <span className="flex items-center gap-2 min-w-0">
                            <span className={flags.length === 0 ? 'text-emerald-400 shrink-0' : 'text-amber-400 shrink-0'}>
                                {flags.length === 0 ? <IconCheck size={16} /> : <IconAlert size={16} />}
                            </span>
                            <span className="min-w-0">
                                <span className="block text-slate-100 text-sm font-semibold tracking-tight">Auditoría de asientos</span>
                                <span className="block text-slate-400 text-[11px] truncate">
                                    {flags.length === 0
                                        ? 'Sin observaciones: el registro del mes cuadra'
                                        : `${flags.length} ${flags.length === 1 ? 'observación' : 'observaciones'}${errors > 0 ? ` · ${errors} crítica${errors === 1 ? '' : 's'}` : ''}${warns > 0 ? ` · ${warns} por revisar` : ''}`}
                                </span>
                            </span>
                        </span>
                        <span className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
                            <IconChevronD size={18} />
                        </span>
                    </button>
                    )}

                    {open && (
                        <div className="px-4 pb-4 space-y-2 fade-in">
                            {flags.length === 0 ? (
                                <p className="text-[12px] text-slate-300">
                                    Ninguna jornada presenta horas o kilómetros sin ingreso, costos sin actividad
                                    ni márgenes fuera de rango.
                                </p>
                            ) : flags.map((flag, i) => (
                                <button key={`${flag.id}-${flag.type}-${i}`}
                                        onClick={() => { onPickDay(flag.id); feedback.tap(); }}
                                        style={{ minHeight: '54px' }}
                                        className={`focus-ring press w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${severityStyle[flag.severity]}`}>
                                    <span className="flex items-center justify-between gap-2">
                                        <span className="text-[12px] font-bold truncate">{flag.title}</span>
                                        <span className="text-[11px] font-bold num shrink-0">{flag.label} ›</span>
                                    </span>
                                    <span className="block text-[10px] opacity-85 num mt-0.5">{flag.detail}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            );
        }

        /* ============================================================================
           15c. PACING ADAPTATIVO Y PROYECCIÓN POR PERFIL DE DÍA
           ============================================================================ */
        function PacingStrategyPanel({ metrics, mode, onMode }) {
            const embedded = useContext(EmbedCtx);
            const { cash } = useCash();
            const { rebalance, projection } = metrics;
            const relief = mode === 'relief';

            return (
                <section className={embedded ? 'p-4 pt-3' : 'bg-slate-900 rounded-2xl border border-slate-800 p-4'}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                            <h2 className="text-slate-100 text-sm font-semibold tracking-tight">Estrategia de cuota</h2>
                            <p className="text-slate-400 text-[11px]">
                                {rebalance.pendingCount} {rebalance.pendingCount === 1 ? 'jornada pendiente' : 'jornadas pendientes'} ·
                                faltan {cash(rebalance.remaining, 0)}
                            </p>
                        </div>
                    </div>

                    {/* Conmutador de estrategia */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                        <button onClick={() => { onMode('relief'); feedback.tap(); }}
                                aria-pressed={relief} style={{ minHeight: '56px' }}
                                className={`focus-ring press rounded-xl border px-3 text-left transition-colors ${
                                    relief ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-200'
                                           : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}>
                            <span className="block text-[12px] font-bold">Alivio de jornada</span>
                            <span className="block text-[10px] opacity-80">Bajar la cuota diaria</span>
                        </button>
                        <button onClick={() => { onMode('record'); feedback.tap(); }}
                                aria-pressed={!relief} style={{ minHeight: '56px' }}
                                className={`focus-ring press rounded-xl border px-3 text-left transition-colors ${
                                    !relief ? 'bg-sky-500/15 border-sky-500/60 text-sky-200'
                                            : 'bg-slate-800/50 border-slate-700 text-slate-300'}`}>
                            <span className="block text-[12px] font-bold">Modo récord</span>
                            <span className="block text-[10px] opacity-80">Mantener el ritmo</span>
                        </button>
                    </div>

                    {relief ? (
                        <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-3">
                            {rebalance.goalReached ? (
                                <>
                                    <p className="text-[11px] uppercase tracking-wider text-slate-300 font-bold">Meta mensual cubierta</p>
                                    <p className="text-2xl font-bold num text-emerald-400 mt-1">
                                        +{cash(Math.abs(metrics.goalGap), 0)}
                                    </p>
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        Las jornadas que faltan son ganancia libre: no necesitas cuota para cerrar el mes.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="text-[11px] uppercase tracking-wider text-slate-300 font-bold">
                                        Nueva cuota por jornada pendiente
                                    </p>
                                    <div className="flex items-baseline gap-2 mt-1">
                                        <p className="text-2xl font-bold num text-emerald-400">{cash(rebalance.reliefDaily, 0)}</p>
                                        {rebalance.dailyRelief > 0.5 && (
                                            <span className="text-[12px] font-bold num text-slate-400 line-through">
                                                {cash(rebalance.originalDaily, 0)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        {rebalance.dailyRelief > 0.5
                                            ? `Ganas ${cash(rebalance.dailyRelief, 0)} menos por día (${pctText(rebalance.reliefRatio, 0)} de alivio) y aun así cierras el 100% de la meta.`
                                            : 'Todavía no hay excedente que repartir: la cuota sigue igual a la meta programada.'}
                                    </p>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-3 py-3">
                            <p className="text-[11px] uppercase tracking-wider text-slate-300 font-bold">
                                Cierre proyectado manteniendo las metas
                            </p>
                            <p className={`text-2xl font-bold num mt-1 ${
                                rebalance.recordSurplus >= 0 ? 'text-sky-300' : 'text-amber-300'}`}>
                                {rebalance.recordSurplus >= 0 ? '+' : ''}{cash(rebalance.recordSurplus, 0)}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1">
                                {rebalance.recordSurplus >= 0
                                    ? `Vas rumbo a cerrar con ${cash(rebalance.recordSurplus, 0)} sobre tu meta mensual.`
                                    : `A este perfil de días te quedarías ${cash(Math.abs(rebalance.recordSurplus), 0)} corto: hay que subir el ritmo.`}
                            </p>
                        </div>
                    )}

                    {/* Descansos ganados */}
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2.5 mt-2">
                        <span className="min-w-0">
                            <span className="block text-[11px] font-bold text-slate-100">Días de descanso ganados</span>
                            <span className="block text-[10px] text-slate-400 num">
                                Excedente {cash(rebalance.surplusNow, 0)} ÷ jornada media {cash(metrics.avgEarned, 0)}
                            </span>
                        </span>
                        <span className={`text-2xl font-extrabold num shrink-0 ${
                            rebalance.earnedRest > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                            {rebalance.earnedRest}
                        </span>
                    </div>

                    {/* Proyección estratificada */}
                    <div className="mt-3 pt-3 border-t border-slate-800">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-slate-100">Proyección por perfil de día</span>
                            <span className="text-base font-bold num text-slate-100">{cash(projection.projected, 0)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <ClusterCard cluster={metrics.clusterStats.base} tone="sky" />
                            <ClusterCard cluster={metrics.clusterStats.peak} tone="emerald" />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2 num">
                            {projection.fromHistory} días proyectados con su media histórica ·
                            {' '}{projection.fromGoal} con su meta programada ·
                            {' '}{projection.delta >= 0 ? '+' : ''}{cash(projection.delta, 0)} frente al promedio plano.
                        </p>
                    </div>
                </section>
            );
        }

        const ClusterCard = ({ cluster, tone }) => {
            const { cash } = useCash();
            const accent = tone === 'emerald' ? 'text-emerald-400' : 'text-sky-300';
            return (
                <div className="rounded-xl bg-slate-800/40 border border-slate-800 px-2.5 py-2">
                    <p className="text-[10px] font-bold text-slate-100 truncate">{cluster.label}</p>
                    <p className="text-[9px] text-slate-400 truncate">{cluster.detail}</p>
                    <p className={`text-base font-bold num mt-0.5 ${accent}`}>
                        {cluster.count > 0 ? cash(cluster.avgEarned, 0) : '—'}
                    </p>
                    <p className="text-[9px] text-slate-400 num">
                        {cluster.count > 0 ? `${cluster.count} ${cluster.count === 1 ? 'jornada' : 'jornadas'}` : 'sin registro'}
                    </p>
                </div>
            );
        };

        /* ============================================================================
           15c-2. VELOCÍMETRO DE TURNO EN VIVO
           ============================================================================ */
        function ShiftSpeedometer({ day, costs }) {
            const { cash } = useCash();
            const c = useMemo(() => (day ? computeDay(day, costs) : null), [day, costs]);
            if (!c || c.hours <= 0) return null;

            const ratio = c.requiredHourly && c.requiredHourly > 0 && c.realHourly !== null
                ? clamp((c.realHourly / c.requiredHourly) * 100, 0, 150)
                : null;
            const hours = c.hoursToGoal !== null ? Math.floor(c.hoursToGoal) : null;
            const minutes = c.hoursToGoal !== null ? Math.round((c.hoursToGoal - hours) * 60) : null;

            return (
                <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2.5 mb-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">Ritmo del turno</span>
                        <span className="text-[13px] font-bold num text-sky-300">{cash(c.realHourly)}/h</span>
                    </div>
                    {c.requiredHourly !== null && (
                        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-2">
                            <div className={`h-1.5 rounded-full transition-all duration-500 ${
                                ratio >= 100 ? 'bg-emerald-500' : ratio >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                 style={{ width: `${clamp(ratio || 0, 0, 100)}%` }}></div>
                        </div>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1.5">
                        {c.hoursToGoal === null
                            ? (c.earned >= c.goal && c.goal > 0
                                ? 'Meta del día liberada.'
                                : 'Captura el depósito del día para estimar el cierre.')
                            : `A este ritmo, liberas la meta en ~${hours} h ${String(minutes).padStart(2, '0')} min.`}
                        {c.requiredHourly !== null && c.hoursToGoal !== null && (
                            <span className="text-slate-400"> Objetivo {cash(c.requiredHourly)}/h.</span>
                        )}
                    </p>
                </div>
            );
        }

        /* ============================================================================
           15d. SIMULADOR DE SENSIBILIDAD WHAT-IF
           ============================================================================ */
        function WhatIfPanel({ metrics }) {
            const { cash } = useCash();
            const [openState, setOpen] = useState(false);
            /* Dentro de un grupo el panel va siempre abierto y sin su propio encabezado */
            const embedded = useContext(EmbedCtx);
            const open = openState || embedded;
            const [fuelDelta, setFuelDelta] = useState(0);
            const [extraDays, setExtraDays] = useState(1);

            const scenario = useMemo(
                () => simulateScenario(metrics, fuelDelta, extraDays), [metrics, fuelDelta, extraDays]);

            const deltaTone = scenario.deltaPocket >= 0 ? 'text-emerald-400' : 'text-rose-300';

            return (
                <section className={embedded ? 'pt-3' : 'bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden'}>
                    {!embedded && (
                    <button onClick={() => { setOpen(o => !o); haptic(10); }} aria-expanded={open}
                            className="focus-ring w-full flex items-center justify-between gap-3 p-4 text-left">
                        <span className="flex items-center gap-2 min-w-0">
                            <span className="text-amber-400 shrink-0"><IconBolt size={16} /></span>
                            <span className="min-w-0">
                                <span className="block text-slate-100 text-sm font-semibold tracking-tight">Simulador de sensibilidad</span>
                                <span className="block text-slate-500 text-[11px] truncate">
                                    Qué pasa si sube la gasolina o trabajas días extra
                                </span>
                            </span>
                        </span>
                        <span className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
                            <IconChevronD size={18} />
                        </span>
                    </button>
                    )}

                    {open && (
                        <div className="px-4 pb-4 fade-in">
                            {!scenario.hasBaseline ? (
                                <p className="text-[12px] text-slate-400">
                                    Registra al menos una jornada para poder simular escenarios.
                                </p>
                            ) : (
                                <>
                                    <div className="space-y-4">
                                        <div>
                                            <div className="flex justify-between items-baseline mb-1.5">
                                                <label htmlFor="sim-fuel" className="text-[11px] font-semibold text-slate-300">
                                                    Precio del combustible
                                                </label>
                                                <span className={`text-[12px] font-bold num ${
                                                    fuelDelta > 0 ? 'text-rose-400' : fuelDelta < 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                                                    {fuelDelta > 0 ? '+' : ''}{fuelDelta}%
                                                </span>
                                            </div>
                                            <input id="sim-fuel" type="range" min="-15" max="25" step="1" value={fuelDelta}
                                                   onChange={(e) => setFuelDelta(Number(e.target.value))}
                                                   className="w-full focus-ring" />
                                            <div className="flex justify-between text-[9px] text-slate-400 num mt-0.5">
                                                <span>−15%</span><span>Actual</span><span>+25%</span>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="flex justify-between items-baseline mb-1.5">
                                                <label htmlFor="sim-days" className="text-[11px] font-semibold text-slate-300">
                                                    Jornadas adicionales
                                                </label>
                                                <span className="text-[12px] font-bold num text-sky-300">
                                                    +{extraDays} {extraDays === 1 ? 'día' : 'días'}
                                                </span>
                                            </div>
                                            <input id="sim-days" type="range" min="1" max="5" step="1" value={extraDays}
                                                   onChange={(e) => setExtraDays(Number(e.target.value))}
                                                   className="w-full focus-ring" />
                                            <div className="flex justify-between text-[9px] text-slate-400 num mt-0.5">
                                                <span>+1</span><span>+3</span><span>+5</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 mt-4">
                                        <div className="rounded-xl bg-slate-800/50 border border-slate-800 px-3 py-2.5">
                                            <p className="text-[9px] uppercase tracking-wider text-slate-300 font-bold">Bolsillo simulado</p>
                                            <p className="text-lg font-bold num text-slate-100">{cash(scenario.scenarioPocket, 0)}</p>
                                            <p className={`text-[10px] font-bold num ${deltaTone}`}>
                                                {scenario.deltaPocket >= 0 ? '+' : ''}{cash(scenario.deltaPocket, 0)} vs. hoy
                                            </p>
                                        </div>
                                        <div className="rounded-xl bg-slate-800/50 border border-slate-800 px-3 py-2.5">
                                            <p className="text-[9px] uppercase tracking-wider text-slate-300 font-bold">Bolsillo por jornada extra</p>
                                            <p className={`text-lg font-bold num ${
                                                scenario.pocketPerExtraDay >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
                                                {cash(scenario.pocketPerExtraDay, 0)}
                                            </p>
                                            <p className="text-[10px] text-slate-400 num">
                                                Depósito {cash(scenario.avgEarned, 0)} · gas {cash(scenario.gasPerExtraDay, 0)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-2 rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2.5 space-y-1">
                                        <p className="flex justify-between text-[11px]">
                                            <span className="text-slate-400">Sobrecosto de combustible en esas jornadas</span>
                                            <span className={`font-bold num ${scenario.fuelImpact > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                                {scenario.fuelImpact >= 0 ? '+' : ''}{cash(scenario.fuelImpact)}
                                            </span>
                                        </p>
                                        <p className="flex justify-between text-[11px]">
                                            <span className="text-slate-400">Impacto si el alza dura todo el mes</span>
                                            <span className={`font-bold num ${scenario.futureFuelImpact > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                                {scenario.futureFuelImpact >= 0 ? '+' : ''}{cash(scenario.futureFuelImpact)}
                                            </span>
                                        </p>
                                        <p className="flex justify-between text-[11px]">
                                            <span className="text-slate-300">Retorno efectivo del escenario</span>
                                            <span className="font-bold num text-slate-100">{pctText(scenario.scenarioReturn, 1)}</span>
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </section>
            );
        }

        /* ============================================================================
           15e. HUD DE CABINA PARA LA JORNADA ACTIVA
           ============================================================================ */
        function ShiftHud({ open, onClose, day, costs, onQuickAdd, onField }) {
            const { cash, stealth } = useCash();
            const c = useMemo(() => (day ? computeDay(day, costs) : null), [day, costs]);
            const animatedEarned = useAnimatedNumber(c ? c.earned : 0, 520);

            useEffect(() => {
                if (!open) return;
                const onKey = (e) => { if (e.key === 'Escape') onClose(); };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [open, onClose]);

            if (!open) return null;

            const missing = c ? Math.max(c.goal - c.earned, 0) : 0;
            const progress = c ? clamp(c.percentage, 0, 100) : 0;
            const R = 86, CX = 110, CY = 110;
            const circumference = 2 * Math.PI * R;

            return (
                <div className="fixed inset-0 z-[70] bg-slate-950 overflow-y-auto"
                     role="dialog" aria-modal="true" aria-label="HUD de jornada"
                     style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                    <div className="min-h-full flex flex-col px-4 py-4 hud-rise">

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">Jornada activa</p>
                                <p className="text-slate-100 font-bold num">{day ? `${day.dateString} · ${day.dayName}` : '—'}</p>
                            </div>
                            <button onClick={onClose} aria-label="Salir del HUD"
                                    className="focus-ring press rounded-xl bg-slate-900 border border-slate-800 text-slate-300 p-3">
                                <IconClose size={22} />
                            </button>
                        </div>

                        {!day ? (
                            <p className="text-slate-400 mt-10 text-center">
                                Cambia al mes en curso para abrir el HUD de la jornada.
                            </p>
                        ) : (
                            <>
                                <div className="relative flex items-center justify-center mt-4">
                                    <svg viewBox="0 0 220 220" className="w-[min(72vw,260px)] h-auto" role="img"
                                         aria-label={`Avance de la meta del día: ${progress.toFixed(0)} por ciento`}>
                                        <defs>
                                            <linearGradient id="hudRing" x1="0" y1="1" x2="1" y2="0">
                                                <stop offset="0%" stopColor={COLORS.amber} />
                                                <stop offset="100%" stopColor={COLORS.emerald} />
                                            </linearGradient>
                                        </defs>
                                        <circle cx={CX} cy={CY} r={R} fill="none" stroke={COLORS.slate800} strokeWidth="14" />
                                        <circle cx={CX} cy={CY} r={R} fill="none" stroke="url(#hudRing)" strokeWidth="14"
                                                strokeLinecap="round" className="arc-anim"
                                                strokeDasharray={circumference.toFixed(2)}
                                                strokeDashoffset={(circumference * (1 - progress / 100)).toFixed(2)}
                                                transform={`rotate(-90 ${CX} ${CY})`} />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">Depositado hoy</p>
                                        <p className={`text-[44px] leading-none font-extrabold num text-emerald-400 ${stealth ? 'stealth-blur' : ''}`}>
                                            {stealth ? '$ ••••' : '$' + money(animatedEarned, 0)}
                                        </p>
                                        <p className="text-slate-400 text-sm font-bold num mt-1">{progress.toFixed(0)}% de la meta</p>
                                    </div>
                                </div>

                                <div className={`mt-4 rounded-2xl border px-4 py-4 text-center ${
                                    missing > 0 ? 'bg-slate-900 border-slate-800' : 'bg-emerald-950/30 border-emerald-800/60'}`}>
                                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-bold">
                                        {missing > 0 ? 'Faltan para liberar la meta' : 'Meta del día liberada'}
                                    </p>
                                    <p className={`text-[38px] leading-tight font-extrabold num ${
                                        missing > 0 ? 'text-slate-100' : 'text-emerald-400'} ${stealth ? 'stealth-blur' : ''}`}>
                                        {missing > 0 ? cash(missing, 0) : `+${cash(c.earned - c.goal, 0)}`}
                                    </p>
                                    {missing > 0 && (
                                        <p className="text-sky-300 text-base font-bold num mt-1">
                                            ≈ {Math.ceil(missing / (num(costs.avgTicket) || DEFAULT_COSTS.avgTicket))} viajes
                                        </p>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3 mt-4">
                                    {[50, 100, 150, 200].map(amount => (
                                        <button key={amount} onClick={() => onQuickAdd(day.id, amount)}
                                                className="focus-ring press rounded-2xl bg-emerald-600/15 border-2 border-emerald-600/50 text-emerald-300 py-6 text-[26px] font-extrabold num transition-colors hover:bg-emerald-600/25">
                                            +${amount}
                                        </button>
                                    ))}
                                </div>

                                <div className="grid grid-cols-3 gap-2 mt-4">
                                    <HudStat label="Meta" value={cash(c.goal, 0)} />
                                    <HudStat label="Gasolina" value={cash(c.gas, 0)} tone="text-rose-400" />
                                    <HudStat label="Bolsillo" value={cash(c.pocket, 0)}
                                             tone={c.pocket >= 0 ? 'text-emerald-400' : 'text-rose-300'} />
                                </div>

                                <div className="grid grid-cols-2 gap-2 mt-3 mb-2">
                                    <MoneyField id="hud-earned" label="Corregir depósito" tone="earned"
                                                value={day.earned} onChange={(v) => onField(day.id, 'earned', v)} />
                                    <MoneyField id="hud-gas" label="Gasolina cargada" tone="gas"
                                                value={day.gas} onChange={(v) => onField(day.id, 'gas', v)} />
                                </div>

                                <p className="text-center text-[11px] text-slate-600 mt-auto pt-3">
                                    Los montos se guardan al instante en este dispositivo.
                                </p>
                            </>
                        )}
                    </div>
                </div>
            );
        }

        const HudStat = ({ label, value, tone = 'text-slate-100' }) => (
            <div className="rounded-xl bg-slate-900 border border-slate-800 px-2 py-2.5 text-center">
                <p className="text-[9px] uppercase tracking-wider text-slate-300 font-bold">{label}</p>
                <p className={`text-base font-bold num ${tone}`}>{value}</p>
            </div>
        );

        /* ============================================================================
           15e-2. FICHA DE RENDIMIENTO EN CANVAS NATIVO (PNG 1080x1920 @2x)
           ============================================================================ */
        const CARD_W = 540, CARD_H = 960, CARD_DPR = 2;

        const renderPerformanceCard = (metrics, monthName, generatedAt) => {
            const canvas = document.createElement('canvas');
            canvas.width = CARD_W * CARD_DPR;
            canvas.height = CARD_H * CARD_DPR;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.scale(CARD_DPR, CARD_DPR);          // se dibuja en coordenadas lógicas

            const font = (size, weight = '700') =>
                `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
            const fmt = (value, decimals = 0) => '$' + money(value, decimals);

            /* Fondo con degradado sutil */
            const backdrop = ctx.createLinearGradient(0, 0, 0, CARD_H);
            backdrop.addColorStop(0, '#0b1220');
            backdrop.addColorStop(0.45, '#020617');
            backdrop.addColorStop(1, '#020617');
            ctx.fillStyle = backdrop;
            ctx.fillRect(0, 0, CARD_W, CARD_H);

            /* Halo esmeralda detrás de la cifra principal */
            const halo = ctx.createRadialGradient(CARD_W / 2, 300, 20, CARD_W / 2, 300, 260);
            halo.addColorStop(0, 'rgba(16, 185, 129, 0.20)');
            halo.addColorStop(1, 'rgba(16, 185, 129, 0)');
            ctx.fillStyle = halo;
            ctx.fillRect(0, 60, CARD_W, 480);

            const roundRect = (x, y, w, h, r) => {
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + w, y, x + w, y + h, r);
                ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r);
                ctx.arcTo(x, y, x + w, y, r);
                ctx.closePath();
            };

            /* Encabezado */
            ctx.textAlign = 'left';
            ctx.fillStyle = '#10b981';
            ctx.font = font(13, '800');
            ctx.fillText('TELEMETRÍA DIDI', 40, 66);
            ctx.fillStyle = '#f1f5f9';
            ctx.font = font(30, '800');
            ctx.fillText(monthName, 40, 104);
            ctx.fillStyle = '#64748b';
            ctx.font = font(13, '600');
            ctx.fillText(`Generada el ${generatedAt}`, 40, 128);

            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(40, 152);
            ctx.lineTo(CARD_W - 40, 152);
            ctx.stroke();

            /* Cifra monumental: ganancia de bolsillo */
            ctx.textAlign = 'center';
            ctx.fillStyle = '#94a3b8';
            ctx.font = font(14, '700');
            ctx.fillText('GANANCIA REAL DE BOLSILLO', CARD_W / 2, 210);
            ctx.fillStyle = metrics.pocketProfit >= 0 ? '#10b981' : '#f43f5e';
            ctx.font = font(74, '800');
            ctx.fillText(fmt(metrics.pocketProfit, 0), CARD_W / 2, 282);
            ctx.fillStyle = '#64748b';
            ctx.font = font(14, '600');
            ctx.fillText(`Retorno efectivo ${pctText(metrics.returnRate, 1)} de lo depositado`, CARD_W / 2, 312);

            /* Tarjetas de métricas */
            const tiles = [
                { label: 'DEPOSITADO', value: fmt(metrics.totalEarned, 0), color: '#34d399' },
                { label: 'GASOLINA', value: fmt(metrics.totalGas, 0), color: '#fb7185' },
                { label: 'RETENCIÓN GAS', value: pctText(metrics.fuelRetention, 1), color: '#fbbf24' },
                { label: 'GASTOS DE RUTA', value: fmt(metrics.totalRouteCash, 0), color: '#c4b5fd' },
                { label: 'HORAS', value: `${money(metrics.totalHours, 1)} h`, color: '#7dd3fc' },
                { label: 'KILÓMETROS', value: `${money(metrics.totalKm, 0)} km`, color: '#7dd3fc' }
            ];
            const tileW = (CARD_W - 80 - 24) / 3;
            const tileH = 78;
            tiles.forEach((tile, i) => {
                const col = i % 3;
                const row = Math.floor(i / 3);
                const x = 40 + col * (tileW + 12);
                const y = 350 + row * (tileH + 12);
                ctx.fillStyle = '#0f172a';
                roundRect(x, y, tileW, tileH, 14);
                ctx.fill();
                ctx.strokeStyle = '#1e293b';
                ctx.stroke();
                ctx.textAlign = 'left';
                ctx.fillStyle = '#94a3b8';
                ctx.font = font(10, '800');
                ctx.fillText(tile.label, x + 12, y + 26);
                ctx.fillStyle = tile.color;
                ctx.font = font(20, '800');
                ctx.fillText(tile.value, x + 12, y + 56);
            });

            /* Curva de avance dibujada sobre el canvas */
            const chartX = 40, chartY = 540, chartW = CARD_W - 80, chartH = 180;
            ctx.fillStyle = '#0f172a';
            roundRect(chartX, chartY, chartW, chartH, 16);
            ctx.fill();
            ctx.strokeStyle = '#1e293b';
            ctx.stroke();

            ctx.textAlign = 'left';
            ctx.fillStyle = '#94a3b8';
            ctx.font = font(11, '800');
            ctx.fillText('AVANCE ACUMULADO', chartX + 16, chartY + 26);

            const series = metrics.cumulativeEarned;
            const pocketSeries = metrics.cumulativePocket;
            const goalSeries = metrics.cumulativeGoal;
            const maxValue = Math.max(goalSeries[goalSeries.length - 1] || 0,
                                      series[series.length - 1] || 0, 1);
            const plotX = chartX + 16, plotY = chartY + 40;
            const plotW = chartW - 32, plotH = chartH - 66;
            const pointAt = (arr, i) => ({
                x: plotX + (i / Math.max(arr.length - 1, 1)) * plotW,
                y: plotY + plotH - (clamp(arr[i] / maxValue, 0, 1)) * plotH
            });
            const lastIndex = Math.max(metrics.lastWorkedIndex, 0);

            /* Meta acumulada punteada */
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 2;
            ctx.beginPath();
            goalSeries.forEach((v, i) => {
                const pt = pointAt(goalSeries, i);
                if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);

            /* Área de bolsillo */
            if (lastIndex > 0) {
                ctx.beginPath();
                for (let i = 0; i <= lastIndex; i += 1) {
                    const pt = pointAt(pocketSeries, i);
                    if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
                }
                const endPoint = pointAt(pocketSeries, lastIndex);
                ctx.lineTo(endPoint.x, plotY + plotH);
                ctx.lineTo(plotX, plotY + plotH);
                ctx.closePath();
                const fill = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
                fill.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
                fill.addColorStop(1, 'rgba(16, 185, 129, 0.05)');
                ctx.fillStyle = fill;
                ctx.fill();

                /* Curva de depósito */
                ctx.strokeStyle = '#10b981';
                ctx.lineWidth = 3;
                ctx.lineJoin = 'round';
                ctx.beginPath();
                for (let i = 0; i <= lastIndex; i += 1) {
                    const pt = pointAt(series, i);
                    if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
                }
                ctx.stroke();
            }

            ctx.textAlign = 'right';
            ctx.fillStyle = '#64748b';
            ctx.font = font(11, '600');
            ctx.fillText(`${pctText(metrics.goalProgress, 1)} de la meta`, chartX + chartW - 16, chartY + 26);

            /* Pie: efectividad y mejor jornada */
            const footY = 760;
            const footW = (CARD_W - 80 - 12) / 2;
            const footTiles = [
                {
                    label: 'EFECTIVIDAD DE JORNADAS',
                    value: `${metrics.achievedDays}/${metrics.workedDays}`,
                    detail: `${pctText(metrics.effectiveness, 0)} con meta cumplida`
                },
                {
                    label: 'MEJOR JORNADA',
                    value: metrics.bestDay ? fmt(metrics.bestDay.pocket, 0) : '—',
                    detail: metrics.bestDay ? `${metrics.bestDay.label} · de bolsillo` : 'Sin registros'
                }
            ];
            footTiles.forEach((tile, i) => {
                const x = 40 + i * (footW + 12);
                ctx.fillStyle = '#0f172a';
                roundRect(x, footY, footW, 96, 16);
                ctx.fill();
                ctx.strokeStyle = '#1e293b';
                ctx.stroke();
                ctx.textAlign = 'left';
                ctx.fillStyle = '#94a3b8';
                ctx.font = font(10, '800');
                ctx.fillText(tile.label, x + 14, footY + 26);
                ctx.fillStyle = '#f1f5f9';
                ctx.font = font(26, '800');
                ctx.fillText(tile.value, x + 14, footY + 60);
                ctx.fillStyle = '#64748b';
                ctx.font = font(11, '600');
                ctx.fillText(tile.detail, x + 14, footY + 82);
            });

            /* Firma */
            ctx.textAlign = 'center';
            ctx.fillStyle = '#334155';
            ctx.font = font(11, '600');
            ctx.fillText('Registro personal de jornadas · datos locales del dispositivo', CARD_W / 2, 900);

            return canvas;
        };

        /* ============================================================================
           15e-3. CÉDULA DE LIQUIDACIÓN Y LIBRO DIARIO
           ============================================================================ */
        /* Cuadro monoespaciado listo para archivar o pegar en una hoja de cálculo */
        const buildSettlementSheet = (metrics, monthName, generatedAt) => {
            const WIDTH = 46;
            const line = (char) => char.repeat(WIDTH);
            const amount = (value) => {
                const text = num(value).toLocaleString('es-MX',
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return text.padStart(14);
            };
            const row = (label, value) => label.padEnd(WIDTH - 14).slice(0, WIDTH - 14) + amount(value);
            const pctRow = (label, value) => label.padEnd(WIDTH - 14).slice(0, WIDTH - 14)
                + (pctText(value, 1)).padStart(14);
            const unitRow = (label, value, suffix) => label.padEnd(WIDTH - 14).slice(0, WIDTH - 14)
                + (money(value, 2) + suffix).padStart(14);

            const out = [];
            out.push(line('='));
            out.push('CEDULA DE LIQUIDACION Y CIERRE DE PERIODO');
            out.push(monthName.toUpperCase());
            out.push(`Emitida: ${generatedAt}`);
            out.push(line('='));
            out.push('');
            out.push(row('INGRESO BRUTO DEPOSITADO', metrics.totalEarned));
            out.push(line('-'));
            out.push('COSTOS VARIABLES DE RUTA');
            out.push(row('  Combustible', -metrics.totalGas));
            out.push(row('  Peajes y casetas', -metrics.totalTolls));
            out.push(row('  Total costos variables', -metrics.totalDirectCosts));
            out.push(line('-'));
            out.push(row('MARGEN DE CONTRIBUCION', metrics.contributionMargin));
            out.push(pctRow('  Ratio de contribucion', metrics.contributionRatio));
            out.push(line('-'));
            out.push('GASTOS OPERATIVOS (OPEX)');
            out.push(row('  Lavado y acondicionamiento', -metrics.totalWash));
            out.push(row('  Miscelaneos de ruta', -metrics.totalMisc));
            out.push(row('  Total OPEX', -metrics.totalOpex));
            out.push(line('='));
            out.push(row('UTILIDAD NETA DE CAJA', metrics.operatingCashFlow));
            out.push(pctRow('  Margen operativo neto', metrics.returnRate));
            out.push(line('='));
            out.push('');
            out.push('INDICADORES UNITARIOS');
            out.push(pctRow('  Absorcion de combustible', metrics.fuelAbsorption));
            if (metrics.totalKm > 0) {
                out.push(unitRow('  Rendimiento por km', metrics.operatingCashFlow / metrics.totalKm, ' /km'));
                out.push(unitRow('  Costo por km', metrics.cashPerKm || 0, ' /km'));
            }
            if (metrics.totalHours > 0) {
                out.push(unitRow('  Rendimiento por hora', metrics.pocketPerHour || 0, ' /hr'));
                out.push(unitRow('  Costo por hora servicio', metrics.costPerServiceHour || 0, ' /hr'));
            }
            out.push('');
            out.push('OPERACION DEL PERIODO');
            out.push(`  Jornadas liquidadas        ${String(metrics.workedDays).padStart(14)}`);
            out.push(`  Metas cumplidas            ${String(metrics.achievedDays).padStart(14)}`);
            if (metrics.totalKm > 0) out.push(`  Kilometros recorridos      ${money(metrics.totalKm, 0).padStart(14)}`);
            if (metrics.totalHours > 0) out.push(`  Horas al volante           ${money(metrics.totalHours, 1).padStart(14)}`);
            out.push(line('='));
            out.push('Registro personal de jornadas. Base: flujo de caja.');
            return out.join('\n');
        };

        /* Partida doble: cada jornada genera un asiento de ingreso y uno de costos */
        const LEDGER_ACCOUNTS = {
            bank: '1020 Bancos',
            cash: '1010 Caja / Efectivo',
            income: '4010 Ingresos operativos plataforma',
            fuel: '5010 Combustible',
            tolls: '5020 Peajes y casetas',
            wash: '5030 Lavado y acondicionamiento',
            misc: '5040 Miscelaneos de ruta'
        };

        const buildLedgerEntries = (days, computed) => {
            const entries = [];
            let balance = 0;
            days.forEach((day, index) => {
                const c = computed[index];
                if (!c.hasData) return;
                const seq = String(day.id).padStart(2, '0');

                if (c.earned > 0) {
                    /* El cobro entra por caja cuando se declaró efectivo; el resto, por banco */
                    const viaCash = c.declaredSplit ? c.cashCollected : 0;
                    const viaBank = c.declaredSplit ? Math.max(c.earned - viaCash, 0) : c.earned;
                    if (viaBank > 0) {
                        balance += viaBank;
                        entries.push({ date: day.dateString, id: `${seq}-I1`, account: LEDGER_ACCOUNTS.bank,
                                       concept: 'Deposito de plataforma', debit: viaBank, credit: 0, balance });
                        entries.push({ date: day.dateString, id: `${seq}-I1`, account: LEDGER_ACCOUNTS.income,
                                       concept: 'Ingreso operativo del turno', debit: 0, credit: viaBank, balance });
                    }
                    if (viaCash > 0) {
                        balance += viaCash;
                        entries.push({ date: day.dateString, id: `${seq}-I2`, account: LEDGER_ACCOUNTS.cash,
                                       concept: 'Cobro en efectivo a bordo', debit: viaCash, credit: 0, balance });
                        entries.push({ date: day.dateString, id: `${seq}-I2`, account: LEDGER_ACCOUNTS.income,
                                       concept: 'Ingreso operativo del turno', debit: 0, credit: viaCash, balance });
                    }
                }

                const costs = [
                    { key: 'fuel', value: c.gasPaid, concept: 'Carga de combustible' },
                    { key: 'tolls', value: c.tolls, concept: 'Peajes de ruta' },
                    { key: 'wash', value: c.wash, concept: 'Lavado del vehiculo' },
                    { key: 'misc', value: c.misc, concept: 'Miscelaneos de operacion' }
                ];
                let costSeq = 0;
                costs.forEach(cost => {
                    if (cost.value <= 0) return;
                    costSeq += 1;
                    balance -= cost.value;
                    const entryId = `${seq}-C${costSeq}`;
                    entries.push({ date: day.dateString, id: entryId, account: LEDGER_ACCOUNTS[cost.key],
                                   concept: cost.concept, debit: cost.value, credit: 0, balance });
                    entries.push({ date: day.dateString, id: entryId, account: LEDGER_ACCOUNTS.cash,
                                   concept: `Pago de ${cost.concept.toLowerCase()}`, debit: 0, credit: cost.value, balance });
                });
            });
            return entries;
        };

        function LedgerSheet({ open, onClose, entries, monthName, onExport }) {
            const { cash } = useCash();
            useEffect(() => {
                if (!open) return;
                const onKey = (e) => { if (e.key === 'Escape') onClose(); };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, [open, onClose]);
            if (!open) return null;

            const totalDebit = entries.reduce((acc, e) => acc + e.debit, 0);
            const totalCredit = entries.reduce((acc, e) => acc + e.credit, 0);
            const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

            return (
                <div className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center"
                     role="dialog" aria-modal="true" aria-label="Libro diario contable">
                    <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm" onClick={onClose}></div>
                    <div className="relative w-full sm:max-w-2xl bg-slate-900 border-t sm:border border-slate-700 rounded-t-3xl sm:rounded-2xl p-4 sheet-in max-h-[88vh] overflow-y-auto"
                         style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
                        <div className="flex items-start justify-between mb-3">
                            <div className="min-w-0">
                                <h2 className="text-slate-100 font-bold tracking-tight">Libro diario</h2>
                                <p className="text-[11px] text-slate-400 num truncate">
                                    {monthName} · {entries.length} movimientos ·
                                    {balanced ? ' partida cuadrada' : ' revisar cuadre'}
                                </p>
                            </div>
                            <button onClick={onClose} aria-label="Cerrar"
                                    style={{ minHeight: '54px', minWidth: '54px' }}
                                    className="focus-ring press text-slate-300 hover:text-slate-100 rounded-xl flex items-center justify-center shrink-0">
                                <IconClose size={22} />
                            </button>
                        </div>

                        {entries.length === 0 ? (
                            <p className="text-[12px] text-slate-300 py-6 text-center">
                                Todavía no hay movimientos que asentar en este periodo.
                            </p>
                        ) : (
                            <>
                                <div className="overflow-x-auto rounded-xl border border-slate-800">
                                    <table className="w-full text-[11px] num" style={{ minWidth: '520px' }}>
                                        <thead>
                                            <tr className="bg-slate-800/70 text-slate-200">
                                                <th className="text-left font-bold px-2 py-2">Fecha</th>
                                                <th className="text-left font-bold px-2 py-2">Asiento</th>
                                                <th className="text-left font-bold px-2 py-2">Cuenta</th>
                                                <th className="text-right font-bold px-2 py-2">Debe</th>
                                                <th className="text-right font-bold px-2 py-2">Haber</th>
                                                <th className="text-right font-bold px-2 py-2">Saldo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {entries.map((entry, i) => (
                                                <tr key={`${entry.id}-${i}`}
                                                    className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-900/40'}>
                                                    <td className="px-2 py-1.5 text-slate-300 whitespace-nowrap">{entry.date}</td>
                                                    <td className="px-2 py-1.5 text-slate-400 whitespace-nowrap">{entry.id}</td>
                                                    <td className="px-2 py-1.5 text-slate-200">
                                                        <span className="block">{entry.account}</span>
                                                        <span className="block text-[9px] text-slate-500">{entry.concept}</span>
                                                    </td>
                                                    <td className="px-2 py-1.5 text-right text-emerald-300 whitespace-nowrap">
                                                        {entry.debit > 0 ? cash(entry.debit) : ''}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-right text-rose-300 whitespace-nowrap">
                                                        {entry.credit > 0 ? cash(entry.credit) : ''}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-right text-slate-100 whitespace-nowrap">
                                                        {cash(entry.balance)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-slate-800/70 text-slate-100 font-bold">
                                                <td className="px-2 py-2" colSpan={3}>Sumas iguales</td>
                                                <td className="px-2 py-2 text-right text-emerald-300">{cash(totalDebit)}</td>
                                                <td className="px-2 py-2 text-right text-rose-300">{cash(totalCredit)}</td>
                                                <td className="px-2 py-2 text-right">{cash(entries[entries.length - 1].balance)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                <button onClick={onExport} style={{ minHeight: '56px' }}
                                        className="focus-ring press w-full mt-3 flex items-center justify-center gap-2 rounded-xl bg-violet-600/20 border border-violet-500/50 text-violet-200 font-bold text-[13px] transition-colors">
                                    <IconDownload size={18} /> Exportar libro diario a CSV
                                </button>
                            </>
                        )}
                    </div>
                </div>
            );
        }

        /* ============================================================================
           15e-4. BANNER DEL TURNO ACTIVO (cabecera de la pestaña Registro)
           ============================================================================ */
        const TodayBanner = memo(function TodayBanner({ day, costs, metrics, monthName, onOpenHud }) {
            const { cash } = useCash();
            const c = useMemo(() => (day ? computeDay(day, costs) : null), [day, costs]);

            if (!day) {
                return (
                    <div className="bg-slate-900 rounded-2xl border border-slate-800 px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-300 font-bold">Sin turno activo</p>
                        <p className="text-[12px] text-slate-400 mt-1 num">
                            Estás viendo {monthName}. Vuelve al mes en curso para capturar la jornada de hoy.
                        </p>
                    </div>
                );
            }

            const missingToGoal = Math.max(c.goal - c.earned, 0);

            return (
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                    <div className="flex items-center justify-between gap-3 mb-2.5">
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-400 font-bold">Turno de hoy</p>
                            <p className="text-slate-100 font-bold num text-[15px] truncate">
                                {day.dateString} · <span className="text-slate-300">{day.dayName}</span>
                            </p>
                        </div>
                        <button onClick={onOpenHud} aria-label="Abrir HUD de cabina"
                                style={{ minHeight: '54px', minWidth: '54px' }}
                                className="focus-ring press shrink-0 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600/15 border border-emerald-600/50 text-emerald-300 px-3 text-[12px] font-bold transition-colors">
                            <IconGauge size={20} /> HUD
                        </button>
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                        <BannerCell label="Meta" value={cash(c.goal, 0)} tone="text-slate-100" />
                        <BannerCell label="Depositado" value={cash(c.earned, 0)} tone="text-emerald-400" />
                        <BannerCell label="Gasolina" value={cash(c.gasPaid, 0)} tone="text-rose-300" />
                        <BannerCell label="Bolsillo" value={cash(c.operatingCashFlow, 0)}
                                    tone={c.operatingCashFlow >= 0 ? 'text-emerald-400' : 'text-rose-300'} />
                    </div>

                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-2.5">
                        <div className={`h-1.5 rounded-full transition-all duration-500 ${
                            c.percentage >= 100 ? 'bg-emerald-500' : c.percentage >= 50 ? 'bg-amber-500' : 'bg-sky-500'}`}
                             style={{ width: `${Math.min(c.percentage, 100)}%` }}></div>
                    </div>
                    <p className="text-[11px] text-slate-400 num mt-1.5">
                        {missingToGoal > 0
                            ? <>Faltan <span className="text-slate-100 font-bold">{cash(missingToGoal, 0)}</span> para la meta del día</>
                            : <span className="text-emerald-400 font-bold">Meta del día liberada</span>}
                        <span className="text-slate-500"> · mes al {pctText(metrics.goalProgress, 0)}</span>
                    </p>
                </div>
            );
        });

        const BannerCell = ({ label, value, tone }) => (
            <div className="rounded-lg bg-slate-800/50 border border-slate-800 px-1.5 py-1.5 text-center">
                <p className="text-[8.5px] uppercase tracking-wider text-slate-300 font-bold truncate">{label}</p>
                <p className={`text-[13px] font-bold num ${tone}`}>{value}</p>
            </div>
        );

        /* ============================================================================
           15e-5. BARRA DE PESTAÑAS INFERIOR (thumb zone)
           ============================================================================ */
        const TABS = [
            { id: 'registro', label: 'Registro', accent: 'emerald' },
            { id: 'cockpit', label: 'Cockpit', accent: 'cyan' },
            { id: 'inteligencia', label: 'Inteligencia', accent: 'violet' }
        ];

        const TabIcon = ({ id, size = 22 }) => {
            if (id === 'registro') {
                return <Icon size={size} path={<><rect x="4" y="3" width="16" height="18" rx="2" /><line x1="8" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="13" y2="16" /></>} />;
            }
            if (id === 'cockpit') {
                return <Icon size={size} path={<><path d="M12 15l4-4" /><path d="M3.5 17a9 9 0 1 1 17 0" /><circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none" /></>} />;
            }
            return <Icon size={size} path={<><path d="M12 3a4 4 0 0 0-4 4 3.5 3.5 0 0 0-1.5 6.4A3.5 3.5 0 0 0 9 20a3 3 0 0 0 3-1.6 3 3 0 0 0 3 1.6 3.5 3.5 0 0 0 2.5-6.6A3.5 3.5 0 0 0 16 7a4 4 0 0 0-4-4z" /><line x1="12" y1="7" x2="12" y2="18.4" /></>} />;
        };

        const BottomTabBar = memo(function BottomTabBar({ tab, onTab, barRef }) {
            const accents = {
                emerald: 'text-emerald-300 border-emerald-400',
                cyan: 'text-cyan-300 border-cyan-400',
                violet: 'text-violet-300 border-violet-400'
            };
            return (
                <nav ref={barRef} aria-label="Navegación principal"
                     className="fixed left-0 right-0 bottom-0 z-50 bg-slate-950/97 backdrop-blur border-t border-slate-800"
                     style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                    <div className="max-w-2xl mx-auto grid grid-cols-3">
                        {TABS.map(item => {
                            const active = tab === item.id;
                            return (
                                <button key={item.id} onClick={() => onTab(item.id)}
                                        aria-current={active ? 'page' : undefined}
                                        style={{ minHeight: '62px' }}
                                        className={`focus-ring relative flex flex-col items-center justify-center gap-1 transition-colors ${
                                            active ? accents[item.accent] : 'text-slate-400'}`}>
                                    <span className={`absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-full transition-all duration-200 ${
                                        active ? `w-10 ${item.accent === 'emerald' ? 'bg-emerald-400' : item.accent === 'cyan' ? 'bg-cyan-400' : 'bg-violet-400'}` : 'w-0 bg-transparent'}`}></span>
                                    <TabIcon id={item.id} size={active ? 23 : 21} />
                                    <span className={`text-[10px] font-bold tracking-wide ${active ? '' : 'font-semibold'}`}>
                                        {item.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </nav>
            );
        });

        /* ============================================================================
           15f. DOCK ERGONÓMICO DE UNA MANO (THUMB ZONE)
           Todo lo accionable en marcha vive aquí: en los ~280 px inferiores, con
           objetivos de 56 px o más y separación generosa (ley de Fitts).
           ============================================================================ */
        const DIAL_AMOUNTS = [50, 100, 200, 500];

        function ThumbDock({
            dockRef, day, filter, counts, onFilter, onInject, onRest, undoState, onUndo, onOpenHud,
            disabled, bottomOffset
        }) {
            const { cash } = useCash();
            const [dialOpen, setDialOpen] = useState(false);

            const goal = day ? num(day.goal) : 0;
            const earned = day ? num(day.earned) : 0;
            const missing = Math.max(goal - earned, 0);

            return (
                <div ref={dockRef}
                     className="fixed left-0 right-0 z-40 bg-slate-950/95 backdrop-blur border-t border-slate-800"
                     style={{ bottom: `calc(${bottomOffset || 62}px + env(safe-area-inset-bottom, 0px))` }}>

                    {/* Dial de inyección rápida */}
                    {dialOpen && (
                        <div className="px-3 pt-3 fade-in">
                            {disabled ? (
                                <p className="text-[12px] text-slate-300 text-center pb-2">
                                    Vuelve al mes en curso para registrar viajes con el dial.
                                </p>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <span className="text-[11px] font-bold text-slate-200 num truncate">
                                            {day.dateString} · {cash(earned, 0)}
                                        </span>
                                        <span className="text-[11px] font-bold text-sky-300 num shrink-0">
                                            {goal <= 0 ? 'día libre'
                                                : missing > 0 ? `faltan ${cash(missing, 0)}` : 'meta liberada'}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2.5">
                                        {DIAL_AMOUNTS.map(amount => (
                                            <button key={amount} onClick={() => onInject(day.id, amount)}
                                                    style={{ minHeight: '64px' }}
                                                    className="focus-ring press rounded-full bg-emerald-600/15 border-2 border-emerald-600/50 text-emerald-300 text-[17px] font-extrabold num transition-colors active:bg-emerald-600/30">
                                                +{amount}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                                        <button onClick={() => onRest(day.id)}
                                                style={{ minHeight: '56px' }}
                                                className="focus-ring press rounded-2xl bg-slate-800 border border-slate-700 text-slate-100 text-[13px] font-bold transition-colors flex items-center justify-center gap-2">
                                            <IconClock size={18} /> Día de descanso
                                        </button>
                                        <button onClick={onOpenHud}
                                                style={{ minHeight: '56px' }}
                                                className="focus-ring press rounded-2xl bg-emerald-600/15 border border-emerald-600/40 text-emerald-300 text-[13px] font-bold transition-colors flex items-center justify-center gap-2">
                                            <IconGauge size={18} /> Abrir HUD
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Deshacer: ventana de 5 segundos */}
                    {undoState && (
                        <div className="px-3 pt-2 fade-in">
                            <button onClick={onUndo} style={{ minHeight: '54px' }}
                                    className="focus-ring press w-full flex items-center justify-between gap-3 rounded-2xl bg-amber-500/15 border border-amber-500/50 px-4 transition-colors">
                                <span className="text-[12px] font-bold text-amber-200 truncate">{undoState.label}</span>
                                <span className="flex items-center gap-1.5 text-amber-300 text-[13px] font-extrabold shrink-0">
                                    <IconHistory size={18} /> Deshacer
                                </span>
                            </button>
                        </div>
                    )}

                    {/* Filtros + botón principal, dentro del alcance del pulgar */}
                    <div className="px-3 py-2.5 flex items-center gap-2.5">
                        <div className="grid grid-cols-4 gap-1.5 flex-1 min-w-0">
                            <DockChip active={filter === 'todos'} onClick={() => onFilter('todos')} label="Todos" count={counts.todos} accent="slate" />
                            <DockChip active={filter === 'cumplidos'} onClick={() => onFilter('cumplidos')} label="Cumpl." count={counts.cumplidos} accent="emerald" />
                            <DockChip active={filter === 'pendientes'} onClick={() => onFilter('pendientes')} label="Progr." count={counts.pendientes} accent="amber" />
                            <DockChip active={filter === 'sin'} onClick={() => onFilter('sin')} label="Descanso" count={counts.sin} accent="slate" />
                        </div>
                        <button onClick={() => { setDialOpen(o => !o); feedback.tap(); }}
                                aria-expanded={dialOpen} aria-label="Dial de registro rápido"
                                style={{ minWidth: '56px', minHeight: '56px' }}
                                className={`focus-ring press rounded-2xl border-2 flex items-center justify-center transition-colors shrink-0 ${
                                    dialOpen ? 'bg-emerald-600 border-emerald-500 text-white'
                                             : 'bg-emerald-600/15 border-emerald-600/50 text-emerald-300'}`}>
                            {dialOpen ? <IconClose size={24} /> : <IconPlus size={24} />}
                        </button>
                    </div>
                </div>
            );
        }

        const DockChip = ({ active, onClick, label, count, accent }) => {
            const activeClass = accent === 'emerald'
                ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/60'
                : accent === 'amber'
                ? 'bg-amber-500/20 text-amber-200 border-amber-500/60'
                : 'bg-slate-700 text-white border-slate-500';
            return (
                <button onClick={onClick} aria-pressed={active} title={`${label}: ${count} días`}
                        style={{ minHeight: '56px' }}
                        className={`focus-ring press min-w-0 flex flex-col items-center justify-center rounded-2xl border transition-colors ${
                            active ? activeClass : 'bg-slate-900 text-slate-300 border-slate-700'}`}>
                    <span className="num text-[15px] font-extrabold leading-none">{count}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider leading-none mt-1 truncate max-w-full">{label}</span>
                </button>
            );
        };

        /* ============================================================================
           16. APLICACIÓN
           ============================================================================ */
        function App() {
            const [meta, setMeta] = useState(() => {
                const loaded = readMeta();
                migrateLegacy(loaded.defaultGoals);
                return loaded;
            });

            /* El mes y su lista viajan juntos: nunca se escribe un mes sobre la clave de otro */
            const [month, setMonth] = useState(() => {
                const parsed = parseMonthId(meta.activeMonth);
                const now = new Date();
                const year = parsed ? parsed.year : now.getFullYear();
                const monthIndex = parsed ? parsed.monthIndex : now.getMonth();
                return { year, monthIndex, list: loadMonth(year, monthIndex, meta.defaultGoals) };
            });

            const [filter, setFilter] = useState('todos');
            const [toolsOpen, setToolsOpen] = useState(false);
            const [shiftOpen, setShiftOpen] = useState(false);
            const [hudOpen, setHudOpen] = useState(false);
            const [ledgerOpen, setLedgerOpen] = useState(false);
            const [tab, setTab] = useState('registro');
            /* Las pestañas pesadas se montan la primera vez que se visitan y ya no se
               desmontan: el cambio posterior es instantáneo y Monte Carlo no se recalcula. */
            const [mountedTabs, setMountedTabs] = useState({ registro: true, cockpit: false, inteligencia: false });
            const [pickerOpen, setPickerOpen] = useState(false);
            const [toast, setToast] = useState(null);
            const [lastSavedAt, setLastSavedAt] = useState(null);
            const [storedMonths, setStoredMonths] = useState(listStoredMonths);
            const [scrollTarget, setScrollTarget] = useState(null);
            const [headerHeight, setHeaderHeight] = useState(92);

            const [undoState, setUndoState] = useState(null);
            const [dockHeight, setDockHeight] = useState(96);
            const [tabBarHeight, setTabBarHeight] = useState(62);

            const dayRefs = useRef({});
            const toastTimer = useRef(null);
            const headerRef = useRef(null);
            const dockRef = useRef(null);
            const tabBarRef = useRef(null);
            const listRef = useRef(month.list);   // month ya existe; list se desestructura abajo
            const undoTimer = useRef(null);
            const undoSnapshot = useRef(null);
            const goalReached = useRef(false);

            const { year, monthIndex, list } = month;
            const costs = meta.costs;
            const stealth = meta.stealth;

            useEffect(() => { listRef.current = list; }, [list]);
            useEffect(() => { audio.enabled = meta.sound !== false; }, [meta.sound]);

            /* ---------- Persistencia ---------- */
            useEffect(() => {
                if (saveMonth(year, monthIndex, list)) {
                    setLastSavedAt(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
                }
            }, [year, monthIndex, list]);

            useEffect(() => { writeMeta({ ...meta, activeMonth: monthId(year, monthIndex) }); },
                      [meta, year, monthIndex]);

            useEffect(() => { setStoredMonths(listStoredMonths()); }, [toolsOpen, year, monthIndex]);

            /* ---------- Avisos ---------- */
            const notify = useCallback((message, tone = 'ok') => {
                setToast({ message, tone });
                if (toastTimer.current) clearTimeout(toastTimer.current);
                toastTimer.current = setTimeout(() => setToast(null), 3400);
            }, []);
            useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

            /* ---------- Cabecera y dock medidos para reservar su espacio ---------- */
            useEffect(() => {
                const measure = () => {
                    if (headerRef.current) setHeaderHeight(headerRef.current.offsetHeight);
                    const bar = tabBarRef.current ? tabBarRef.current.offsetHeight : 62;
                    const dock = dockRef.current ? dockRef.current.offsetHeight : 0;
                    setTabBarHeight(bar);
                    setDockHeight(bar + dock);
                };
                measure();
                const raf = requestAnimationFrame(measure);
                window.addEventListener('resize', measure);
                window.addEventListener('orientationchange', measure);
                return () => {
                    cancelAnimationFrame(raf);
                    window.removeEventListener('resize', measure);
                    window.removeEventListener('orientationchange', measure);
                };
            });

            /* ---------- Día de hoy dentro del mes visible ---------- */
            const today = useMemo(() => {
                const now = new Date();
                const isCurrentMonth = now.getFullYear() === year && now.getMonth() === monthIndex;
                return { isCurrentMonth, id: isCurrentMonth ? now.getDate() : null, index: isCurrentMonth ? now.getDate() - 1 : -1 };
            }, [year, monthIndex]);

            /* ---------- Métricas: la vista diferida evita jank al teclear ---------- */
            const totalDays = list.length;

            /* Días de calendario ya consumidos en el mes visible (para el pacing) */
            const elapsedDays = useMemo(() => {
                const now = new Date();
                const cursor = new Date(year, monthIndex, 1);
                const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                if (cursor < currentMonthStart) return totalDays;
                if (cursor > currentMonthStart) return 0;
                return now.getDate();
            }, [year, monthIndex, totalDays]);

            const basis = meta.accountingBasis === 'accrual' ? 'accrual' : 'cash';
            const metrics = useFinancialTelemetry(list, costs, elapsedDays, basis);
            const deferredList = useDeferredValue(list);
            /* Analítica operativa: IRD por jornada y agregados semanales/mensuales */
            const opsAnalytics = useMemo(() => OperationalAnalytics.calcMonth(list), [list]);
            const deferredMetrics = useFinancialTelemetry(deferredList, costs, elapsedDays, basis);
            const prediction = usePredictiveModels(deferredList, deferredMetrics, costs, elapsedDays,
                                                   mountedTabs.inteligencia);

            /* Muestra de jornadas para la campana de densidad */
            const grossSamples = useMemo(
                () => deferredMetrics.computed.filter(c => c.earned > 0).map(c => c.earned),
                [deferredMetrics]);

            /* Meta diaria media de los días programados */
            const targetDaily = useMemo(() => {
                const scheduled = deferredList.filter(d => num(d.goal) > 0);
                if (scheduled.length === 0) return 0;
                return scheduled.reduce((acc, d) => acc + num(d.goal), 0) / scheduled.length;
            }, [deferredList]);

            const outliers = useMemo(() => {
                const { spc, computed } = deferredMetrics;
                if (spc.n < 3) return [];
                const result = [];
                deferredList.forEach((day, i) => {
                    const c = computed[i];
                    if (!c || c.earned <= 0) return;
                    if (c.pocket > spc.ucl) result.push({ id: day.id, label: day.dateString, net: c.pocket, type: 'high' });
                    else if (c.pocket < spc.lcl) result.push({ id: day.id, label: day.dateString, net: c.pocket, type: 'low' });
                });
                return result;
            }, [deferredList, deferredMetrics]);

            const counts = useMemo(() => {
                const acc = { todos: list.length, cumplidos: 0, pendientes: 0, sin: 0 };
                list.forEach(day => {
                    const status = getDayStatus(day);
                    if (status === 'cumplido') acc.cumplidos += 1;
                    else if (status === 'pendiente') acc.pendientes += 1;
                    else acc.sin += 1;
                });
                return acc;
            }, [list]);

            const visibleDays = useMemo(() => {
                if (filter === 'todos') return list;
                const wanted = filter === 'cumplidos' ? 'cumplido' : filter === 'pendientes' ? 'pendiente' : 'sin';
                return list.filter(day => getDayStatus(day) === wanted);
            }, [list, filter]);

            /* ---------- Buffer de deshacer: 5 s para revertir un toque en falso ---------- */
            const pushUndo = useCallback((label) => {
                undoSnapshot.current = listRef.current;
                setUndoState({ label });
                if (undoTimer.current) clearTimeout(undoTimer.current);
                undoTimer.current = setTimeout(() => {
                    setUndoState(null);
                    undoSnapshot.current = null;
                }, 5000);
            }, []);

            const undoLast = useCallback(() => {
                if (!undoSnapshot.current) return;
                const snapshot = undoSnapshot.current;
                setMonth(prev => ({ ...prev, list: snapshot }));
                undoSnapshot.current = null;
                setUndoState(null);
                if (undoTimer.current) clearTimeout(undoTimer.current);
                feedback.warn();
                notify('Cambio revertido');
            }, [notify]);

            useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

            /* ---------- Edición ---------- */
            const handleField = useCallback((id, field, value) => {
                setMonth(prev => ({
                    ...prev,
                    list: prev.list.map(day => (day.id === id ? { ...day, [field]: value } : day))
                }));
                haptic(15);
            }, []);

            const handleQuickAdd = useCallback((id, amount) => {
                pushUndo(`Viaje de $${money(amount, 0)} registrado`);
                feedback.confirm();
                setMonth(prev => ({
                    ...prev,
                    list: prev.list.map(day => {
                        if (day.id !== id) return day;
                        const next = num(day.earned) + num(amount);
                        return { ...day, earned: String(Math.round(next * 100) / 100) };
                    })
                }));
            }, [pushUndo]);

            /* Swipe →: la jornada cierra justo en su meta */
            const handleAutoGoal = useCallback((id) => {
                pushUndo('Jornada completada a su meta');
                setMonth(prev => ({
                    ...prev,
                    list: prev.list.map(day => {
                        if (day.id !== id) return day;
                        const goal = num(day.goal);
                        return { ...day, earned: goal > 0 ? String(goal) : day.earned };
                    })
                }));
                feedback.milestone();
                notify('Jornada completada al 100% de su meta');
            }, [notify, pushUndo]);

            /* Swipe ←: jornada de descanso, sin meta ni ingreso */
            const handleRestDay = useCallback((id) => {
                pushUndo('Día marcado como descanso');
                setMonth(prev => ({
                    ...prev,
                    list: prev.list.map(day => (day.id === id
                        ? { ...day, goal: 0, earned: '', gas: '', hours: '', km: '', tolls: '', wash: '', misc: '' }
                        : day))
                }));
                feedback.confirm();
                notify('Día libre: no cuenta como jornada trabajada');
            }, [notify, pushUndo]);

            const handleCostChange = useCallback((field, value) => {
                setMeta(prev => ({ ...prev, costs: { ...prev.costs, [field]: value === '' ? 0 : num(value) } }));
            }, []);

            const setPacingMode = useCallback((mode) => {
                setMeta(prev => ({ ...prev, pacingMode: mode }));
            }, []);

            const goToTab = useCallback((next, options) => {
                setTab(prev => {
                    if (prev !== next) {
                        setMountedTabs(m => (m[next] ? m : { ...m, [next]: true }));
                        feedback.tap();
                    }
                    return next;
                });
                if (!options || options.scrollTop !== false) {
                    window.scrollTo({ top: 0, behavior: 'auto' });
                }
            }, []);

            const setAccountingBasis = useCallback((next) => {
                setMeta(prev => ({ ...prev, accountingBasis: next }));
            }, []);

            /* Conciliaciones bancarias por semana del mes visible */
            const monthKeyId = monthId(year, monthIndex);
            const settlements = useMemo(
                () => (meta.settlements && meta.settlements[monthKeyId]) || {},
                [meta.settlements, monthKeyId]);

            const updateSettlement = useCallback((weekIndex, patch) => {
                setMeta(prev => {
                    const all = prev.settlements && typeof prev.settlements === 'object' ? prev.settlements : {};
                    const monthRecord = all[monthKeyId] || {};
                    const weekRecord = { ...(monthRecord[weekIndex] || {}), ...patch };
                    return { ...prev, settlements: { ...all, [monthKeyId]: { ...monthRecord, [weekIndex]: weekRecord } } };
                });
                if (patch.reconciled !== undefined) feedback.confirm();
            }, [monthKeyId]);

            const ledgerEntries = useMemo(
                () => buildLedgerEntries(deferredList, deferredMetrics.computed),
                [deferredList, deferredMetrics]);

            const toggleStealth = useCallback(() => {
                setMeta(prev => ({ ...prev, stealth: !prev.stealth }));
                haptic(18);
            }, []);

            /* Hito: la meta del mes se cubre por primera vez */
            useEffect(() => {
                const reached = metrics.totalGoal > 0 && metrics.totalEarned >= metrics.totalGoal;
                if (reached && !goalReached.current) feedback.milestone();
                goalReached.current = reached;
            }, [metrics.totalEarned, metrics.totalGoal]);

            /* ---------- Navegación ---------- */
            const goToMonth = useCallback((nextYear, nextMonthIndex) => {
                setMonth({
                    year: nextYear,
                    monthIndex: nextMonthIndex,
                    list: loadMonth(nextYear, nextMonthIndex, meta.defaultGoals)
                });
                setPickerOpen(false);
                setFilter('todos');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }, [meta.defaultGoals]);

            const stepMonth = useCallback((delta) => {
                const next = shiftMonth(year, monthIndex, delta);
                goToMonth(next.year, next.monthIndex);
                haptic(12);
            }, [year, monthIndex, goToMonth]);

            /* Cualquier atajo a un día (heatmap, auditoría, SPC, semana) aterriza en Registro */
            const focusDay = useCallback((dayId) => {
                setFilter('todos');
                goToTab('registro', { scrollTop: false });
                setScrollTarget(dayId);
            }, [goToTab]);

            const goToToday = useCallback(() => {
                const now = new Date();
                goToTab('registro', { scrollTop: false });
                if (!today.isCurrentMonth) {
                    goToMonth(now.getFullYear(), now.getMonth());
                    setScrollTarget(now.getDate());
                } else {
                    focusDay(now.getDate());
                }
                haptic(15);
            }, [today.isCurrentMonth, goToMonth, focusDay, goToTab]);

            useEffect(() => {
                if (scrollTarget === null) return;
                const timer = setTimeout(() => {
                    const node = dayRefs.current[scrollTarget];
                    if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    else notify('Ese día no existe en el mes visible', 'warn');
                    setScrollTarget(null);
                }, 140);
                return () => clearTimeout(timer);
            }, [scrollTarget, list, notify]);

            /* ---------- Herramientas de datos ---------- */
            const stamp = () => {
                const d = new Date();
                const p = (n) => String(n).padStart(2, '0');
                return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
            };

            const downloadBlob = useCallback((content, filename, mime) => {
                try {
                    const blob = new Blob([content], { type: mime });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(url), 1500);
                    return true;
                } catch (err) { return false; }
            }, []);

            const exportMonth = useCallback(() => {
                const payload = {
                    schema: 'didi-telemetry', version: 2, scope: 'month',
                    exportedAt: new Date().toISOString(),
                    month: monthId(year, monthIndex),
                    costs: meta.costs,
                    days: list
                };
                const ok = downloadBlob(JSON.stringify(payload, null, 2),
                    `didi-mes-${monthId(year, monthIndex)}.json`, 'application/json');
                notify(ok ? `Respaldo de ${monthLabel(year, monthIndex)} descargado` : 'No se pudo generar la descarga', ok ? 'ok' : 'warn');
                setToolsOpen(false);
            }, [year, monthIndex, list, meta.costs, downloadBlob, notify]);

            const exportAll = useCallback(() => {
                const months = {};
                listStoredMonths().forEach(m => {
                    const stored = safeParse(safeGet(monthKeyOf(m.year, m.monthIndex)));
                    if (Array.isArray(stored)) months[m.id] = stored;
                });
                months[monthId(year, monthIndex)] = list;
                const payload = {
                    schema: 'didi-telemetry', version: 2, scope: 'history',
                    exportedAt: new Date().toISOString(),
                    meta: { costs: meta.costs, defaultGoals: meta.defaultGoals },
                    months
                };
                const ok = downloadBlob(JSON.stringify(payload, null, 2),
                    `didi-historico-${stamp()}.json`, 'application/json');
                notify(ok ? `Base histórica exportada (${Object.keys(months).length} meses)` : 'No se pudo generar la descarga',
                       ok ? 'ok' : 'warn');
                setToolsOpen(false);
            }, [year, monthIndex, list, meta, downloadBlob, notify]);

            /* Importador inteligente: acepta array legacy, mes único o histórico completo */
            const importFile = useCallback((file) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const parsed = safeParse(String(reader.result));
                    if (!parsed) { notify('Archivo dañado o ilegible', 'warn'); return; }

                    const applyMonth = (targetYear, targetMonthIndex, days) => {
                        const merged = mergeMonth(days, buildMonth(targetYear, targetMonthIndex, meta.defaultGoals));
                        saveMonth(targetYear, targetMonthIndex, merged);
                        if (targetYear === year && targetMonthIndex === monthIndex) {
                            setMonth({ year: targetYear, monthIndex: targetMonthIndex, list: merged });
                        }
                        return merged.length;
                    };

                    /* Formato histórico multimes */
                    if (parsed && typeof parsed === 'object' && parsed.months && typeof parsed.months === 'object') {
                        let imported = 0;
                        Object.keys(parsed.months).forEach(key => {
                            const target = parseMonthId(key);
                            const days = parsed.months[key];
                            if (!target || !Array.isArray(days)) return;
                            applyMonth(target.year, target.monthIndex, days);
                            imported += 1;
                        });
                        if (parsed.meta && parsed.meta.costs) {
                            setMeta(prev => normalizeMeta({ ...prev, costs: { ...prev.costs, ...parsed.meta.costs } }));
                        }
                        setStoredMonths(listStoredMonths());
                        setToolsOpen(false);
                        notify(imported > 0
                            ? `Histórico restaurado: ${imported} ${imported === 1 ? 'mes' : 'meses'} fusionados`
                            : 'El archivo no traía meses válidos', imported > 0 ? 'ok' : 'warn');
                        return;
                    }

                    /* Formato de mes único con metadatos */
                    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.days)) {
                        const target = parseMonthId(parsed.month) || { year, monthIndex };
                        const count = applyMonth(target.year, target.monthIndex, parsed.days);
                        if (parsed.costs) setMeta(prev => normalizeMeta({ ...prev, costs: { ...prev.costs, ...parsed.costs } }));
                        setStoredMonths(listStoredMonths());
                        setToolsOpen(false);
                        goToMonth(target.year, target.monthIndex);
                        notify(`${monthLabel(target.year, target.monthIndex)} restaurado: ${count} días`);
                        return;
                    }

                    /* Formato original: array plano. El mes se infiere de dateString */
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const sample = parsed.find(item => item && item.dateString);
                        const tagMatch = sample ? /\s([A-Za-zÁÉÍÓÚáéíóú]+)$/.exec(String(sample.dateString)) : null;
                        const tagIndex = tagMatch ? MONTH_TAG.findIndex(t => t.toLowerCase() === tagMatch[1].toLowerCase()) : -1;
                        const targetMonthIndex = tagIndex >= 0 ? tagIndex : monthIndex;
                        const targetYear = tagIndex === LEGACY_MONTH ? LEGACY_YEAR : year;
                        const count = applyMonth(targetYear, targetMonthIndex, parsed);
                        setStoredMonths(listStoredMonths());
                        setToolsOpen(false);
                        goToMonth(targetYear, targetMonthIndex);
                        notify(`${monthLabel(targetYear, targetMonthIndex)} restaurado: ${count} días`);
                        return;
                    }

                    notify('El archivo no contiene un respaldo reconocible', 'warn');
                };
                reader.onerror = () => notify('No se pudo leer el archivo', 'warn');
                reader.readAsText(file);
            }, [year, monthIndex, meta.defaultGoals, goToMonth, notify]);

            const exportCsv = useCallback(() => {
                const header = ['ID', 'Fecha', 'Dia', 'Meta', 'Depositado', 'Gasolina', 'Casetas', 'Lavado',
                                'Varios', 'Gasto Total', 'Ganancia Bolsillo', 'Cumplimiento %', 'Retencion Gas %',
                                'Retorno Efectivo %', 'Horas', 'Km', '$/hr Bolsillo',
                                'Km Inicio', 'Km Fin', 'Km DiDi', 'Conectado min', 'Activo min', 'Viajes',
                                'Eta Km %', 'Eta Tiempo %', 'Gasolina DiDi', 'Margen Neto', '$/km Neto',
                                '$/hr Neto', 'Ticket EPV', 'IRD'];
                const opt = (v, d = 2) => (v === null || v === undefined ? '' : v.toFixed(d));
                const escape = (cell) => {
                    const text = String(cell);
                    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
                };
                const rows = list.map((day, i) => {
                    const c = metrics.computed[i];
                    return [
                        day.id, day.dateString, day.dayName,
                        c.goal.toFixed(2), c.earned.toFixed(2), c.gas.toFixed(2),
                        c.tolls.toFixed(2), c.wash.toFixed(2), c.misc.toFixed(2),
                        c.cashOut.toFixed(2), c.pocket.toFixed(2), c.percentage.toFixed(1),
                        c.fuelRetention.toFixed(1), c.returnRate.toFixed(1),
                        c.hours ? c.hours.toFixed(2) : '', c.km ? c.km.toFixed(2) : '',
                        c.pocketPerHour !== null ? c.pocketPerHour.toFixed(2) : '',
                        ...(() => {
                            const o = opsAnalytics.daily[i];
                            const r = opsAnalytics.ird[i];
                            return [
                                day.kmStart || '', day.kmEnd || '', day.kmDidi || '',
                                opt(parseDuration(day.timeOnline), 0), opt(o.active, 0), day.trips || '',
                                opt(o.etaKm !== null ? o.etaKm * 100 : null, 1),
                                opt(o.etaT !== null ? o.etaT * 100 : null, 1),
                                o.worked ? o.gasDidi.toFixed(2) : '', o.worked ? o.margin.toFixed(2) : '',
                                opt(o.rKm), opt(o.rHr), opt(o.epv), r ? r.score : ''
                            ];
                        })()
                    ].map(escape).join(',');
                });
                const totals = [
                    'TOTAL', monthLabel(year, monthIndex), '',
                    metrics.totalGoal.toFixed(2), metrics.totalEarned.toFixed(2), metrics.totalGas.toFixed(2),
                    metrics.totalTolls.toFixed(2), metrics.totalWash.toFixed(2), metrics.totalMisc.toFixed(2),
                    metrics.totalCashOut.toFixed(2), metrics.pocketProfit.toFixed(2),
                    metrics.goalProgress.toFixed(1), metrics.fuelRetention.toFixed(1),
                    metrics.returnRate.toFixed(1),
                    metrics.totalHours.toFixed(2), metrics.totalKm.toFixed(2),
                    metrics.pocketPerHour !== null ? metrics.pocketPerHour.toFixed(2) : '',
                    '', '', '', '', '', opsAnalytics.aggregates.month.trips || '',
                    opt(opsAnalytics.aggregates.month.etaKm !== null ? opsAnalytics.aggregates.month.etaKm * 100 : null, 1),
                    opt(opsAnalytics.aggregates.month.etaT !== null ? opsAnalytics.aggregates.month.etaT * 100 : null, 1),
                    '', opsAnalytics.aggregates.month.margin.toFixed(2),
                    opt(opsAnalytics.aggregates.month.rKm), opt(opsAnalytics.aggregates.month.rHr),
                    opt(opsAnalytics.aggregates.month.epv),
                    opsAnalytics.aggregates.month.ird !== null ? opsAnalytics.aggregates.month.ird.toFixed(0) : ''
                ].map(escape).join(',');

                const csv = '﻿' + [header.join(','), ...rows, totals].join('\r\n');
                const ok = downloadBlob(csv, `didi-reporte-${monthId(year, monthIndex)}.csv`, 'text/csv;charset=utf-8;');
                notify(ok ? 'Reporte CSV descargado' : 'No se pudo generar la descarga', ok ? 'ok' : 'warn');
                setToolsOpen(false);
            }, [list, metrics, opsAnalytics, year, monthIndex, downloadBlob, notify]);

            const copySummary = useCallback(() => {
                const lines = [
                    `Telemetria DiDi - ${monthLabel(year, monthIndex)}`,
                    '',
                    `Depositado: $${money(metrics.totalEarned)}`,
                    `Gasolina: $${money(metrics.totalGas)} (${pctText(metrics.fuelRetention)} del deposito)`,
                    `Gastos de ruta: $${money(metrics.totalRouteCash)}`,
                    `Ganancia de bolsillo: $${money(metrics.pocketProfit)}`,
                    `Retorno efectivo: ${pctText(metrics.returnRate)}`,
                    '',
                    `Jornadas: ${metrics.workedDays} de ${totalDays} (${metrics.achievedDays} con meta cumplida)`,
                    `Avance de meta: ${pctText(metrics.goalProgress)} de $${money(metrics.totalGoal, 0)}`,
                    metrics.goalGap > 0
                        ? `Falta: $${money(metrics.goalGap, 0)} (cuota diaria $${money(metrics.requiredDaily, 0)})`
                        : `Meta superada por $${money(Math.abs(metrics.goalGap), 0)}`,
                    `Proyeccion por perfil de dia: $${money(metrics.projection.projected, 0)} depositado`,
                    `Proyeccion de bolsillo: $${money(metrics.projection.projectedPocket, 0)}`
                ];
                if (metrics.totalKm > 0) lines.push(`Kilometros: ${money(metrics.totalKm, 0)} km · gasto $${money(metrics.cashPerKm || 0)}/km`);
                if (metrics.totalHours > 0) lines.push(`Horas: ${money(metrics.totalHours, 1)} h · $${money(metrics.pocketPerHour || 0)}/h de bolsillo`);
                const text = lines.join('\n');

                const fallback = () => {
                    try {
                        const area = document.createElement('textarea');
                        area.value = text;
                        area.setAttribute('readonly', '');
                        area.style.position = 'fixed';
                        area.style.opacity = '0';
                        document.body.appendChild(area);
                        area.select();
                        const ok = document.execCommand('copy');
                        document.body.removeChild(area);
                        return ok;
                    } catch (err) { return false; }
                };

                const done = (ok) => {
                    notify(ok ? 'Resumen copiado al portapapeles' : 'No se pudo copiar el resumen', ok ? 'ok' : 'warn');
                    setToolsOpen(false);
                };

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(() => done(true)).catch(() => done(fallback()));
                } else {
                    done(fallback());
                }
            }, [metrics, year, monthIndex, totalDays, notify]);

            const copyToClipboard = useCallback((text, okMessage) => {
                const fallback = () => {
                    try {
                        const area = document.createElement('textarea');
                        area.value = text;
                        area.setAttribute('readonly', '');
                        area.style.position = 'fixed';
                        area.style.opacity = '0';
                        document.body.appendChild(area);
                        area.select();
                        const ok = document.execCommand('copy');
                        document.body.removeChild(area);
                        return ok;
                    } catch (err) { return false; }
                };
                const done = (ok) => {
                    notify(ok ? okMessage : 'No se pudo copiar', ok ? 'ok' : 'warn');
                    if (ok) feedback.confirm();
                    setToolsOpen(false);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(() => done(true)).catch(() => done(fallback()));
                } else {
                    done(fallback());
                }
            }, [notify]);

            const copySettlementSheet = useCallback(() => {
                const generatedAt = new Date().toLocaleDateString('es-MX',
                    { day: '2-digit', month: 'long', year: 'numeric' });
                copyToClipboard(buildSettlementSheet(metrics, monthLabel(year, monthIndex), generatedAt),
                                'Cédula de liquidación copiada');
            }, [metrics, year, monthIndex, copyToClipboard]);

            const exportLedgerCsv = useCallback(() => {
                const header = ['Fecha', 'Asiento_ID', 'Cuenta_Contable', 'Concepto', 'Debe', 'Haber', 'Saldo_Neto_Acumulado'];
                const escape = (cell) => {
                    const text = String(cell);
                    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
                };
                const rows = ledgerEntries.map(entry => [
                    entry.date, entry.id, entry.account, entry.concept,
                    entry.debit > 0 ? entry.debit.toFixed(2) : '',
                    entry.credit > 0 ? entry.credit.toFixed(2) : '',
                    entry.balance.toFixed(2)
                ].map(escape).join(','));
                const totalDebit = ledgerEntries.reduce((acc, e) => acc + e.debit, 0);
                const totalCredit = ledgerEntries.reduce((acc, e) => acc + e.credit, 0);
                const totals = ['TOTAL', '', 'SUMAS IGUALES', monthLabel(year, monthIndex),
                                totalDebit.toFixed(2), totalCredit.toFixed(2),
                                (ledgerEntries.length ? ledgerEntries[ledgerEntries.length - 1].balance : 0).toFixed(2)
                               ].map(escape).join(',');
                const csv = '\uFEFF' + [header.join(','), ...rows, totals].join('\r\n');
                const ok = downloadBlob(csv, `didi-libro-diario-${monthId(year, monthIndex)}.csv`, 'text/csv;charset=utf-8;');
                notify(ok ? 'Libro diario exportado' : 'No se pudo generar la descarga', ok ? 'ok' : 'warn');
            }, [ledgerEntries, year, monthIndex, downloadBlob, notify]);

            const exportCard = useCallback(() => {
                try {
                    const generatedAt = new Date().toLocaleDateString('es-MX',
                        { day: '2-digit', month: 'long', year: 'numeric' });
                    const canvas = renderPerformanceCard(metrics, monthLabel(year, monthIndex), generatedAt);
                    if (!canvas) { notify('Este navegador no permite generar la ficha', 'warn'); return; }
                    canvas.toBlob((blob) => {
                        if (!blob) { notify('No se pudo generar la imagen', 'warn'); return; }
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `didi-ficha-${monthId(year, monthIndex)}.png`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        setTimeout(() => URL.revokeObjectURL(url), 1500);
                        feedback.confirm();
                        notify('Ficha de rendimiento descargada');
                    }, 'image/png');
                } catch (err) {
                    notify('No se pudo generar la ficha', 'warn');
                }
                setToolsOpen(false);
            }, [metrics, year, monthIndex, notify]);

            const clearMonth = useCallback(() => {
                setMonth(prev => ({ ...prev, list: buildMonth(prev.year, prev.monthIndex, meta.defaultGoals)
                    .map(day => ({ ...day, earned: '' })) }));
                setToolsOpen(false);
                notify(`${monthLabel(year, monthIndex)} limpiado`);
            }, [meta.defaultGoals, year, monthIndex, notify]);

            /* ---------- Contexto de privacidad ---------- */
            const cashValue = useMemo(() => ({
                stealth,
                cash: (v, d = 2) => (stealth ? '$ ••••' : '$' + money(v, d)),
                cashShort: (v) => (stealth ? '$•••' : '$' + moneyShort(v))
            }), [stealth]);
            const { cash } = cashValue;

            const todayDay = today.id ? list.find(d => d.id === today.id) : null;

            /* ---------- Render ---------- */
            return (
                <CashCtx.Provider value={cashValue}>
                <div className="min-h-screen bg-slate-950 font-sans antialiased">

                    {/* ---------- Barra superior ---------- */}
                    <header ref={headerRef} className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800 relative"
                            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
                        <div className="max-w-2xl mx-auto px-3 pt-2 pb-2 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-emerald-400 shrink-0"><IconGauge size={18} /></span>
                                    <h1 className="text-slate-100 font-bold tracking-tight text-[15px] leading-none truncate">
                                        Telemetría DiDi <span className="text-emerald-400">Pro</span>
                                    </h1>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button onClick={toggleStealth} aria-pressed={stealth}
                                            aria-label={stealth ? 'Mostrar montos' : 'Ocultar montos'}
                                            className={`focus-ring rounded-lg p-2 border transition-colors ${
                                                stealth ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                                                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-white'}`}>
                                        {stealth ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                                    </button>
                                    <button onClick={() => { setShiftOpen(true); haptic(12); }} aria-label="Calculador de turno"
                                            className="focus-ring press rounded-lg p-2 bg-slate-900 text-sky-300 border border-slate-800 hover:text-white transition-colors">
                                        <IconBolt size={16} />
                                    </button>
                                    <button onClick={() => { setHudOpen(true); haptic(18); }} aria-label="Abrir HUD de cabina"
                                            className="focus-ring press rounded-lg p-2 bg-emerald-600/15 text-emerald-300 border border-emerald-600/40 hover:bg-emerald-600/25 transition-colors">
                                        <IconGauge size={16} />
                                    </button>
                                    <button onClick={() => { setToolsOpen(true); haptic(12); }} aria-label="Control y respaldo"
                                            className="focus-ring rounded-lg p-2 bg-slate-900 text-slate-300 border border-slate-800 hover:text-white transition-colors">
                                        <IconSliders size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                                <button onClick={() => stepMonth(-1)} aria-label="Mes anterior"
                                        className="focus-ring rounded-lg p-2 bg-slate-900 text-slate-300 border border-slate-800 hover:text-white transition-colors shrink-0">
                                    <IconChevronL size={16} />
                                </button>
                                <button onClick={() => { setPickerOpen(o => !o); haptic(10); }}
                                        aria-expanded={pickerOpen}
                                        className="focus-ring flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 border border-slate-800 px-2 py-2 hover:border-slate-700 transition-colors">
                                    <IconCalendar size={14} className="text-slate-500 shrink-0" />
                                    <span className="text-slate-100 text-[13px] font-bold truncate num">{monthLabel(year, monthIndex)}</span>
                                    <span className={`text-slate-500 transition-transform duration-200 shrink-0 ${pickerOpen ? 'rotate-180' : ''}`}>
                                        <IconChevronD size={14} />
                                    </span>
                                </button>
                                <button onClick={() => stepMonth(1)} aria-label="Mes siguiente"
                                        className="focus-ring rounded-lg p-2 bg-slate-900 text-slate-300 border border-slate-800 hover:text-white transition-colors shrink-0">
                                    <IconChevronR size={16} />
                                </button>
                                <button onClick={goToToday} aria-label="Ir al día de hoy"
                                        className="focus-ring flex items-center gap-1.5 rounded-lg bg-sky-500/10 border border-sky-500/40 text-sky-300 px-2.5 py-2 text-[11px] font-bold transition-colors hover:bg-sky-500/20 shrink-0">
                                    <IconCrosshair size={14} />
                                    <span className="num">Hoy</span>
                                </button>
                            </div>
                        </div>

                        {pickerOpen && (
                            <>
                                <div className="fixed inset-0 z-30" onClick={() => setPickerOpen(false)}></div>
                                <div className="max-w-2xl mx-auto relative">
                                    <MonthPicker year={year} monthIndex={monthIndex} storedMonths={storedMonths}
                                                 onSelect={goToMonth} onClose={() => setPickerOpen(false)} />
                                </div>
                            </>
                        )}
                    </header>

                    <main className="max-w-2xl mx-auto px-3 pt-3"
                          style={{ paddingBottom: `${dockHeight + 24}px` }}>

                        {/* ================= PESTAÑA: REGISTRO ================= */}
                        <div style={{ display: tab === 'registro' ? 'block' : 'none' }} className="space-y-3">
                            <TodayBanner day={todayDay} costs={costs} metrics={metrics}
                                         monthName={monthLabel(year, monthIndex)}
                                         onOpenHud={() => { setHudOpen(true); feedback.tap(); }} />
<div className="flex items-center justify-between gap-2 pt-1">
                            <h2 className="text-slate-100 text-sm font-semibold tracking-tight">Jornadas</h2>
                            <span className="text-[11px] text-slate-400 num">
                                {visibleDays.length} de {counts.todos} días
                                {filter !== 'todos' ? ' · filtrado' : ''}
                            </span>
                        </div>

                        {/* ---------- Jornadas ---------- */}
                        <section className="space-y-2.5">
                            {visibleDays.length === 0 ? (
                                <div className="bg-slate-900 border border-dashed border-slate-700 rounded-xl p-8 text-center">
                                    <p className="text-slate-300 text-sm font-semibold">Sin días en este filtro</p>
                                    <p className="text-slate-500 text-[12px] mt-1">Cambia el filtro para ver el resto del mes.</p>
                                </div>
                            ) : visibleDays.map(day => (
                                <DayCard key={`${year}-${monthIndex}-${day.id}`}
                                         day={day}
                                         costs={costs}
                                         isToday={day.id === today.id}
                                         ucl={deferredMetrics.spc.ucl}
                                         lcl={deferredMetrics.spc.lcl}
                                         spcSamples={deferredMetrics.spc.n}
                                         avgGasPerKm={deferredMetrics.avgGasPerKm}
                                         irdScore={opsAnalytics.irdById[day.id] ? opsAnalytics.irdById[day.id].score : null}
                                         irdPartial={opsAnalytics.irdById[day.id] ? opsAnalytics.irdById[day.id].partial : false}
                                         isStar={opsAnalytics.aggregates.star !== null && opsAnalytics.aggregates.star.id === day.id}
                                         onField={handleField}
                                         onAutoGoal={handleAutoGoal}
                                         onRestDay={handleRestDay}
                                         ref={(node) => { dayRefs.current[day.id] = node; }} />
                            ))}
                        </section>

                        <p className="text-center text-[10px] text-slate-600 pt-2 num">
                            {monthLabel(year, monthIndex)} · guardado en didi_data_{year}_{String(monthIndex + 1).padStart(2, '0')}
                        </p>
                        </div>

                        {/* ================= PESTAÑA: COCKPIT ================= */}
                        {mountedTabs.cockpit && (
                        <div style={{ display: tab === 'cockpit' ? 'block' : 'none' }} className="space-y-3">
                            {/* ---------- Utilidad neta real ---------- */}
                        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-300 font-bold mb-1">
                                        Ganancia real de bolsillo
                                    </p>
                                    <p className={`text-3xl font-bold num tracking-tight ${
                                        metrics.pocketProfit >= 0 ? 'text-emerald-400' : 'text-rose-300'}`}>
                                        <AnimatedCash value={metrics.pocketProfit} />
                                    </p>
                                    <p className="text-[11px] text-slate-500 num mt-1">
                                        Depositado <AnimatedCash value={metrics.totalEarned} decimals={0} /> − salidas{' '}
                                        <AnimatedCash value={metrics.totalCashOut} decimals={0} /> en efectivo
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full border ${
                                        metrics.returnRate >= 60 ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                        : metrics.returnRate >= 40 ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                        : metrics.totalEarned > 0 ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                                        : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                                        <IconGauge size={13} />
                                        <span className="num">{pctText(metrics.returnRate, 1)}</span>
                                    </span>
                                    <p className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-1">retorno efectivo</p>
                                </div>
                            </div>

                            <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 mt-3 ${
                                metrics.equilibrium.key === 'deficit' ? 'bg-rose-950/25 border-rose-900/50'
                                : metrics.equilibrium.key === 'even' ? 'bg-amber-950/20 border-amber-900/50'
                                : metrics.equilibrium.key === 'profit' ? 'bg-emerald-950/20 border-emerald-900/40'
                                : 'bg-slate-800/40 border-slate-800'}`}>
                                <span className="min-w-0">
                                    <span className={`block text-[11px] font-bold truncate ${
                                        metrics.equilibrium.key === 'deficit' ? 'text-rose-300'
                                        : metrics.equilibrium.key === 'even' ? 'text-amber-300'
                                        : metrics.equilibrium.key === 'profit' ? 'text-emerald-300' : 'text-slate-400'}`}>
                                        {metrics.equilibrium.label}
                                    </span>
                                    <span className="block text-[10px] text-slate-500 num truncate">
                                        Equilibrio del mes {cash(metrics.totalCashOut, 0)} en efectivo
                                        {metrics.deficitDays > 0 ? ` · ${metrics.deficitDays} ${metrics.deficitDays === 1 ? 'jornada' : 'jornadas'} bajo costo` : ''}
                                    </span>
                                </span>
                                <span className={`text-sm font-bold num shrink-0 ${
                                    metrics.equilibrium.key === 'deficit' ? 'text-rose-400'
                                    : metrics.equilibrium.key === 'profit' ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    {metrics.equilibrium.key === 'deficit' ? `−${cash(metrics.equilibrium.gap, 0)}`
                                        : metrics.equilibrium.key === 'profit' ? `+${cash(metrics.equilibrium.gap, 0)}`
                                        : cash(0, 0)}
                                </span>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mt-3">
                                <CostChip label="Gasolina" value={cash(metrics.totalGas, 0)} color="text-rose-300"
                                          pct={metrics.fuelRetention} />
                                <CostChip label="Ruta" value={cash(metrics.totalRouteCash, 0)} color="text-amber-300"
                                          pct={metrics.routeRatio} />
                                <CostChip label="Cartera" value={cash(metrics.pocketProfit, 0)} color="text-emerald-400"
                                          pct={metrics.returnRate} />
                            </div>

                            <div className="space-y-3 mt-4 pt-4 border-t border-slate-800">
                                <MeterRow label="Progreso sobre meta mensual" value={metrics.goalProgress}
                                          display={`${pctText(metrics.goalProgress, 1)} · ${cash(metrics.totalEarned, 0)} / ${cash(metrics.totalGoal, 0)}`}
                                          color="bg-emerald-500" />
                                <MeterRow label="Efectividad de jornadas" value={metrics.effectiveness}
                                          display={`${metrics.achievedDays} de ${metrics.workedDays} · ${pctText(metrics.effectiveness, 0)}`}
                                          color="bg-violet-500" />
                            </div>

                            {/* Economía unitaria: lo que no se repite en el resto del tablero */}
                            <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-800">
                                <UnitStat label="Bolsillo proyectado" masked={stealth} tone="info"
                                          value={cash(metrics.projection.projectedPocket, 0)}
                                          sub={`Depósito ${cash(metrics.projection.projected, 0)}`} />
                                <UnitStat label="Bolsillo por hora" masked={stealth}
                                          value={metrics.pocketPerHour !== null ? cash(metrics.pocketPerHour, 0) : '—'}
                                          sub={metrics.totalHours > 0 ? `${money(metrics.totalHours, 0)} h al volante` : 'Captura horas'} />
                                <UnitStat label="Gasto por km" masked={stealth}
                                          value={metrics.cashPerKm !== null ? cash(metrics.cashPerKm) : '—'}
                                          sub={metrics.totalKm > 0 ? `${money(metrics.totalKm, 0)} km` : 'Captura km'} />
                            </div>
                        </section>

                        {/* ---------- Meta y ritmo: cuota, pacing, curva y variaciones ---------- */}
                        <Bundle id="meta"
                                icon={<IconTarget size={16} />}
                                title={metrics.goalGap > 0 ? 'Meta y ritmo' : 'Meta mensual superada'}
                                subtitle={metrics.goalGap > 0
                                    ? `${meta.pacingMode === 'record' ? 'Cuota récord' : 'Cuota con alivio'} ${stealth ? '•••' : cash(meta.pacingMode === 'record'
                                        ? metrics.rebalance.originalDaily : metrics.rebalance.reliefDaily, 0)}/día · faltan ${stealth ? '•••' : cash(metrics.goalGap, 0)} en ${metrics.remainingDays} ${metrics.remainingDays === 1 ? 'día' : 'días'}`
                                    : `+${stealth ? '•••' : cash(Math.abs(metrics.goalGap), 0)} sobre la meta`}
                                action={<StatPill label="Día" value={`${elapsedDays}/${totalDays}`} tone="sky" />}
                                tabs={[
                                    { id: 'ritmo', label: 'Ritmo', render: () => (
                                        <>
                                            <div className="px-4 pt-3">
                                                <RadialGauge value={clamp(metrics.pacing.efficiency, 0, 100)}
                                                             centerLabel={`${Math.round(metrics.pacing.efficiency)}%`}
                                                             caption="Pacing"
                                                             tone={metrics.pacing.efficiency >= 80 ? 'emerald'
                                                                 : metrics.pacing.efficiency >= 55 ? 'amber' : 'rose'}
                                                             footnote={`Meta ${pctText(metrics.goalProgress, 0)} · calendario ${pctText(metrics.pacing.elapsedRatio, 0)}`} />
                                                <p className={`text-center text-[12px] font-bold mt-2 ${
                                                    metrics.pacing.efficiency >= 100 ? 'text-emerald-400'
                                                    : metrics.pacing.efficiency >= 80 ? 'text-emerald-400/80'
                                                    : metrics.pacing.efficiency >= 55 ? 'text-amber-400' : 'text-rose-400'}`}>
                                                    {metrics.pacing.verdict}
                                                </p>
                                            </div>
                                            <CumulativeChart days={deferredList} metrics={deferredMetrics}
                                                             todayIndex={today.index} prediction={prediction} />
                                        </>
                                    ) },
                                    { id: 'cuota', label: 'Cuota', render: () => (
                                        <PacingStrategyPanel metrics={metrics}
                                                             mode={meta.pacingMode === 'record' ? 'record' : 'relief'}
                                                             onMode={setPacingMode} />
                                    ) },
                                    { id: 'variaciones', label: 'Variaciones', render: () => <VariancePanel metrics={metrics} /> }
                                ]} />

                        {/* ---------- Contabilidad: resultados, cortes y auditoría ---------- */}
                        <Bundle id="contabilidad"
                                icon={<IconClipboard size={16} />}
                                title="Contabilidad"
                                subtitle={`Margen ${pctText(metrics.contributionRatio, 1)} · ${metrics.weeks.length} cortes · ${
                                    deferredMetrics.auditFlags.length === 0 ? 'sin observaciones'
                                    : `${deferredMetrics.auditFlags.length} ${deferredMetrics.auditFlags.length === 1 ? 'observación' : 'observaciones'}`}`}
                                tabs={[
                                    { id: 'resultados', label: 'Resultados', render: () => (
                                        <IncomeStatementPanel metrics={metrics} basis={basis} onBasis={setAccountingBasis} />
                                    ) },
                                    { id: 'cortes', label: 'Cortes', render: () => (
                                        <SettlementPanel metrics={metrics} settlements={settlements}
                                                         onSettlement={updateSettlement} onPickDay={focusDay} />
                                    ) },
                                    { id: 'auditoria', label: 'Auditoría', count: deferredMetrics.auditFlags.length, countTone: 'warn', render: () => (
                                        <AuditorPanel flags={deferredMetrics.auditFlags} onPickDay={focusDay} />
                                    ) }
                                ]} />
                        </div>
                        )}

                        {/* ================= PESTAÑA: INTELIGENCIA ================= */}
                        {mountedTabs.inteligencia && (
                        <div style={{ display: tab === 'inteligencia' ? 'block' : 'none' }} className="space-y-3">
                        {/* ---------- Pronóstico: Monte Carlo y simulador de escenarios ---------- */}
                        <Bundle id="pronostico"
                                icon={<IconTrend size={16} />}
                                title="Pronóstico y escenarios"
                                subtitle={prediction.monteCarlo.runs > 0
                                    ? `${prediction.monteCarlo.probability.toFixed(0)}% de probabilidad de cerrar la meta`
                                    : 'Registra jornadas para simular el cierre'}
                                tabs={[
                                    { id: 'montecarlo', label: 'Pronóstico', render: () => (
                                        <PredictivePanel prediction={prediction} metrics={deferredMetrics}
                                                         samples={grossSamples} targetDaily={targetDaily} />
                                    ) },
                                    { id: 'simulador', label: 'Simulador', render: () => <WhatIfPanel metrics={deferredMetrics} /> }
                                ]} />

                        {/* ---------- Rendimiento: IRD, perfil semanal, calendario y variabilidad ---------- */}
                        <Bundle id="rendimiento"
                                icon={<IconStats size={16} />}
                                title="Rendimiento operativo"
                                subtitle={opsAnalytics.aggregates.star
                                    ? `Día estrella ${opsAnalytics.aggregates.star.label} · Score ${opsAnalytics.aggregates.star.ird.score}/100`
                                    : 'Captura el tablero DiDi en tus jornadas'}
                                tabs={[
                                    { id: 'resumen', label: 'Resumen', render: () => (
                                        <OperationalIntelPanel aggregates={opsAnalytics.aggregates} onPickDay={focusDay} view="summary" />
                                    ) },
                                    { id: 'semana', label: 'Semana', render: () => (
                                        <>
                                            <WeekdayPerformance weekdayStats={deferredMetrics.weekdayStats}
                                                                bestWeekday={deferredMetrics.bestWeekday} />
                                            <div className="-mt-4">
                                                <OperationalIntelPanel aggregates={opsAnalytics.aggregates} onPickDay={focusDay} view="weekday" />
                                            </div>
                                        </>
                                    ) },
                                    { id: 'calendario', label: 'Mapa', render: () => (
                                        <ProductivityHeatmap days={deferredList} computed={deferredMetrics.computed}
                                                             year={year} monthIndex={monthIndex}
                                                             todayId={today.id} onPickDay={focusDay} />
                                    ) },
                                    { id: 'variabilidad', label: 'Dispersión', count: outliers.length, render: () => (
                                        <SpcPanel spc={deferredMetrics.spc} outliers={outliers} onPickDay={focusDay} />
                                    ) }
                                ]} />
                        </div>
                        )}

                        <p className="text-center text-[10px] text-slate-500 pt-4 num">
                            {monthLabel(year, monthIndex)} · guardado en didi_data_{year}_{String(monthIndex + 1).padStart(2, '0')}
                        </p>
                    </main>

                    <ToolsSheet
                        open={toolsOpen}
                        onClose={() => setToolsOpen(false)}
                        costs={costs}
                        onCostChange={handleCostChange}
                        monthName={monthLabel(year, monthIndex)}
                        dayCount={totalDays}
                        storedMonths={storedMonths}
                        lastSavedAt={lastSavedAt}
                        onExportMonth={exportMonth}
                        onExportAll={exportAll}
                        onImportFile={importFile}
                        onExportCsv={exportCsv}
                        onCopySummary={copySummary}
                        onExportCard={exportCard}
                        onCopySettlement={copySettlementSheet}
                        onOpenLedger={() => { setToolsOpen(false); setLedgerOpen(true); }}
                        onClearMonth={clearMonth}
                        soundOn={meta.sound !== false}
                        onToggleSound={() => {
                            const next = meta.sound === false;
                            setMeta(prev => ({ ...prev, sound: next }));
                            audio.enabled = next;
                            if (next) feedback.confirm();
                        }} />

                    <BottomTabBar tab={tab} onTab={goToTab} barRef={tabBarRef} />

                    {tab === 'registro' && (
                    <ThumbDock
                        dockRef={dockRef}
                        bottomOffset={tabBarHeight}
                        day={todayDay}
                        disabled={!todayDay}
                        filter={filter}
                        counts={counts}
                        onFilter={(value) => { setFilter(value); feedback.tap(); }}
                        onInject={handleQuickAdd}
                        onRest={handleRestDay}
                        undoState={undoState}
                        onUndo={undoLast}
                        onOpenHud={() => { setHudOpen(true); feedback.tap(); }} />
                    )}

                    <LedgerSheet
                        open={ledgerOpen}
                        onClose={() => setLedgerOpen(false)}
                        entries={ledgerEntries}
                        monthName={monthLabel(year, monthIndex)}
                        onExport={exportLedgerCsv} />

                    <ShiftHud
                        open={hudOpen}
                        onClose={() => setHudOpen(false)}
                        day={todayDay}
                        costs={costs}
                        onQuickAdd={handleQuickAdd}
                        onField={handleField} />

                    <ShiftSheet
                        open={shiftOpen}
                        onClose={() => setShiftOpen(false)}
                        day={todayDay || (today.isCurrentMonth ? null : list.find(d => num(d.earned) <= 0) || list[0])}
                        costs={costs}
                        metrics={metrics}
                        onQuickAdd={handleQuickAdd}
                        onField={handleField} />

                    {toast && (
                        <div className="fixed left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none"
                             style={{ bottom: `calc(${dockHeight + 14}px + env(safe-area-inset-bottom, 0px))` }}
                             role="status" aria-live="polite">
                            <div className={`sheet-in flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12px] font-semibold shadow-lg ${
                                toast.tone === 'warn'
                                    ? 'bg-amber-950 border-amber-800/70 text-amber-200'
                                    : 'bg-slate-800 border-slate-600/70 text-slate-100'}`}>
                                {toast.tone === 'warn' ? <IconAlert size={15} /> : <IconCheck size={15} />}
                                <span>{toast.message}</span>
                            </div>
                        </div>
                    )}
                </div>
                </CashCtx.Provider>
            );
        }

        const CostChip = ({ label, value, color, pct }) => (
            <div className="bg-slate-800/40 border border-slate-800 rounded-lg px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wider text-slate-300 font-bold truncate">{label}</p>
                <p className={`text-[13px] font-bold num ${color}`}>{value}</p>
                <p className="text-[9px] text-slate-400 num">{pctText(pct, 1)} del depósito</p>
            </div>
        );

        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<App />);
