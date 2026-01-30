document.addEventListener('DOMContentLoaded', () => {

    // DB setup (Dexie)
    const db = new Dexie("CocheraDB");

    // Dos bases de datos: cobros (funcional) y retiros (exportacion de datos)
    db.version(1).stores({
        cobros: "++id, matricula, tarifa, fechaIngreso"
    });
    db.version(2).stores({
        cobros: "++id, matricula, tarifa, fechaIngreso",
        // tabla 'retiros' para almacenar los retiros que luego se exportan
        retiros: "++id, matricula, tarifa, fechaIngreso, fechaSalida, totalPago"
    });
    // hay dos versiones ya que permite que los que usaban la primera version migren a la segunda sin problemas

    // Pedir persistencia de la base de datos
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(p => console.log("persistencia:", p));
    }

    // Registro del service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(()=>console.log('Service Worker registrado'))
            .catch(()=>console.log('Fallo registro de Service Worker'));
    }

    // Referencias a los elementos de la interfaz
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
    let pendingRetiro = null;

    // Tarifas
    const TARIFAS = {
        auto_viejo: { label: 'Auto viejo', dia: 5, noche: 7 },
        auto_nuevo: { label: 'Auto nuevo', dia: 6, noche: 8 },
        mototaxi: { label: 'Mototaxi', dia: 2, noche: 4 },
        moto_lineal: { label: 'Moto lineal', dia: 2, noche: 3 },
        triciclo: { label: 'Triciclo', dia: 1, noche: 4 },
        afilador: { label: 'Afilador', dia: 1, noche: 2 },
        camion: { label: 'Camion', dia: 7, noche: 12 },
        bicicleta: { label: 'Bicicleta', dia: 1, noche: 2 }
    };

    // Funcion para mostrar notificaciones no bloqueantes (Toasts)
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

    // Funciones auxiliares (matricula en MAYUS, dinero con dos decimales, fechas con mes escrito)
    function normalizeMatricula(s) {
        return s ? s.trim().toUpperCase() : '';
    }

    function formatCurrency(valor) {
        const n = Number(valor) || 0;
        return n.toFixed(2);
    }

    function formatDateShort(isoString) {
        const d = new Date(isoString);
        // Nombres de meses en español (minúsculas como pediste)
        const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre'];
        const day = d.getDate();
        const monthName = months[d.getMonth()] || '';
        // Hora en formato 12h sin segundos y AM/PM en mayúsculas sin espacio (ej: 12:37PM)
        let hours = d.getHours();
        const minutes = d.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        if (hours === 0) hours = 12;
        const minStr = String(minutes).padStart(2, '0');
        return `${day} de ${monthName}, ${hours}:${minStr}${ampm}`;
    }


    // Funcion para renderizar la tabla con los registros
    function render(list) {
        tablaBody.innerHTML = '';
        if (!list.length) {
            tablaBody.innerHTML = '<tr><td colspan="4" class="small">No hay registros</td></tr>';
            return;
        }
        for (const r of list) {
            const tarifaLabel = r.tarifaLabel || (TARIFAS[r.tarifa] && TARIFAS[r.tarifa].label) || r.tarifa;

            const tr = document.createElement('tr');
            tr.innerHTML = `
      <td>${r.matricula}</td>
      <td>${formatDateShort(r.fechaIngreso)}</td>
      <td>
        <div>${tarifaLabel}</div>
      </td>
      <td><button class="big-btn" style="padding:6px 8px" onclick="confirmRetirar(${r.id}, '${r.matricula.replace("'", "\\'")}')">RETIRAR</button></td>
    `;
            tablaBody.appendChild(tr);
        }
    }


    // Funciones para renderizar la tabla con los registros y filtrar
    async function cargarYRenderizar() {
        const all = await db.cobros.orderBy('fechaIngreso').reverse().toArray(); //ordena por fecha ingreso
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

    // INGRESO
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const raw = matriculaInput.value;
        const matricula = normalizeMatricula(raw);
        if (!matricula) {
            showToast('Ingrese matrícula', 'warn');
            matriculaInput.focus();
            return;
        }
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
            // matriculaInput.focus();

            await cargarYRenderizar();
        } catch (err) {
            console.error(err);
            showToast('Error al guardar', 'error');
        }
    });

    // Selector rapido de tarifa
    function setTarifa(t) {
        tarifaSelect.value = t;
        // matriculaInput.focus();
        const label = TARIFAS[t] ? TARIFAS[t].label : t;
        showToast(`${label} seleccionada`, 'info', 1200);
    }

    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tarifa = btn.dataset.tarifa;
            setTarifa(tarifa);
        });
    });

    // Funcion para calcular el cobro total
    function calcularCobro(record, fechaSalida) {
        const tarifaDia = (typeof record.tarifaDia !== 'undefined') ? Number(record.tarifaDia) : (TARIFAS[record.tarifa] ? TARIFAS[record.tarifa].dia : 0);
        const tarifaNoche = (typeof record.tarifaNoche !== 'undefined') ? Number(record.tarifaNoche) : (TARIFAS[record.tarifa] ? TARIFAS[record.tarifa].noche : 0);

        const entrada = new Date(record.fechaIngreso);
        const salida = new Date(fechaSalida);

        // Si por alguna razón la salida es anterior a la entrada, devolver 0
        if (salida <= entrada) return 0;

        const entradaDateStr = entrada.toDateString();
        const salidaDateStr = salida.toDateString();

        // Caso 1: fecha/hora salida y fecha/hora entrada pertenecen al mismo dia
        if (entradaDateStr === salidaDateStr) {
            const diffMs = salida - entrada;
            const diffHoras = diffMs / (1000*60*60);

            // Si un vehiculo se queda menos de 1 hora, no paga nada
            if (diffHoras < 1) return 0;
            // Si se queda menos de 5 horas, paga tarifa dia menos 1
            if (diffHoras < 5) return Math.max(0, tarifaDia - 1);
            // Si se queda más de 5 horas, paga tarifa día completa
            return tarifaDia;
        }

        // Caso 2: fechas distintas -> calculo por partes
        let total = 0;

        const entradaMinutes = entrada.getHours()*60 + entrada.getMinutes();
        const MIN_12_30 = 12*60 + 30; // 750
        const MIN_15_30 = 15*60 + 30; // 930

        // Día de entrada
        if (entradaMinutes >= MIN_15_30) {
            // Si ingreso despues de las 3:30pm, no paga por ese día
            total += 0;
        } else if (entradaMinutes > MIN_12_30 && entradaMinutes < MIN_15_30) {
            // Si ingreso entre las 3:30pm y las 12:30pm, paga mitad de tarifa día
            total += tarifaDia / 2;
        } else {
            // Si entro antes de las 12:30pm, paga día completo
            total += tarifaDia;
        }

        // Medianoches y días completos
        const startMidnight = new Date(entrada);
        startMidnight.setHours(0,0,0,0);
        const endMidnight = new Date(salida);
        endMidnight.setHours(0,0,0,0);

        let midnightsPassed = Math.round((endMidnight - startMidnight) / (24*60*60*1000));
        if (midnightsPassed < 0) midnightsPassed = 0;

        // Por cada medianoche que pasa se adiciona tarifa noche completa
        total += midnightsPassed * tarifaNoche;

        // Por cada dia completo que el vehiculo pasa en la cochera, se adiciona tarifa dia completa
        // Los "días completos" son (medianoche count - 1). Ej: si pasa 4 medianoches -> 3 días completos intermedios
        const diasCompletos = Math.max(0, midnightsPassed - 1);
        total += diasCompletos * tarifaDia;

        // Día de salida
        const salidaMinutes = salida.getHours()*60 + salida.getMinutes();
        const MIN_10_30 = 10*60 + 30; // 630

        if (salidaMinutes < MIN_10_30) {
            // Si sale antes de las 10:30am, no paga por ese dia
            total += 0;
        } else if (salidaMinutes >= MIN_10_30 && salidaMinutes < MIN_15_30) {
            // Si sale entre las 10:30am y las 3:30pm, paga tarifa dia menos 1
            total += Math.max(0, tarifaDia - 1);
        } else {
            // Si sale despues de las 3:30pm, paga tarifa dia completa
            total += tarifaDia;
        }

        return Number((total).toFixed(2));
    }

    // Modal (ventana) para retiro
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

    // Retirar? No
    modalNo.addEventListener('click', () => {
        pendienteEliminarId = null;
        pendingRetiro = null;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    });

    // Retirar? Si
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
            // matriculaInput.focus();

            showToast('Retiro guardado y registro eliminado', 'info');
            await cargarYRenderizar();

        } catch (err) {
            console.error(err);
            showToast('Error al procesar retiro', 'error');
        }
    });

    // Funcion para hacer filtro y mayus en input matricula
    matriculaInput.addEventListener('input', () => {
        const pos = matriculaInput.selectionStart;
        matriculaInput.value = matriculaInput.value.toUpperCase();
        matriculaInput.setSelectionRange(pos, pos);
        aplicarFiltro();
    });

    // Exportar CSV

    exportBtn.addEventListener('click', async () => {
        try {
            const arr = await db.retiros.orderBy('fechaSalida').reverse().toArray();
            if (!arr || arr.length === 0) {
                showToast('No hay retiros para exportar', 'warn');
                return;
            }

            const cols = ['matricula','fechaIngreso','fechaSalida','tarifa','adelanto','debe','totalPago'];
            const csv = [cols.join(',')].concat(arr.map(r =>
                `"${(r.matricula||'')}","${(r.fechaIngreso||'')}","${(r.fechaSalida||'')}","${(r.tarifa||'')}","${(r.adelanto||0)}","${(r.debe||0)}","${(r.totalPago||0)}"`
            )).join('\n');

            const blob = new Blob([csv], {type:'text/csv'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const now = new Date();

            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');

            a.download = `${yyyy}-${mm}-${dd}_${hh}-${min}.csv`;

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

    // Cargar datos iniciales
    cargarYRenderizar();

});
