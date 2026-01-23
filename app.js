/* ===================== PWA Cochera - app.js (Fase 1: Tarifas reales) ===================== */
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

    /* ===================== MODAL DE CONFIRMACIÓN PARA RETIRAR ===================== */

    window.confirmRetirar = async function(id, matricula) {
        pendienteEliminarId = id;

        // Obtener el registro completo para leer 'adelanto'
        const record = await db.cobros.get(id);
        const adel = record && record.adelanto ? formatCurrency(record.adelanto) : null;

        if (adel && Number(adel) > 0) {
            modalText.innerHTML = `
      <div>Retirar ${matricula}?</div>
      <div style="margin-top:8px">Adelanto: S/ ${adel}</div>
    `;
        } else {
            modalText.innerHTML = `<div>Retirar ${matricula}?</div>`;
        }

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



