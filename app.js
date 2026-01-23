/* ===================== PWA Cochera - app.js (Fase 1: Tarifas reales + Fase 2: Cálculo + Fase 3: Export desde 'retiros') ===================== */

document.addEventListener('DOMContentLoaded', () => {

    /* ---------- DB setup (Dexie) ---------- */
    const db = new Dexie("CocheraDB");

    // Versión inicial con 'cobros' y nueva versión que añade 'retiros'.
    // Si la DB ya existía con v1, Dexie migrará a v2 al actualizar.
    db.version(1).stores({
        cobros: "++id, matricula, tarifa, fechaIngreso"
    });
    db.version(2).stores({
        cobros: "++id, matricula, tarifa, fechaIngreso",
        // tabla 'retiros' para almacenar los retiros que luego se exportan
        retiros: "++id, matricula, tarifa, fechaIngreso, fechaSalida, totalPago"
    });

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

    let rowsCache = [];
    let pendienteEliminarId = null;

    // NUEVO: objeto temporal que contiene los datos calculados para el retiro
    let pendingRetiro = null;

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

        const adelantoVal = adelantoInput.value;
        const adelanto = adelantoVal === '' ? 0 : (Number(adelantoVal) || 0);

        let tarifaDia = 0, tarifaNoche = 0, tarifaLabel = '';
        const t = TARIFAS[tarifaKey];
        tarifaDia = t ? t.dia : 0;
        tarifaNoche = t ? t.noche : 0;
        tarifaLabel = t ? t.label : tarifaKey;

        try {
            await db.cobros.add({
                matricula,
                tarifa: tarifaKey,
                tarifaLabel,
                tarifaDia,
                tarifaNoche,
                fechaIngreso: new Date().toISOString(),
                adelanto
            });
            showToast(`Ingreso registrado: ${matricula}`, 'success');

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

    /* ===================== FUNCION DE CÁLCULO (YA IMPLEMENTADA) ===================== */

    function calcularCobro(record, fechaSalida) {
        const tarifaDia = (typeof record.tarifaDia !== 'undefined') ? Number(record.tarifaDia) : (TARIFAS[record.tarifa] ? TARIFAS[record.tarifa].dia : 0);
        const tarifaNoche = (typeof record.tarifaNoche !== 'undefined') ? Number(record.tarifaNoche) : (TARIFAS[record.tarifa] ? TARIFAS[record.tarifa].noche : 0);

        const entrada = new Date(record.fechaIngreso);
        const salida = new Date(fechaSalida);

        if (salida <= entrada) return 0;

        const entradaDateStr = entrada.toDateString();
        const salidaDateStr = salida.toDateString();

        if (entradaDateStr === salidaDateStr) {
            const diffMs = salida - entrada;
            const diffHoras = diffMs / (1000*60*60);

            if (diffHoras < 1) return 0;
            if (diffHoras < 5) return Math.max(0, tarifaDia - 1);
            return tarifaDia;
        }

        let total = 0;

        const entradaMinutes = entrada.getHours()*60 + entrada.getMinutes();
        const MIN_12_30 = 12*60 + 30; // 750
        const MIN_15_30 = 15*60 + 30; // 930

        if (entradaMinutes >= MIN_15_30) {
            total += 0;
        } else if (entradaMinutes > MIN_12_30 && entradaMinutes < MIN_15_30) {
            total += tarifaDia / 2;
        } else {
            total += tarifaDia;
        }

        const startMidnight = new Date(entrada);
        startMidnight.setHours(0,0,0,0);
        const endMidnight = new Date(salida);
        endMidnight.setHours(0,0,0,0);

        let midnightsPassed = Math.round((endMidnight - startMidnight) / (24*60*60*1000));
        if (midnightsPassed < 0) midnightsPassed = 0;

        total += midnightsPassed * tarifaNoche;

        const diasCompletos = Math.max(0, midnightsPassed - 1);
        total += diasCompletos * tarifaDia;

        const salidaMinutes = salida.getHours()*60 + salida.getMinutes();
        const MIN_11_30 = 11*60 + 30; // 690

        if (salidaMinutes < MIN_11_30) {
            total += 0;
        } else if (salidaMinutes >= MIN_11_30 && salidaMinutes < MIN_15_30) {
            total += Math.max(0, tarifaDia - 1);
        } else {
            total += tarifaDia;
        }

        return Number((total).toFixed(2));
    }

    /* ===================== MODAL DE CONFIRMACIÓN PARA RETIRAR (MODIFICADA) ===================== */

    window.confirmRetirar = async function(id, matricula) {
        pendienteEliminarId = id;

        // Obtener el registro completo
        const record = await db.cobros.get(id);
        if (!record) {
            showToast('Registro no encontrado', 'error');
            return;
        }

        // Fecha de salida en el momento de presionar RETIRAR
        const fechaSalida = new Date();

        // Calcular total y deuda
        const totalCalc = calcularCobro(record, fechaSalida);
        const adel = record && record.adelanto ? Number(record.adelanto) : 0;
        const debe = Math.max(0, Number((totalCalc - adel).toFixed(2)));

        // Guardamos en memoria para usar luego al confirmar (modalSi)
        pendingRetiro = {
            id,
            matricula,
            record,        // copia del registro original para poder guardarlo en 'retiros'
            fechaSalida,   // Date
            totalCalc,
            adelanto: adel,
            debe
        };

        // Mostrar en modal
        const adelStr = `S/ ${formatCurrency(adel)}`;
        const totalStr = `S/ ${formatCurrency(totalCalc)}`;
        const debeStr = `S/ ${formatCurrency(debe)}`;

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
        pendingRetiro = null;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    });

    modalSi.addEventListener('click', async () => {
        if (!pendingRetiro) {
            showToast('No hay retiro pendiente', 'warn');
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            return;
        }

        try {
            const rec = pendingRetiro.record;
            // Preparar objeto para insertar en 'retiros'
            const nuevoRetiro = {
                matricula: rec.matricula,
                tarifa: rec.tarifa,
                tarifaLabel: rec.tarifaLabel || (TARIFAS[rec.tarifa] && TARIFAS[rec.tarifa].label) || rec.tarifa,
                tarifaDia: (typeof rec.tarifaDia !== 'undefined') ? rec.tarifaDia : (TARIFAS[rec.tarifa] ? TARIFAS[rec.tarifa].dia : 0),
                tarifaNoche: (typeof rec.tarifaNoche !== 'undefined') ? rec.tarifaNoche : (TARIFAS[rec.tarifa] ? TARIFAS[rec.tarifa].noche : 0),
                fechaIngreso: rec.fechaIngreso,
                fechaSalida: pendingRetiro.fechaSalida.toISOString(),
                adelanto: pendingRetiro.adelanto,
                totalPago: pendingRetiro.totalCalc,
                debe: pendingRetiro.debe
            };

            // Guardar en tabla 'retiros'
            await db.retiros.add(nuevoRetiro);

            // Borrar el registro original de 'cobros'
            await db.cobros.delete(pendingRetiro.id);

            // Limpiar variables y UI
            pendienteEliminarId = null;
            pendingRetiro = null;
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            matriculaInput.value = '';
            adelantoInput.value = '';
            matriculaInput.focus();

            showToast('Retiro guardado y registro eliminado', 'info');
            await cargarYRenderizar();

        } catch (err) {
            console.error(err);
            showToast('Error al procesar retiro', 'error');
        }
    });

    /* ===================== INPUTS: mayúsculas y filtrado en vivo ===================== */

    matriculaInput.addEventListener('input', () => {
        const pos = matriculaInput.selectionStart;
        matriculaInput.value = matriculaInput.value.toUpperCase();
        matriculaInput.setSelectionRange(pos, pos);
        aplicarFiltro();
    });

    /* ===================== EXPORT CSV (REINVENTADA: exporta desde 'retiros' y la vacía) ===================== */

    exportBtn.addEventListener('click', async () => {
        try {
            const arr = await db.retiros.orderBy('fechaSalida').reverse().toArray();
            if (!arr || arr.length === 0) {
                showToast('No hay retiros para exportar', 'warn');
                return;
            }

            const cols = ['matricula','fechaIngreso','fechaSalida','tarifa','tarifaLabel','tarifaDia','tarifaNoche','adelanto','totalPago','debe'];
            const csv = [cols.join(',')].concat(arr.map(r =>
                `"${(r.matricula||'')}","${(r.fechaIngreso||'')}","${(r.fechaSalida||'')}","${(r.tarifa||'')}","${(r.tarifaLabel||'')}","${(typeof r.tarifaDia!=='undefined'?r.tarifaDia:'')}","${(typeof r.tarifaNoche!=='undefined'?r.tarifaNoche:'')}","${(r.adelanto||0)}","${(r.totalPago||0)}","${(r.debe||0)}"`
            )).join('\n');

            const blob = new Blob([csv], {type:'text/csv'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'retiros.csv';
            a.click();
            URL.revokeObjectURL(url);

            // Una vez exportado, vaciamos la tabla de retiros
            await db.retiros.clear();

            showToast('Exportado CSV y base de retiros vaciada', 'success');

        } catch (err) {
            console.error(err);
            showToast('Error exportando retiros', 'error');
        }
    });

    /* ===================== INICIALIZACIÓN ===================== */
    cargarYRenderizar();

}); // DOMContentLoaded end
