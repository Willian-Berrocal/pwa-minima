document.addEventListener('DOMContentLoaded', () => {

    // --- Supabase (credenciales que me diste) ---
    const SUPABASE_URL = 'https://jxyusfojvrcxsorzjtdd.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_lzbCKGqDwU9XjTCFNowSAw_c5rwVM1U';
    const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
    const filterInput = document.getElementById('filterInput');
    const modal = document.getElementById('modal');
    const modalText = document.getElementById('modal-text');
    const modalNo = document.getElementById('modal-no');
    const modalSi = document.getElementById('modal-si');
    const collectBtn = document.getElementById('collectBtn');
    const collectModal = document.getElementById('collectModal');
    const collectModalText = document.getElementById('collect-modal-text');
    const collectNo = document.getElementById('collect-no');
    const collectSi = document.getElementById('collect-si');
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
    ];

    // Funcion para mostrar notificaciones no bloqueantes (Toasts)
    function showToast(message, type = 'info', duration = 2500) {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<div>${message}</div><button class="close" aria-label="cerrar">&times;</button>`;
        toastContainer.appendChild(t);

        t.querySelector('.close').addEventListener('click', () => t.remove());
        setTimeout(() => t.remove(), duration);
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
      <td><button class="big-btn" style="padding:4px 4px" onclick="confirmRetirar(${r.id}, '${r.matricula.replace("'", "\\'")}')">RETIRAR</button></td>
    `;
            tablaBody.appendChild(tr);
        }
    }


    // Funciones para renderizar la tabla con los registros y filtrar
    async function cargarYRenderizar() {
        try {
            const { data, error } = await _supabase
                .from('cobros')
                .select('*')
                .order('fechaingreso', { ascending: false });

            if (error) {
                console.error('Error cargando cobros desde Supabase', error);
                showToast('Error cargando registros', 'error');
                rowsCache = [];
                render([]);
                return;
            }

            // Normalizar campos para mantener compatibilidad con el render actual
            rowsCache = (data || []).map(r => {
                return {
                    id: r.id,
                    matricula: r.matricula,
                    tarifa: r.tarifa,
                    tarifaDia: (r.tarifadia !== undefined ? Number(r.tarifadia) : (r.tarifaDia !== undefined ? Number(r.tarifaDia) : 0)),
                    tarifaNoche: (r.tarifanoche !== undefined ? Number(r.tarifanoche) : (r.tarifaNoche !== undefined ? Number(r.tarifaNoche) : 0)),
                    fechaIngreso: (r.fechaingreso || r.fechaIngreso),
                    adelanto: (r.adelanto !== undefined ? Number(r.adelanto) : 0),
                    user_id: r.user_id || null
                };
            });

            aplicarFiltro();
        } catch (err) {
            console.error(err);
            showToast('Error cargando registros', 'error');
            rowsCache = [];
            render([]);
        }
    }

    function aplicarFiltro() {
        const q = normalizeMatricula(filterInput.value);
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
            showToast(`Conectado`, 'success', 1500);

            // --- FASE 6: mostrar boton Recolectar solo para admins ---
            try {
                const uid = session.user.id;
                if (USERADMINS.includes(uid)) {
                    collectBtn.style.display = 'inline-block';
                } else {
                    collectBtn.style.display = 'none';
                }
            } catch (err) {
                console.warn('No se pudo verificar admin', err);
                collectBtn.style.display = 'none';
            }

        } else {
            // obligamos a iniciar sesion antes de usar la app
            showAuthModal();
            // ocultar boton colectar
            if (collectBtn) collectBtn.style.display = 'none';
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
                // mostrar o no el boton collect segun si es admin
                try {
                    const uid = session.user.id;
                    if (USERADMINS.includes(uid)) collectBtn.style.display = 'inline-block';
                } catch (err) {
                    console.warn('No se pudo verificar admin', err);
                }
            }
        } catch (err) {
            console.error('Error comprobando sesión', err);
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

    // ---------- Monto helpers ----------
    // Intenta usar la RPC 'increment_monto' (SQL provista). Si no existe, hace fallback (select+update).
    async function incrementMonto(amount) {
        try {
            // tentativa 1: usar RPC (transaccional en servidor)
            const { data: rpcData, error: rpcError } = await _supabase.rpc('increment_monto', { delta: amount });
            if (rpcError && rpcError.code) {
                // si rpc no existe o falla, caemos al fallback
                console.warn('RPC increment_monto fallo:', rpcError);
            } else if (rpcData !== undefined) {
                // rpc devuelve el nuevo monto
                return rpcData;
            }
        } catch (err) {
            console.warn('RPC increment_monto no disponible o error:', err);
        }

        // Fallback: obtener valor actual y actualizar (no 100% a prueba de race, pero sirve si no hay RPC)
        try {
            // leer fila
            const { data: selData, error: selError } = await _supabase.from('monto').select('*').eq('id', 1).maybeSingle();
            if (selError) throw selError;
            const current = selData && selData.monto !== undefined ? Number(selData.monto) : 0;
            const newVal = Number((current + amount).toFixed(2));

            const { data: updData, error: updError } = await _supabase.from('monto').update({ monto: newVal }).eq('id', 1).select();
            if (updError) throw updError;
            return newVal;
        } catch (err) {
            console.error('Error incrementando monto (fallback):', err);
            throw err;
        }
    }

    async function getMonto() {
        try {
            const { data, error } = await _supabase.from('monto').select('monto').eq('id', 1).maybeSingle();
            if (error) {
                console.error('Error leyendo monto', error);
                return 0;
            }
            return (data && data.monto !== undefined) ? Number(data.monto) : 0;
        } catch (err) {
            console.error('Error getMonto', err);
            return 0;
        }
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
            matriculaInput.focus();
            return;
        }
        const tarifaKey = tarifaSelect.value;

        const adelantoVal = adelantoInput.value;
        const adelanto = adelantoVal === '' ? 0 : (Number(adelantoVal) || 0);

        let tarifaDia, tarifaNoche;

        if (tarifaKey === 'otro') {
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
            const payload = {
                matricula,
                tarifa: tarifaKey,
                tarifadia: tarifaDia,
                tarifanoche: tarifaNoche,
                fechaingreso: new Date().toISOString(),
                adelanto
                // user_id se completa por default auth.uid() si configuraste la tabla así
            };

            const { data, error } = await _supabase.from('cobros').insert([payload]);

            if (error) {
                console.error('Error insert supabase', error);
                showToast('Error al guardar en servidor', 'error');
                return;
            }

            // --- FASE 5: sumar el adelanto al Monto en Supabase ---
            if (adelanto && adelanto > 0) {
                try {
                    await incrementMonto(adelanto);
                } catch (err) {
                    console.error('No se pudo actualizar Monto tras ingreso:', err);
                }
            }

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

    // RETIRO: obtener registro desde Supabase y mostrar modal
    window.confirmRetirar = async function(id, matricula) {
        // antes de mostrar modal, verificar auth
        const user = await ensureAuthenticated();
        if (!user) return;

        try {
            const { data, error } = await _supabase.from('cobros').select('*').eq('id', id).maybeSingle();
            if (error) {
                console.error('Error fetching cobro', error);
                showToast('Error obteniendo registro', 'error');
                return;
            }
            if (!data) {
                showToast('Registro no encontrado', 'error');
                return;
            }

            // Normalizar
            const record = {
                id: data.id,
                matricula: data.matricula,
                tarifa: data.tarifa,
                tarifaDia: Number(data.tarifadia || data.tarifadia || 0),
                tarifaNoche: Number(data.tarifanoche || data.tarifanoche || 0),
                fechaIngreso: data.fechaingreso,
                adelanto: Number(data.adelanto || 0)
            };

            const fechaSalida = new Date();
            const totalCalc = calcularCobro(record, fechaSalida);
            const adel = record.adelanto || 0;
            const debe = Math.max(0, Number((totalCalc - adel).toFixed(2)));

            pendingRetiro = {
                id: record.id,
                matricula: record.matricula,
                tarifa: record.tarifa,
                fechaIngreso: record.fechaIngreso,
                fechaSalida,
                totalCalc,
                adelanto: adel,
                debe
            };

            const adelStr = `S/ ${formatCurrency(adel)}`;
            const totalStr = `S/ ${formatCurrency(totalCalc)}`;
            const debeStr = `S/ ${formatCurrency(debe)}`;

            modalText.innerHTML = `
              <div>Retirar ${record.matricula}?</div>
              <div style="margin-top:8px">Adelanto: ${adelStr}</div>
              <div>Total: ${totalStr}</div>
              <div style="margin-top:6px"><strong>Debe: ${debeStr}</strong></div>
            `;

            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');

        } catch (err) {
            console.error(err);
            showToast('Error obteniendo registro', 'error');
        }
    };

    // Retirar? No
    modalNo.addEventListener('click', () => {
        pendingRetiro = null;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    });

    // Retirar? Si -> INSERT en Supabase.retiros y BORRAR de Supabase.cobros
    modalSi.addEventListener('click', async () => {
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
            // Preparar objeto para insertar en 'retiros' (Supabase)
            const nuevoRetiroPayload = {
                matricula: pendingRetiro.matricula,
                tarifa: pendingRetiro.tarifa,
                fechaingreso: pendingRetiro.fechaIngreso,
                fechasalida: pendingRetiro.fechaSalida.toISOString(),
                adelanto: pendingRetiro.adelanto,
                debe: pendingRetiro.debe
                // user_id se completa si la tabla tiene default auth.uid()
            };

            // Insertar en Supabase.retiros
            const { data: insertData, error: insertError } = await _supabase.from('retiros').insert([nuevoRetiroPayload]);
            if (insertError) {
                console.error('Error insertando retiro en supabase', insertError);
                showToast('Error guardando retiro en servidor', 'error');
                return;
            }

            // --- FASE 5: sumar el debe al monto ---
            if (pendingRetiro.debe && pendingRetiro.debe > 0) {
                try {
                    await incrementMonto(pendingRetiro.debe);
                } catch (err) {
                    console.error('No se pudo actualizar Monto tras retiro:', err);
                }
            }

            // Borrar registro desde Supabase.cobros
            const { error: deleteError } = await _supabase.from('cobros').delete().eq('id', pendingRetiro.id);
            if (deleteError) {
                console.error('Error borrando cobro en supabase', deleteError);
                showToast('Error borrando registro en servidor', 'error');
                return;
            }

            pendingRetiro = null;
            modal.style.display = 'none';
            modal.setAttribute('aria-hidden', 'true');
            filterInput.value = '';

            showToast('Retiro realizado', 'success');
            await cargarYRenderizar();

        } catch (err) {
            console.error(err);
            showToast('Error exportando retiros', 'error');
        }
    });

    // RECOLECCION: Mostrar modal con monto actual
    collectBtn.addEventListener('click', async () => {
        const user = await ensureAuthenticated();
        if (!user) return;

        // verificar admin de nuevo por seguridad
        if (!USERADMINS.includes(user.id)) {
            showToast('No tienes permiso para recolectar', 'error');
            return;
        }

        try {
            const montoActual = await getMonto();
            // Si no hay monto, avisar y no mostrar modal
            if (!montoActual || montoActual <= 0) {
                showToast('No hay monto para recolectar', 'warn');
                return;
            }

            // Guardamos monto en el texto del modal (y localmente si quieres)
            collectModalText.textContent = `Recoger: S/ ${formatCurrency(montoActual)}`;
            // Guardar en atributo temporal para usar en el confirm
            collectModal.dataset.monto = String(montoActual);

            collectModal.style.display = 'flex';
            collectModal.setAttribute('aria-hidden', 'false');
        } catch (err) {
            console.error('Error preparando recoleccion', err);
            showToast('Error obteniendo monto', 'error');
        }
    });

    // Cancelar recoleccion
    collectNo.addEventListener('click', () => {
        collectModal.style.display = 'none';
        collectModal.setAttribute('aria-hidden', 'true');
        delete collectModal.dataset.monto;
    });

    // Confirmar recoleccion: insertar en recoleccion y luego resetear monto a 0
    collectSi.addEventListener('click', async () => {
        const user = await ensureAuthenticated();
        if (!user) {
            collectModal.style.display = 'none';
            collectModal.setAttribute('aria-hidden', 'true');
            delete collectModal.dataset.monto;
            return;
        }

        // verificar admin
        if (!USERADMINS.includes(user.id)) {
            showToast('No tienes permiso para recolectar', 'error');
            collectModal.style.display = 'none';
            collectModal.setAttribute('aria-hidden', 'true');
            delete collectModal.dataset.monto;
            return;
        }

        // valor guardado localmente
        const montoStr = collectModal.dataset.monto;
        const montoToCollect = montoStr ? Number(montoStr) : 0;

        if (!montoToCollect || montoToCollect <= 0) {
            showToast('Monto inválido', 'error');
            collectModal.style.display = 'none';
            collectModal.setAttribute('aria-hidden', 'true');
            delete collectModal.dataset.monto;
            return;
        }

        try {
            // 1) Insertar registro en recoleccion
            const payload = {
                monto: montoToCollect,
                collected_at: new Date().toISOString(),
                collected_by: user.id
            };

            const { data: insData, error: insError } = await _supabase.from('recoleccion').insert([payload]);
            if (insError) {
                console.error('Error insert recoleccion', insError);
                showToast('Error guardando recolección', 'error');
                return;
            }
            console.log(insData);

            // 2) Resetear monto a 0 (actualizar tabla monto)
            const { data: updData, error: updError } = await _supabase.from('monto').update({ monto: 0 }).eq('id', 1).select();
            if (updError) {
                console.error('Error reseteando monto', updError);
                showToast('Error reseteando monto (recolección ya guardada)', 'warn');
                // NOTA: la recolección ya fue guardada; puedes decidir si revertirla manualmente
                collectModal.style.display = 'none';
                collectModal.setAttribute('aria-hidden', 'true');
                delete collectModal.dataset.monto;
                await cargarYRenderizar();
                return;
            }
            console.log(updData);

            showToast(`Recolectado S/ ${formatCurrency(montoToCollect)}`, 'success');
            collectModal.style.display = 'none';
            collectModal.setAttribute('aria-hidden', 'true');
            delete collectModal.dataset.monto;
            await cargarYRenderizar();

        } catch (err) {
            console.error('Error procesando recoleccion', err);
            showToast('Error procesando recolección', 'error');
        }
    });

    // Funcion para hacer mayus en input matricula
    matriculaInput.addEventListener('input', () => {
        const pos = matriculaInput.selectionStart;
        matriculaInput.value = matriculaInput.value.toUpperCase();
        matriculaInput.setSelectionRange(pos, pos);
        // note: no llamar a aplicarFiltro() aquí (el filtro ahora está abajo)
    });

    // Funcion para hacer filtro y mayus en input filtro
    filterInput.addEventListener('input', () => {
        const pos = filterInput.selectionStart;
        filterInput.value = filterInput.value.toUpperCase();
        filterInput.setSelectionRange(pos, pos);
        aplicarFiltro();
    });

    // Cargar datos iniciales
    cargarYRenderizar();

});