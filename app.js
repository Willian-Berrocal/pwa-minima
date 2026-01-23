/* ===================== PWA Cochera - app.js (Fase 1: Tarifas reales + Fase 2: Cálculo total/deuda) ===================== */
/* Lógica de la aplicación: DB (Dexie), UI, eventos y toasts.
   Comentarios explicativos en cada función. */

document.addEventListener('DOMContentLoaded', () => {

    /* ---------- DB setup (Dexie) ---------- */
    // Creamos la base de datos 'CocheraDB' con la tabla 'cobros'
    const db = new Dexie("CocheraDB");
    db.version(1).stores({
        cobros: "++id, matricula, tarifa, fechaIngreso"
    });

    // Pedimos persistencia al navegador (reduce la probabilidad de borrado automático)
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(p => console.log("persistencia:", p));
    }

    /* ---------- Service Worker registration ---------- */
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(()=>console.log('Service Worker registrado'))
            .catch(()=>console.log('Fallo registro de Service Worker'));
    }

    /* ---------- Referencias al DOM ---------- */
    const form = document.getElementById('formIngreso');
    const matriculaInput = document.getElementById('matricula');
    const tarifaSelect = document.getElementById('tarifa');
    const adelantoInput = document.getElementById('adelanto');
    const tablaBody = document.querySelector('#tabla tbody');
    const exportBtn = document.getElementById('exportBtn');
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modal-text');
    const modalNo = document.getElementById('modal-no');
    const modalSi = document.getElementById('modal-si');
    const toastContainer = document.getElementById('toast-container');

    /* Caché en memoria para acelerar render */
    let rowsCache = [];
    let pendienteEliminarId = null;

    /* =========== NUEVO: tabla de tarifas predefinidas =========== */
    const TARIFAS = {
        auto_viejo: { label: 'Auto viejo', dia: 5, noche: 7 },
        auto_nuevo: { label: 'Auto nuevo', dia: 6, noche: 8 },
        mototaxi: { label: 'Mototaxi', dia: 2, noche: 4 },
        moto_lineal: { label: 'Moto lineal', dia: 2, noche: 3 },
        triciclo: { label: 'Triciclo', dia: 1, noche: 4 },
        afilador: { label: 'Afilador', dia: 1, noche: 2 },
        camion: { label: 'Camión', dia: 7, noche: 12 },
        bicicleta: { label: 'Bicicleta', dia: 1, noche: 2 }
    };

    /* ===================== TOASTS ===================== */

    function showToast(message, type = 'info', duration = 2500) {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<div>${message}</div><button class="close" aria-label="cerrar">&times;</button>`;
        toastContainer.appendChild(t);

        t.querySelector('.close').addEventListener('click', () => {
            t.remove();
        });

        setTimeout(() => {
            t.remove();
        }, duration);
    }

    /* ===================== HELPERS de UI/DB ===================== */

    function normalizeMatricula(s) {
        return s ? s.trim().toUpperCase() : '';
    }

    function formatCurrency(valor) {
        const n = Number(valor) || 0;
        return n.toFixed(2);
    }

    function render(list) {
        tablaBody.innerHTML = '';
        if (!list.length) {
            tablaBody.innerHTML = '<tr><td colspan="4" class="small">No hay registros</td></tr>';
            return;
        }
        for (const r of list) {
            const tarifaLabel = r.tarifaLabel || (TARIFAS[r.tarifa] && TARIFAS[r.tarifa].label) || r.tarifa;
            const diaVal = (typeof r.tarifaDia !== 'undefined') ? formatCurrency(r.tarifaDia) : '';
            const nocheVal = (typeof r.tarifaNoche !== 'undefined') ? formatCurrency(r.tarifaNoche) : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td>${r.matricula}</td>
        <td>${new Date(r.fechaIngreso).toLocaleString()}</td>
        <td>
          <div>${tarifaLabel}</div>
          <div class="small">D: S/ ${diaVal} | N: S/ ${nocheVal}</div>
        </td>
        <td><button class="big-btn" style="padding:6px 8px" onclick="confirmRetirar(${r.id}, '${r.matricula.replace("'", "\\'")}')">RETIRAR</button></td>
      `;
            tablaBody.appendChild(tr);
        }
    }

    /* ===================== CARGA Y FILTRADO ===================== */

    async function cargarYRenderizar() {
        const all = await db.cobros.orderBy('fechaIngreso').reverse().toArray();
        rowsCache = all;
        aplicarFiltro();
    }

    function aplicarFiltro() {
        const q = normalizeMatricula(matriculaInput.value);
        if (!q) {
            render(rowsCache);
            return;
        }
        const filtered = rowsCache.filter(r => r.matricula.includes(q));
        render(filtered);
    }

    /* ===================== INGRESO (SUBMIT) ===================== */

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const raw = matriculaInput.value;
        const matricula = normalizeMatricula(raw);
        if (!matricula) { showToast('Ingrese matrícula', 'warn'); matriculaInput.focus(); return; }
        const tarifaKey = tarifaSelect.value;

        // LEER ADELANTO (opcional). Si está vacío o inválido, queda 0.
        const adelantoVal = adelantoInput.value;
        const adelanto = adelantoVal === '' ? 0 : (Number(adelantoVal) || 0);

        // Determinar tarifas día/noche según selección
        let tarifaDia = 0, tarifaNoche = 0, tarifaLabel = '';

        const t = TARIFAS[tarifaKey];
        tarifaDia = t ? t.dia : 0;
        tarifaNoche = t ? t.noche : 0;
        tarifaLabel = t ? t.label : tarifaKey;

        try {
            // Guardar ingreso con campos de tarifa dia/noche y etiqueta
            await db.cobros.add({
                matricula,
                tarifa: tarifaKey,
                tarifaLabel,
                tarifaDia,
                tarifaNoche,
                fechaIngreso: new Date().toISOString(),
                adelanto // propiedad extra en el registro (opcional)
            });
            showToast(`Ingreso registrado: ${matricula}`, 'success');

            // Limpiar campos para agilizar siguiente operación
            matriculaInput.value = '';
            adelantoInput.value = '';
            tarifaSelect.value = 'auto_viejo';
            matriculaInput.focus();

            await cargarYRenderizar();
        } catch (err) {
            console.error(err);
            showToast('Error al guardar', 'error');
        }
    });

    /* ===================== BOTONES RÁPIDOS DE TARIFA ===================== */

    function setTarifa(t) {
        tarifaSelect.value = t;
        matriculaInput.focus();
        const label = TARIFAS[t] ? TARIFAS[t].label : t;
        showToast(`${label} seleccionada`, 'info', 1200);
    }

    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tarifa = btn.dataset.tarifa;
            setTarifa(tarifa);
        });
    });

    /* ===================== FUNCION DE CÁLCULO (NUEVA) ===================== */

    /**
     * calcularCobro(record, fechaSalida)
     * Devuelve un número: total a cobrar según reglas establecidas por Lian.
     */
    function calcularCobro(record, fechaSalida) {
        // Asegurar tarifas disponibles
        const tarifaDia = (typeof record.tarifaDia !== 'undefined') ? Number(record.tarifaDia) : (TARIFAS[record.tarifa] ? TARIFAS[record.tarifa].dia : 0);
        const tarifaNoche = (typeof record.tarifaNoche !== 'undefined') ? Number(record.tarifaNoche) : (TARIFAS[record.tarifa] ? TARIFAS[record.tarifa].noche : 0);

        const entrada = new Date(record.fechaIngreso);
        const salida = new Date(fechaSalida); // puede ser Date o string

        // Si por alguna razón la salida es anterior a la entrada, devolver 0
        if (salida <= entrada) return 0;

        // misma fecha (mismo día calendario)
        const entradaDateStr = entrada.toDateString();
        const salidaDateStr = salida.toDateString();

        if (entradaDateStr === salidaDateStr) {
            const diffMs = salida - entrada;
            const diffHoras = diffMs / (1000*60*60);

            if (diffHoras < 1) return 0;
            if (diffHoras < 5) return Math.max(0, tarifaDia - 1);
            return tarifaDia;
        }

        // fechas distintas -> calculo por partes
        let total = 0;

        // --- Día de entrada ---
        const entradaMinutes = entrada.getHours()*60 + entrada.getMinutes();
        const MIN_12_30 = 12*60 + 30; // 750
        const MIN_15_30 = 15*60 + 30; // 930

        if (entradaMinutes >= MIN_15_30) {
            // no paga por ese día
            total += 0;
        } else if (entradaMinutes > MIN_12_30 && entradaMinutes < MIN_15_30) {
            // paga mitad de tarifa día
            total += tarifaDia / 2;
        } else {
            // antes de 12:30 -> paga día completo
            total += tarifaDia;
        }

        // --- Contar medianoches y días completos entre fechas ---
        // midnightsPassed = number of times we pass from 00:00 of a day to the next (i.e., difference in date midnight)
        const startMidnight = new Date(entrada);
        startMidnight.setHours(0,0,0,0);
        const endMidnight = new Date(salida);
        endMidnight.setHours(0,0,0,0);

        let midnightsPassed = Math.round((endMidnight - startMidnight) / (24*60*60*1000));
        if (midnightsPassed < 0) midnightsPassed = 0;

        // Por cada medianoche que pasa se adiciona tarifa noche completa
        total += midnightsPassed * tarifaNoche;

        // Por cada dia completo que el vehiculo pasa en la cochera, se adiciona tarifa dia completa
        // Los "días completos" son (medianoche count - 1). Ej: si pasa 4 medianoches -> 3 días completos intermedios.
        const diasCompletos = Math.max(0, midnightsPassed - 1);
        total += diasCompletos * tarifaDia;

        // --- Día de salida ---
        const salidaMinutes = salida.getHours()*60 + salida.getMinutes();
        const MIN_11_30 = 11*60 + 30; // 690

        if (salidaMinutes < MIN_11_30) {
            total += 0;
        } else if (salidaMinutes >= MIN_11_30 && salidaMinutes < MIN_15_30) {
            total += Math.max(0, tarifaDia - 1);
        } else {
            total += tarifaDia;
        }

        // Nota: las reglas anteriores ya contemplan la combinación tal como en el ejemplo (lunes 4pm -> viernes 9am)
        // Devolver número con decimales (no formateado)
        return Number((total).toFixed(2));
    }

    /* ===================== MODAL DE CONFIRMACIÓN PARA RETIRAR (MODIFICADA) ===================== */

    window.confirmRetirar = async function(id, matricula) {
        pendienteEliminarId = id;

        // Obtener el registro completo para leer 'adelanto' y tarifas
        const record = await db.cobros.get(id);
        if (!record) {
            showToast('Registro no encontrado', 'error');
            return;
        }

        // Tomamos la fecha/hora de salida EN ESTE MOMENTO (tal como especificaste)
        const fechaSalida = new Date();

        // Calcular total según reglas
        const totalCalc = calcularCobro(record, fechaSalida);
        const adel = record && record.adelanto ? Number(record.adelanto) : 0;
        const debe = Math.max(0, Number((totalCalc - adel).toFixed(2)));

        // Formatear para mostrar en modal
        const adelStr = `S/ ${formatCurrency(adel)}`;
        const totalStr = `S/ ${formatCurrency(totalCalc)}`;
        const debeStr = `S/ ${formatCurrency(debe)}`;

        // Construir contenido del modal con adelanto, total y debe (Debe en <strong>)
        modalText.innerHTML = `
      <div>Retirar ${matricula}?</div>
      <div style="margin-top:8px">Adelanto: ${adelStr}</div>
      <div>Total: ${totalStr}</div>
      <div style="margin-top:6px"><strong>Debe: ${debeStr}</strong></div>
    `;

        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
    };

    modalNo.addEventListener('click', () => {
        pendienteEliminarId = null;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    });

    modalSi.addEventListener('click', async () => {
        if (pendienteEliminarId != null) {
            try {
                await db.cobros.delete(pendienteEliminarId);
                pendienteEliminarId = null;
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
                matriculaInput.value = '';
                adelantoInput.value = '';
                matriculaInput.focus();
                showToast('Registro eliminado', 'info');
                await cargarYRenderizar();
            } catch (err) {
                console.error(err);
                showToast('Error al eliminar', 'error');
            }
        }
    });

    /* ===================== INPUTS: mayúsculas y filtrado en vivo ===================== */

    matriculaInput.addEventListener('input', () => {
        const pos = matriculaInput.selectionStart;
        matriculaInput.value = matriculaInput.value.toUpperCase();
        matriculaInput.setSelectionRange(pos, pos);
        aplicarFiltro();
    });

    /* ===================== EXPORT CSV (sin cambios en esta fase) ===================== */

    exportBtn.addEventListener('click', async () => {
        try {
            const arr = await db.cobros.orderBy('fechaIngreso').reverse().toArray();
            const cols = ['matricula','fechaIngreso','tarifa','tarifaLabel','tarifaDia','tarifaNoche','adelanto'];
            const csv = [cols.join(',')].concat(arr.map(r =>
                `"${r.matricula}","${r.fechaIngreso}","${r.tarifa}","${(r.tarifaLabel||'')}","${(typeof r.tarifaDia!=='undefined'?r.tarifaDia:'')}","${(typeof r.tarifaNoche!=='undefined'?r.tarifaNoche:'')}","${(r.adelanto||0)}"`
            )).join('\n');
            const blob = new Blob([csv], {type:'text/csv'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'cobros.csv'; a.click();
            URL.revokeObjectURL(url);
            showToast('Exportado CSV', 'success');
        } catch (err) {
            console.error(err);
            showToast('Error exportando', 'error');
        }
    });

    /* ===================== INICIALIZACIÓN ===================== */
    cargarYRenderizar();

}); // DOMContentLoaded end
