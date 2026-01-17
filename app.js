/* ===================== PWA Cochera - app.js ===================== */
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

    /* ===================== TOASTS ===================== */

    /**
     * showToast(message, type, duration)
     * Muestra un toast no bloqueante.
     * type: 'success' | 'info' | 'warn' | 'error'
     * duration en ms (por defecto 2500)
     */
    function showToast(message, type = 'info', duration = 2500) {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<div>${message}</div><button class="close" aria-label="cerrar">&times;</button>`;
        toastContainer.appendChild(t);

        // Cerrar con botón
        t.querySelector('.close').addEventListener('click', () => {
            t.remove();
        });

        // Auto-dismiss
        setTimeout(() => {
            t.remove();
        }, duration);
    }

    /* ===================== HELPERS de UI/DB ===================== */

    /**
     * normalizeMatricula(s)
     * Normaliza matrícula: trim + uppercase
     */
    function normalizeMatricula(s) {
        return s ? s.trim().toUpperCase() : '';
    }

    /**
     * formatCurrency(valor)
     * Recibe número (o string numérico) y devuelve con 2 decimales.
     */
    function formatCurrency(valor) {
        const n = Number(valor) || 0;
        return n.toFixed(2);
    }

    /**
     * render(list)
     * Dibuja la tabla con los registros proporcionados.
     */
    function render(list) {
        tablaBody.innerHTML = '';
        if (!list.length) {
            tablaBody.innerHTML = '<tr><td colspan="4" class="small">No hay registros</td></tr>';
            return;
        }
        for (const r of list) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td>${r.matricula}</td>
        <td>${new Date(r.fechaIngreso).toLocaleString()}</td>
        <td>${r.tarifa}</td>
        <td><button class="big-btn" style="padding:6px 8px" onclick="confirmRetirar(${r.id}, '${r.matricula.replace("'", "\\'")}')">RETIRAR</button></td>
      `;
            tablaBody.appendChild(tr);
        }
    }

    /* ===================== CARGA Y FILTRADO ===================== */

    /**
     * cargarYRenderizar()
     * Obtiene todos los registros ordenados por fecha (desc) y renderiza aplicando filtro.
     */
    async function cargarYRenderizar() {
        const all = await db.cobros.orderBy('fechaIngreso').reverse().toArray();
        rowsCache = all;
        aplicarFiltro();
    }

    /**
     * aplicarFiltro()
     * Filtra rowsCache usando el campo de matrícula (arriba). Si vacío, muestra todo.
     */
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

    /**
     * Maneja el submit del formulario: guarda un nuevo registro con timestamp.
     */
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const raw = matriculaInput.value;
        const matricula = normalizeMatricula(raw);
        if (!matricula) { showToast('Ingrese matrícula', 'warn'); matriculaInput.focus(); return; }
        const tarifa = tarifaSelect.value;

        // LEER ADELANTO (opcional). Si está vacío o inválido, queda 0.
        const adelantoVal = adelantoInput.value;
        const adelanto = adelantoVal === '' ? 0 : (Number(adelantoVal) || 0);

        try {
            // Guardar ingreso con campo 'adelanto'
            await db.cobros.add({
                matricula,
                tarifa,
                fechaIngreso: new Date().toISOString(),
                adelanto // propiedad extra en el registro (opcional)
            });
            showToast(`Ingreso registrado: ${matricula}`, 'success');

            // Limpiar campos para agilizar siguiente operación
            matriculaInput.value = '';
            adelantoInput.value = '';   // <-- limpiamos adelanto también
            matriculaInput.focus();

            await cargarYRenderizar();
        } catch (err) {
            console.error(err);
            showToast('Error al guardar', 'error');
        }
    });


    /* ===================== BOTONES RÁPIDOS DE TARIFA ===================== */

    /**
     * setTarifa(t)
     * Establece el select de tarifa. Llamado por los botones rápidos.
     */
    function setTarifa(t) {
        tarifaSelect.value = t;
        matriculaInput.focus();
        showToast(`Tarifa ${t.replace('tarifa','')} seleccionada`, 'info', 1200);
    }

    // Añadimos listeners a los botones rápidos UNA VEZ que el DOM está listo
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tarifa = btn.dataset.tarifa;
            setTarifa(tarifa);
        });
    });

    /* ===================== MODAL DE CONFIRMACIÓN PARA RETIRAR ===================== */

    /**
     * confirmRetirar(id, matricula)
     * Abre modal para confirmar eliminación del registro con id.
     * Esta función se expone globalmente para ser llamada desde el HTML generado por render().
     */
    window.confirmRetirar = async function(id, matricula) {
        pendienteEliminarId = id;

        // Obtener el registro completo para leer 'adelanto'
        const record = await db.cobros.get(id);
        const adel = record && record.adelanto ? formatCurrency(record.adelanto) : null;

        // Construir contenido del modal: primera línea mensaje, segunda línea Adelanto (si existe)
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

    // Cerrar modal sin acción
    modalNo.addEventListener('click', () => {
        pendienteEliminarId = null;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    });

    // Confirmar y eliminar el registro seleccionado
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

    // Mientras el usuario escribe en el campo matrícula: uppercase y filtrar la tabla
    matriculaInput.addEventListener('input', () => {
        const pos = matriculaInput.selectionStart;
        matriculaInput.value = matriculaInput.value.toUpperCase();
        matriculaInput.setSelectionRange(pos, pos);
        aplicarFiltro();
    });

    /* ===================== EXPORT CSV ===================== */

    exportBtn.addEventListener('click', async () => {
        try {
            const arr = await db.cobros.orderBy('fechaIngreso').reverse().toArray();
            const cols = ['matricula','fechaIngreso','tarifa'];
            const csv = [cols.join(',')].concat(arr.map(r =>
                `"${r.matricula}","${r.fechaIngreso}","${r.tarifa}"`
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
