document.addEventListener('DOMContentLoaded', () => {

    // --- Supabase (credenciales que me diste) ---
    const SUPABASE_URL = 'https://jxyusfojvrcxsorzjtdd.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_lzbCKGqDwU9XjTCFNowSAw_c5rwVM1U';
    const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // DB setup (Dexie)
    const db = new Dexie("CocheraDB");

    // Dos bases de datos: cobros (funcional) y retiros (exportacion de datos)
    db.version(1).stores({
        cobros: "++id, matricula, tarifa, fechaIngreso"
    });
    db.version(2).stores({
        cobros: "++id, matricula, tarifa, fechaIngreso",
        // tabla 'retiros' para almacenar los retiros que luego se exportan
        retiros: "++id, matricula, tarifa, fechaIngreso, fechaSalida"
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
    const customDiaInput = document.getElementById('customDia');
    const customNocheInput = document.getElementById('customNoche');
    const adelantoInput = document.getElementById('adelanto');
    const tablaBody = document.querySelector('#tabla tbody');
    const exportBtn = document.getElementById('exportBtn');
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modal-text');
    const modalNo = document.getElementById('modal-no');
    const modalSi = document.getElementById('modal-si');
    const toastContainer = document.getElementById('toast-container');

    // Auth modal refs
    const authModal = document.getElementById('authModal');
    const authEmail = document.getElementById('authEmail');
    const authPassword = document.getElementById('authPassword');
    const authLoginBtn = document.getElementById('authLoginBtn');

    let rowsCache = [];
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
        // NOTA: no hay entrada para 'otro' aquí, porque 'otro' usará los inputs customDia/customNoche
    };

    // Usuarios administradores
    const USERADMINS = [
        'f3556a9d-ea57-4381-a37d-c4e91811e89b',
        '1b635d1b-abff-4317-ba93-632ddb4565bc',
        '004fa62d-5137-4f0b-a98f-9330797cce6e',
        '7a8e41a2-36d0-4c11-8d4b-b508aed84a91'
    ]

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
            const tr = document.createElement('tr');

            // Determinar la visualización de la tarifa (si fue "otro", usamos los valores guardados)
            let tarifaHtml = '';
            if (r.tarifa === 'otro') {
                tarifaHtml = `<div>Otro</div><div class="small">Día S/. ${formatCurrency(r.tarifaDia)} | Noche S/. ${formatCurrency(r.tarifaNoche)}</div>`;
            } else {
                tarifaHtml = `<div>${TARIFAS[r.tarifa].label}</div>`;
            }

            tr.innerHTML = `
      <td>${r.matricula}</td>
      <td>${formatDateShort(r.fechaIngreso)}</td>
      <td>${tarifaHtml}</td>
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

    // Mostrar / ocultar inputs personalizados si tarifa === 'otro'
    function actualizarCustomInputsVisibility() {
        if (tarifaSelect.value === 'otro') {
            customDiaInput.style.display = 'block';
            customNocheInput.style.display = 'block';
            customDiaInput.setAttribute('required', 'true');
            customNocheInput.setAttribute('required', 'true');
        } else {
            customDiaInput.style.display = 'none';
            customNocheInput.style.display = 'none';
            customDiaInput.removeAttribute('required');
            customNocheInput.removeAttribute('required');
        }
    }

    // Inicializar visibilidad (por si el select viene con valor)
    actualizarCustomInputsVisibility();
    tarifaSelect.addEventListener('change', actualizarCustomInputsVisibility);

    // AUTH LOGIC
    function showAuthModal() {
        authModal.style.display = 'flex';
        authModal.setAttribute('aria-hidden', 'false');
        authEmail.focus();
    }
    function hideAuthModal() {
        authModal.style.display = 'none';
        authModal.setAttribute('aria-hidden', 'true');
        authEmail.value = '';
        authPassword.value = '';
    }

    // Cuando cambia el estado de auth (login/logout), actualizamos UI
    _supabase.auth.onAuthStateChange((event, session) => {
        if (session && session.user) {
            hideAuthModal();
            // recargar datos locales (si corresponde)
            cargarYRenderizar();
            showToast(`Bienvenido ${session.user.email}`, 'success', 1800);
        } else {
            // obligamos a iniciar sesion antes de usar la app
            showAuthModal();
        }
    });

    // Intento inicial para ver si existe sesión
    (async () => {
        try {
            const { data } = await _supabase.auth.getSession();
            const session = data ? data.session : null;
            if (!session || !session.user) {
                showAuthModal();
            } else {
                hideAuthModal();
            }
        } catch (err) {
            console.error('Error comprobando sesión supabase', err);
            showAuthModal();
        }
    })();

    // Login button handler
    authLoginBtn.addEventListener('click', async () => {
        const email = authEmail.value.trim();
        const password = authPassword.value;
        if (!email || !password) {
            showToast('Email y contraseña son requeridos', 'warn');
            return;
        }
        authLoginBtn.disabled = true;
        authLoginBtn.textContent = 'Ingresando...';
        try {
            const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
            if (error) {
                showToast(error.message || 'Error al iniciar sesión', 'error');
                authLoginBtn.disabled = false;
                authLoginBtn.textContent = 'Iniciar';
                return;
            }
            if (data && data.user) {
                hideAuthModal();
                showToast(`Hola ${data.user.email}`, 'success');
                await cargarYRenderizar();
            } else {
                // En teoría el onAuthStateChange se encargará, pero por si acaso:
                showAuthModal();
            }
        } catch (err) {
            console.error(err);
            showToast('Error al intentar iniciar sesión', 'error');
        } finally {
            authLoginBtn.disabled = false;
            authLoginBtn.textContent = 'Iniciar';
        }
    });

    // Helper: asegura que hay usuario autenticado (si no, muestra modal)
    async function ensureAuthenticated() {
        const { data: { user } } = await _supabase.auth.getUser();
        if (!user) {
            showAuthModal();
            showToast('Debes iniciar sesión para usar esta acción', 'warn');
            return null;
        }
        return user;
    }

    // INGRESO
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // ver si hay usuario
        const user = await ensureAuthenticated();
        if (!user) return;

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

        let tarifaDia = 0, tarifaNoche = 0;

        if (tarifaKey === 'otro') {
            // Tomar los valores de los inputs custom
            const d = Number(customDiaInput.value);
            const n = Number(customNocheInput.value);
            tarifaDia = isFinite(d) && d >= 0 ? d : 0;
            tarifaNoche = isFinite(n) && n >= 0 ? n : 0;
        } else {
            const t = TARIFAS[tarifaKey];
            tarifaDia = t ? t.dia : 0;
            tarifaNoche = t ? t.noche : 0;
        }

        try {
            await db.cobros.add({
                matricula,
                tarifa: tarifaKey,
                tarifaDia,
                tarifaNoche,
                fechaIngreso: new Date().toISOString(),
                adelanto
            });
            showToast(`Ingreso registrado: ${matricula}`, 'success');

            matriculaInput.value = '';
            adelantoInput.value = '';
            tarifaSelect.value = 'auto_viejo';
            customDiaInput.value = '';
            customNocheInput.value = '';
            actualizarCustomInputsVisibility();

            await cargarYRenderizar();
        } catch (err) {
            console.error(err);
            showToast('Error al guardar', 'error');
        }
    });

    // Calculo del cobro total
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
        const MIN_11H = 11*60;
        const MIN_15H = 15*60;

        // Día de entrada
        const entradaMinutes = entrada.getHours()*60 + entrada.getMinutes();

        if (entradaMinutes >= MIN_15H) {
            // Si ingreso despues de las 3pm, no paga por día de entrada
            total += 0;
        } else if (entradaMinutes > MIN_11H && entradaMinutes < MIN_15H) {
            // Si ingreso entre las 11am y las 3pm, paga tarifa dia menos 1
            total += Math.max(0, tarifaDia - 1);
        } else {
            // Si entro antes de las 11am, paga día completo
            total += tarifaDia;
        }

        // Medianoches y días completos
        const startMidnight = new Date(entrada);
        startMidnight.setHours(0,0,0,0);
        const endMidnight = new Date(salida);
        endMidnight.setHours(0,0,0,0);

        let midnightsPassed = Math.floor((endMidnight - startMidnight) / (24*60*60*1000));
        if (midnightsPassed < 0) midnightsPassed = 0;

        // Por cada medianoche que pasa se adiciona tarifa noche completa
        total += midnightsPassed * tarifaNoche;

        // Por cada dia completo que el vehiculo pasa en la cochera, se adiciona tarifa dia completa
        // Los "días completos" son (medianoche count - 1). Ej: si pasa 4 medianoches -> 3 días completos intermedios
        const diasCompletos = Math.max(0, midnightsPassed - 1);
        total += diasCompletos * tarifaDia;

        // Día de salida
        const salidaMinutes = salida.getHours()*60 + salida.getMinutes();

        if (salidaMinutes < MIN_11H) {
            // Si sale antes de las 11am, no paga por dia de salida
            total += 0;
        } else if (salidaMinutes >= MIN_11H && salidaMinutes < MIN_15H) {
            // Si sale entre las 11am y las 3pm, paga tarifa dia menos 1
            total += Math.max(0, tarifaDia - 1);
        } else {
            // Si sale despues de las 3pm, paga tarifa dia completa
            total += tarifaDia;
        }

        return Number((total).toFixed(2));
    }

    // Modal (ventana) para retiro
    window.confirmRetirar = async function(id, matricula) {
        // antes de mostrar modal, verificar auth
        const user = await ensureAuthenticated();
        if (!user) return;

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
            tarifa: record.tarifa,
            fechaIngreso: record.fechaIngreso,
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
        pendingRetiro = null;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    });

    // Retirar? Si
    modalSi.addEventListener('click', async () => {
        // verificar auth de nuevo
        const user = await ensureAuthenticated();
        if (!user) {
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            pendingRetiro = null;
            return;
        }

        if (!pendingRetiro) {
            showToast('No hay retiro pendiente', 'warn');
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            return;
        }

        try {
            // Preparar objeto para insertar en 'retiros'
            const nuevoRetiro = {
                matricula: pendingRetiro.matricula,
                tarifa: pendingRetiro.tarifa,
                fechaIngreso: pendingRetiro.fechaIngreso,
                fechaSalida: pendingRetiro.fechaSalida.toISOString(),
                adelanto: pendingRetiro.adelanto,
                debe: pendingRetiro.debe
            };

            // Guardar en tabla 'retiros'
            await db.retiros.add(nuevoRetiro);

            // Borrar el registro original de 'cobros'
            await db.cobros.delete(pendingRetiro.id);

            // Limpiar variables y UI
            pendingRetiro = null;
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            matriculaInput.value = '';
            adelantoInput.value = '';

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
        const user = await ensureAuthenticated();
        if (!user) return;

        try {
            const arr = await db.retiros.orderBy('fechaSalida').reverse().toArray();
            if (!arr || arr.length === 0) {
                showToast('No hay retiros para exportar', 'warn');
                return;
            }

            const cols = ['matricula','fechaIngreso','fechaSalida','tarifa','adelanto','debe'];
            const csv = [cols.join(',')].concat(arr.map(r =>
                `"${(r.matricula||'')}","${(r.fechaIngreso||'')}","${(r.fechaSalida||'')}","${(r.tarifa||'')}","${(r.adelanto||0)}","${(r.debe||0)}"`
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
