/* Kred Nova · ERP de Cobros — versión estática para GitHub Pages.
   Mismas reglas que la versión Python:
   - Interés FLAT en % mensual: interés total = monto × tasa × meses, repartido igual en las cuotas.
   - Frecuencias: diaria (lun–sáb, sin feriados), semanal, quincenal. Cuotas/mes: 26 / 4 / 2.
   - Sin cargos por mora. Pagos: cuota más antigua, interés y luego capital; el sobrante adelanta cuotas.
   - Clientes nunca se eliminan: se inactivan.
   Los datos se guardan en el navegador (localStorage) de cada dispositivo. */
'use strict';
(function () {
  // ---------------- Configuración ----------------
  const KEY = 'kred_nova_v1', UKEY = 'kred_nova_user';
  const EMPRESA = 'Kred Nova', LEMA = 'Soluciones de Capital Inteligente';
  const COBRAR_DOMINGOS = false;
  // Feriados en que no se cobra (AAAA-MM-DD). Actualice la lista cada año.
  const FERIADOS = new Set(['2026-12-08', '2026-12-25', '2027-01-01', '2027-03-25', '2027-03-26', '2027-05-01',
    '2027-05-30', '2027-07-19', '2027-09-14', '2027-09-15', '2027-12-08', '2027-12-25']);
  const USUARIOS = [
    { u: 'admin', rol: 'Administrador' }, { u: 'gerente', rol: 'Gerente' }, { u: 'cajero', rol: 'Cajero' },
    { u: 'gestor1', rol: 'Gestor' }, { u: 'gestor2', rol: 'Gestor' }];
  const CLAVE_DEMO = 'demo1234';
  const CUOTAS_POR_MES = { DIARIA: 26, SEMANAL: 4, QUINCENAL: 2 };
  const FREQ = { DIARIA: 'Diaria (lun–sáb)', SEMANAL: 'Semanal', QUINCENAL: 'Quincenal' };
  const EST_CR = { VIGENTE: 'Vigente', CANCELADO: 'Cancelado', CASTIGADO: 'Incobrable' };
  const EST_CL = { ACTIVO: 'Activo', INACTIVO: 'Inactivo' };
  const RESULTADOS = { COBRADO: 'Cobrado', PROMESA: 'Promesa de pago', NO_ENCONTRADO: 'No se encontró', SIN_DINERO: 'Sin dinero', OTRO: 'Otro' };
  const MOTIVOS = ['Crédito cancelado, sin renovación', 'Solicitud del cliente', 'Fallecimiento', 'Mal historial de pago', 'Otro'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const DABR = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // ---------------- Utilidades ----------------
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
  const dow = s => parse(s).getUTCDay();
  const fdate = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return d + '/' + m + '/' + y; };
  const fdateD = s => DABR[dow(s)] + ' ' + fdate(s);
  const fechaLarga = s => { const d = parse(s), n = DIAS[d.getUTCDay()]; return n[0].toUpperCase() + n.slice(1) + ' ' + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()] + ', ' + d.getUTCFullYear(); };
  const esDiaCobro = s => !(dow(s) === 0 && !COBRAR_DOMINGOS) && !FERIADOS.has(s);
  const money = c => (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const C = c => 'C$ ' + money(c);
  const toCents = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? NaN : Math.round(n * 100); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, s = 's') => n === 1 ? '' : s;
  const ahora = () => new Date().toISOString();

  // ---------------- Almacenamiento ----------------
  let S = null, MEM_USER = null;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
  };
  function load() {
    try { S = JSON.parse(store.get(KEY)); } catch (e) { S = null; }
    if (!S || S.v !== 1) { seed(); save(); }
  }
  function save() {
    if (!store.set(KEY, JSON.stringify(S))) {
      flash('No se pudo guardar en este navegador (almacenamiento lleno o bloqueado). Use fotos más pequeñas.', 'error');
      return false;
    }
    return true;
  }
  const nextId = k => (S.seq[k] = (S.seq[k] || 0) + 1);
  const bit = (accion, detalle) => S.bitacora.unshift({ fecha: ahora(), usuario: me() ? me().u : '—', accion, detalle: String(detalle).slice(0, 300) });

  // ---------------- Sesión y roles ----------------
  function me() { const u = MEM_USER || store.get(UKEY); return USUARIOS.find(x => x.u === u) || null; }
  const rol = () => (me() || {}).rol || '';
  const esGestor = () => rol() === 'Gestor';
  const puede = (...roles) => rol() === 'Administrador' || roles.includes(rol());
  const creditosVisibles = () => esGestor() ? S.creditos.filter(c => c.gestor === me().u) : S.creditos;
  const clientesVisibles = () => {
    if (!esGestor()) return S.clientes;
    const ids = new Set(creditosVisibles().map(c => c.cliente_id));
    return S.clientes.filter(c => ids.has(c.id));
  };

  // ---------------- Reglas de negocio ----------------
  const cli = id => S.clientes.find(c => c.id === id);
  const cred = id => S.creditos.find(c => c.id === id);
  const nombre = c => c.nombres + ' ' + c.apellidos;
  const iniciales = c => ((c.nombres[0] || '') + (c.apellidos[0] || '')).toUpperCase();
  const interesTotal = cr => Math.round(cr.monto * cr.tasa_mensual / 100 * cr.plazo_meses);
  const nCuotas = cr => cr.numero_cuotas || cr.plazo_meses * CUOTAS_POR_MES[cr.frecuencia];
  const valorCuota = cr => { const n = nCuotas(cr); return Math.round(cr.monto / n) + Math.round(interesTotal(cr) / n); };
  function fechasCuotas(cr) {
    const n = nCuotas(cr), out = []; let d = cr.fecha_desembolso;
    while (out.length < n) {
      if (cr.frecuencia === 'DIARIA') { d = addDays(d, 1); while (!esDiaCobro(d)) d = addDays(d, 1); }
      else d = addDays(d, cr.frecuencia === 'SEMANAL' ? 7 : 15);
      out.push(d);
    }
    return out;
  }
  function calcularPlan(cr) {
    const n = nCuotas(cr), I = interesTotal(cr), cc = Math.round(cr.monto / n), ic = Math.round(I / n);
    let ac = 0, ai = 0;
    return fechasCuotas(cr).map((f, k) => {
      const ult = k === n - 1, cap = ult ? cr.monto - ac : cc, int = ult ? I - ai : ic;
      ac += cap; ai += int;
      return { numero: k + 1, fecha: f, capital: cap, interes: int, pc: 0, pi: 0, pagada: false, fecha_pago: null };
    });
  }
  const qPend = q => Math.max(q.capital - q.pc, 0) + Math.max(q.interes - q.pi, 0);
  const qTotal = q => q.capital + q.interes;
  function qEstado(q, al) {
    if (q.pagada) return 'Pagada';
    if (q.fecha < al) return 'Atrasada';
    if (q.fecha === al) return 'Hoy';
    return (q.pc || q.pi) ? 'Abonada' : 'Pendiente';
  }
  function resumen(cr, al) {
    al = al || today();
    const pend = cr.cuotas.filter(q => !q.pagada), venc = pend.filter(q => q.fecha < al), exig = pend.filter(q => q.fecha <= al);
    const suma = a => a.reduce((s, q) => s + qPend(q), 0);
    return {
      saldo: suma(pend), vencido: suma(venc), ponerse: suma(exig), cuotas_vencidas: venc.length,
      dias_atraso: venc.length ? diffDays(al, venc[0].fecha) : 0, proxima: pend[0] || null,
      pagadas: cr.cuotas.length - pend.length,
      pagado_total: S.pagos.filter(p => p.credito_id === cr.id).reduce((s, p) => s + p.monto, 0)
    };
  }
  const tramo = d => d === 0 ? 'Al día' : d <= 7 ? '1–7 días' : d <= 30 ? '8–30 días' : d <= 60 ? '31–60 días' : '+60 días';
  function aplicarPago(cr, monto, usuario, fecha, nota) {
    fecha = fecha || today();
    let r = monto;
    if (!(r > 0)) throw new Error('El monto debe ser mayor que cero.');
    if (cr.estado !== 'VIGENTE') throw new Error('El crédito no está vigente.');
    let ti = 0, tc = 0, comp = 0, adel = 0;
    for (const q of cr.cuotas) {
      if (r <= 0) break;
      if (q.pagada) continue;
      const ai = Math.min(r, Math.max(q.interes - q.pi, 0)); q.pi += ai; r -= ai;
      const ac = Math.min(r, Math.max(q.capital - q.pc, 0)); q.pc += ac; r -= ac;
      ti += ai; tc += ac;
      if (qPend(q) <= 0) { q.pagada = true; q.fecha_pago = fecha; comp++; if (q.fecha > fecha) adel++; }
    }
    const id = nextId('pago');
    const p = { id, recibo: 'RC-' + pad(id, 7), credito_id: cr.id, fecha, monto, ai: ti, ac: tc, completas: comp, adelantadas: adel, sobrante: r, usuario, nota: nota || '' };
    S.pagos.push(p);
    if (cr.cuotas.every(q => q.pagada)) cr.estado = 'CANCELADO';
    return p;
  }
  function crearCliente(d) {
    const id = nextId('cliente');
    const c = Object.assign({ email: '', direccion: '', negocio: '', direccion_negocio: '', foto_cedula: '', estado: 'ACTIVO', fecha_inactivo: '', motivo_inactivo: '' }, d, { id, codigo: 'CL-' + pad(id, 5), creado: ahora() });
    S.clientes.push(c);
    return c;
  }
  function crearCredito(d) {
    const id = nextId('credito');
    const cr = Object.assign({ destino: '', gestor: '', fiador_nombre: '', fiador_cedula: '', fiador_telefono: '', fiador_direccion: '', estado: 'VIGENTE' }, d, { id, numero: 'CR-' + pad(id, 6) });
    cr.numero_cuotas = nCuotas(cr);
    cr.cuotas = calcularPlan(cr);
    S.creditos.push(cr);
    return cr;
  }
  const puedeInactivarse = c => !S.creditos.some(cr => cr.cliente_id === c.id && cr.estado === 'VIGENTE');

  // ---------------- Datos de demostración ----------------
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function seed() {
    const R = rng(11), ri = (a, b) => a + Math.floor(R() * (b - a + 1)), pick = a => a[Math.floor(R() * a.length)];
    const NOM = ['María José', 'Carlos', 'Ana Lucía', 'José Ramón', 'Rosa', 'Luis Alberto', 'Martha', 'Juan Carlos', 'Yesenia', 'Pedro', 'Karla', 'Francisco', 'Gloria', 'Ernesto', 'Indira', 'Roberto', 'Fátima', 'Álvaro', 'Scarleth', 'Danilo', 'Xiomara', 'Byron', 'Jessenia', 'Félix', 'Arlen', 'Orlando', 'Mayra', 'Henry', 'Lissette', 'Norman', 'Darling', 'Wilber'];
    const APE = ['López Martínez', 'García Rivas', 'Hernández Úbeda', 'Pérez Castillo', 'Sánchez Mairena', 'Rodríguez Obando', 'Gutiérrez Lacayo', 'Morales Téllez', 'Aguilar Zamora', 'Espinoza Ruiz', 'Mendoza Arauz', 'Torres Blandón', 'Rivera Solís', 'Cruz Duarte', 'Flores Picado', 'Reyes Membreño', 'Jarquín Báez', 'Martínez Soza', 'Chavarría Gómez', 'Ortega Pineda', 'Navarrete Ruiz', 'Dávila Cruz', 'Vanegas López', 'Bermúdez Rocha', 'Moreno Gaitán', 'Castro Urbina', 'Siles Mejía', 'Rocha Aráuz', 'Palacios Vega', 'Montenegro Ríos', 'Tercero Juárez', 'Zelaya Ocón'];
    const NEG = ['Pulpería', 'Venta de ropa', 'Taller mecánico', 'Comedor', 'Costura', 'Venta de frutas', 'Panadería', 'Ferretería', 'Salón de belleza', 'Venta de verduras', 'Tortillería', 'Zapatería'];
    const BAR = ['Managua, B° Altagracia', 'Managua, Mercado Oriental', 'Ciudad Sandino, zona 3', 'Masaya, Monimbó', 'Managua, B° Monseñor Lezcano', 'Tipitapa, centro', 'Managua, Villa Venezuela', 'Managua, Bello Horizonte'];
    const GAR = ['Televisor 50 pulgadas', 'Refrigeradora', 'Motocicleta', 'Máquina de coser industrial', 'Equipo de sonido', 'Cocina de 4 quemadores'];
    S = { v: 1, seq: {}, clientes: [], creditos: [], pagos: [], garantias: [], visitas: [], bitacora: [] };
    const hoy = today();
    for (let i = 0; i < 32; i++) {
      const barrio = pick(BAR);
      const c = crearCliente({
        nombres: NOM[i], apellidos: APE[i],
        cedula: '001-' + pad(ri(10, 28)) + pad(ri(1, 12)) + ri(60, 99) + '-' + (1000 + i) + String.fromCharCode(65 + i % 26),
        telefono: '8' + ri(100, 999) + '-' + ri(1000, 9999), email: i % 4 === 0 ? 'cliente' + (i + 1) + '@ejemplo.com' : '',
        direccion: barrio + ', casa ' + ri(10, 400), negocio: pick(NEG), direccion_negocio: barrio + ', de la iglesia ' + ri(1, 4) + 'c al sur'
      });
      const freq = ['DIARIA', 'DIARIA', 'SEMANAL', 'QUINCENAL'][i % 4];
      const meses = freq !== 'QUINCENAL' ? pick([2, 3, 4]) : pick([3, 4, 6]);
      const cr = crearCredito({
        cliente_id: c.id, monto: pick([3000, 5000, 8000, 10000, 15000, 20000]) * 100, tasa_mensual: pick([5, 6, 8]),
        plazo_meses: meses, frecuencia: freq, numero_cuotas: 0, fecha_desembolso: addDays(hoy, -ri(12, 70)),
        gestor: i % 2 ? 'gestor2' : 'gestor1', destino: 'Capital de trabajo',
        fiador_nombre: pick(NOM) + ' ' + pick(APE), fiador_cedula: '001-' + ri(100000, 999999) + '-' + ri(1000, 9999) + 'X',
        fiador_telefono: '8' + ri(100, 999) + '-' + ri(1000, 9999), fiador_direccion: pick(BAR)
      });
      if (i % 3 === 0) S.garantias.push({ id: nextId('garantia'), credito_id: cr.id, descripcion: pick(GAR), valor: pick([6000, 9000, 15000]) * 100, foto: '' });
      const perfil = i % 8, atraso = { 5: 2, 6: 5, 7: 12 }[perfil] || 0;
      const exig = cr.cuotas.filter(q => q.fecha < hoy);
      exig.slice(0, Math.max(0, exig.length - atraso)).forEach(q => aplicarPago(cr, qTotal(q), 'cajero', q.fecha));
      if (perfil === 5 || perfil === 6) S.visitas.push({ id: nextId('visita'), credito_id: cr.id, gestor: cr.gestor, fecha: addDays(hoy, -1), resultado: 'PROMESA', fecha_promesa: hoy, nota: 'Paga cuando cobre ventas', creado: ahora() });
      if (perfil === 7) S.visitas.push({ id: nextId('visita'), credito_id: cr.id, gestor: cr.gestor, fecha: addDays(hoy, -2), resultado: 'NO_ENCONTRADO', fecha_promesa: '', nota: 'Negocio cerrado', creado: ahora() });
    }
    const x = crearCliente({ nombres: 'Julio César', apellidos: 'Vargas Bonilla', cedula: '001-150378-0099X', telefono: '8555-0101', negocio: 'Carpintería' });
    Object.assign(x, { estado: 'INACTIVO', fecha_inactivo: hoy, motivo_inactivo: 'Crédito cancelado, sin renovación' });
  }

  // ---------------- Mensajes ----------------
  let FLASH = [];
  const flash = (m, t = 'success') => FLASH.push({ m, t });
  const flashes = () => { const h = FLASH.map(f => `<div class="msg ${f.t}" role="status">${esc(f.m)}</div>`).join(''); FLASH = []; return h; };

  // ---------------- Plantilla base ----------------
  const ICON = {
    panel: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    ruta: '<path d="M9 20l-5.4-2.7A1 1 0 0 1 3 16.4V4.6a1 1 0 0 1 1.4-.9L9 6m0 14l6-3m-6 3V6m6 11l4.6 2.3a1 1 0 0 0 1.4-.9V7.6a1 1 0 0 0-.6-.9L15 4m0 13V4m0 0L9 6"/>',
    clientes: '<circle cx="9" cy="7" r="4"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    creditos: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    reportes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    tel: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'
  };
  const svg = (k, s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

  function shell(content, active) {
    const u = me(), r = u.rol, g = r === 'Gestor';
    const L = (h, l, k) => `<a href="#/${h}" class="${active === k ? 'on' : ''}">${l}</a>`;
    const T = (h, l, k) => `<a href="#/${h}" class="${active === k ? 'on' : ''}">${svg(k)}${l}</a>`;
    return `<header class="top"><div class="top-in">
      <a href="#/"><img class="logo" src="logo.png" alt="${EMPRESA} — ${LEMA}"></a>
      <nav class="nav" aria-label="Principal">${g ? '' : L('', 'Panel', 'panel')}${L('ruta', 'Ruta de cobro', 'ruta')}${L('clientes', 'Clientes', 'clientes')}${L('creditos', 'Cartera', 'creditos')}${g ? '' : L('reportes', 'Reportes', 'reportes')}${(r === 'Administrador' || r === 'Gerente') ? L('bitacora', 'Bitácora', 'bitacora') : ''}</nav>
      <div class="user"><div class="who"><div style="font-weight:700">${esc(u.u)}</div><button class="linkbtn" data-act="logout">${r} · Salir</button></div>
      <div class="avatar" aria-hidden="true">${esc(u.u[0].toUpperCase())}</div></div></div></header>
      <main>${flashes()}${content}</main>
      <nav class="tabbar" aria-label="Secciones" style="--tabs:${g ? 4 : 5}">${g ? '' : T('', 'Panel', 'panel')}${T('ruta', 'Ruta', 'ruta')}${T('clientes', 'Clientes', 'clientes')}${T('creditos', 'Cartera', 'creditos')}${g ? `<a href="#" data-act="ics">${svg('agenda')}Agenda</a>` : T('reportes', 'Reportes', 'reportes')}</nav>`;
  }
  const head = (eyebrow, title, actions = '', sub = '') => `<div class="head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<div class="muted">${sub}</div>` : ''}</div>${actions ? `<div class="actions noprint">${actions}</div>` : ''}</div>`;
  const pillEst = e => `<span class="pill ${e}">${esc(EST_CR[e] || EST_CL[e] || e)}</span>`;
  const pillAtraso = d => d ? `<span class="pill ${d > 7 ? 'bad' : 'warn'}">${d} d</span>` : '<span class="pill ok">Al día</span>';
  const field = (name, label, val = '', type = 'text', extra = '') => `<p><label for="f_${name}">${label}</label><input class="inp" id="f_${name}" name="${name}" type="${type}" value="${esc(val)}" ${extra}></p>`;
  const sel = (name, label, opts, val, extra = '') => `<p><label for="f_${name}">${label}</label><select class="inp" id="f_${name}" name="${name}" ${extra}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></p>`;
  const waLink = tel => { const d = String(tel || '').replace(/\D/g, ''); return d.length === 8 ? '505' + d : d; };

  // ---------------- Vistas ----------------
  function vLogin() {
    return `<main><div style="max-width:400px;margin:4vh auto 0">
      <div style="text-align:center;margin-bottom:24px"><img src="logo.png" alt="${EMPRESA} — ${LEMA}" style="width:260px;max-width:80%;height:auto"></div>
      ${flashes()}
      <form class="card f" data-form="login" style="padding:24px">
        <h1 style="font-size:22px;margin-bottom:16px">Bienvenido</h1>
        <p><label for="u">Usuario</label><input class="inp" id="u" name="u" autocomplete="username" autocapitalize="none" required autofocus></p>
        <p><label for="p">Contraseña</label><input class="inp" id="p" type="password" name="p" autocomplete="current-password" required></p>
        <button class="btn" style="width:100%;min-height:52px;font-size:17px;margin-top:6px">Entrar</button>
        <div style="height:4px;border-radius:4px;background:linear-gradient(90deg,var(--gold),var(--gold-lt));margin-top:22px"></div>
        <p class="muted" style="text-align:center;font-size:13px;margin:10px 0 0">Demostración · usuarios: gerente, cajero, gestor1, gestor2 · clave demo1234</p>
      </form></div></main>`;
  }

  function vPanel() {
    if (esGestor()) return go('#/ruta');
    const hoy = today(), vig = creditosVisibles().filter(c => c.estado === 'VIGENTE');
    let cartera = 0, vencido = 0, porCobrar = 0; const tramos = {}, atr = [];
    vig.forEach(c => {
      const r = resumen(c, hoy); cartera += r.saldo; vencido += r.vencido; porCobrar += r.ponerse;
      if (r.dias_atraso) { const t = tramos[tramo(r.dias_atraso)] = tramos[tramo(r.dias_atraso)] || { n: 0, s: 0 }; t.n++; t.s += r.vencido; atr.push([c, r]); }
    });
    atr.sort((a, b) => b[1].dias_atraso - a[1].dias_atraso);
    const pagosHoy = S.pagos.filter(p => p.fecha === hoy);
    const recaudado = pagosHoy.reduce((s, p) => s + p.monto, 0), meta = porCobrar + recaudado, avance = meta ? Math.round(recaudado / meta * 100) : 0;
    const maxT = Math.max(1, ...Object.values(tramos).map(t => t.s));
    const porUsuario = {}; pagosHoy.forEach(p => { const u = porUsuario[p.usuario] = porUsuario[p.usuario] || { n: 0, t: 0 }; u.n++; u.t += p.monto; });
    const visitasHoy = S.visitas.filter(v => v.fecha === hoy).slice(-8).reverse();
    const n = atr.length, indice = cartera ? (vencido / cartera * 100).toFixed(1) : '0.0';
    return shell(`${head(fechaLarga(hoy), 'Panel de cartera', `<a class="btn ghost" href="#/reportes">Reportes</a>${puede('Gerente', 'Cajero') ? '<a class="btn gold" href="#/cliente/nuevo">+ Nuevo cliente</a>' : ''}`)}
      <div class="grid">
        <div class="kpi dark"><img class="star" src="estrella.png" alt="" aria-hidden="true"><div class="l">Cartera vigente</div><div class="v">${C(cartera)}</div><div class="s">${vig.length} créditos activos</div></div>
        <div class="kpi"><div class="l">Cobro del día</div><div class="v">${C(recaudado)}</div><div class="bar" role="img" aria-label="${avance} % de la meta"><div style="width:${avance}%"></div></div><div class="s">${avance} % de ${C(meta)} exigible hoy</div></div>
        <div class="kpi"><div class="l">Monto en atraso</div><div class="v bad">${C(vencido)}</div><div class="s">${n} cliente${plural(n)} atrasado${plural(n)}</div></div>
        <div class="kpi"><div class="l">Índice de atraso</div><div class="v">${indice} %</div><div class="s">Atraso ÷ cartera vigente</div></div>
      </div>
      <div class="split"><section class="main card">
        <div class="actions" style="justify-content:space-between"><h2 style="margin:0">Clientes atrasados · prioridad de visita</h2><a href="#/creditos?atraso=1">Ver todos</a></div>
        <div class="tw" style="margin-top:10px"><table><thead><tr><th>Cliente</th><th>Frecuencia</th><th class="n">Atraso</th><th class="n">Para ponerse al día</th><th class="hide-m">Gestor</th></tr></thead><tbody>
        ${atr.slice(0, 10).map(([c, r]) => { const k = cli(c.cliente_id); return `<tr><td><a href="#/credito/${c.id}" style="font-weight:700;text-decoration:none">${esc(nombre(k))}</a><div class="sub">${esc(k.negocio || c.numero)}</div></td><td>${FREQ[c.frecuencia]}</td><td class="n"><span class="pill ${r.dias_atraso > 7 ? 'bad' : 'warn'}">${r.dias_atraso} día${plural(r.dias_atraso)}</span></td><td class="n" style="font-weight:700">${C(r.ponerse)}</td><td class="hide-m">${esc(c.gestor || '—')}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Ningún cliente atrasado.</td></tr>'}
        </tbody></table></div></section>
      <div class="side">
        <section class="card"><h2>Antigüedad del atraso</h2>${['1–7 días', '8–30 días', '31–60 días', '+60 días'].map((o, i) => { const t = tramos[o] || { n: 0, s: 0 }; return `<div class="tramo"><div class="actions" style="justify-content:space-between;font-size:14px"><strong>${o}</strong><span class="muted num">${C(t.s)} · ${t.n}</span></div><div class="bar t${i}"><div style="width:${Math.round(t.s / maxT * 100)}%"></div></div></div>`; }).join('')}</section>
        <section class="card"><h2>Cobros de hoy por usuario</h2>${Object.entries(porUsuario).sort((a, b) => b[1].t - a[1].t).map(([u, d]) => `<div class="actions" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line-2)"><span>${esc(u)} <span class="muted">· ${d.n} recibo${plural(d.n)}</span></span><strong class="num">${C(d.t)}</strong></div>`).join('') || '<p class="muted" style="margin:0">Aún no hay cobros hoy.</p>'}</section>
        <section class="card"><div class="actions" style="justify-content:space-between"><h2 style="margin:0">Visitas de hoy</h2><a href="#/ruta">Ruta</a></div>${visitasHoy.map(v => { const c = cred(v.credito_id); return `<div class="actions" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line-2);margin-top:6px"><div><strong>${esc(nombre(cli(c.cliente_id)))}</strong><div class="muted" style="font-size:13px">${esc(v.gestor)}${v.nota ? ' · ' + esc(v.nota) : ''}</div></div><span class="pill ${v.resultado === 'COBRADO' ? 'ok' : 'warn'}">${RESULTADOS[v.resultado]}</span></div>`; }).join('') || '<p class="muted" style="margin:10px 0 0">Sin visitas registradas hoy.</p>'}</section>
      </div></div>`, 'panel');
  }

  function vRuta(q) {
    const hoy = today(); let qs = creditosVisibles().filter(c => c.estado === 'VIGENTE');
    if (q.gestor && !esGestor()) qs = qs.filter(c => c.gestor === q.gestor);
    const ids = new Set(qs.map(c => c.id));
    const visitasHoy = {}; S.visitas.filter(v => v.fecha === hoy && ids.has(v.credito_id)).forEach(v => { visitasHoy[v.credito_id] = v; });
    const promesas = new Set(S.visitas.filter(v => v.resultado === 'PROMESA' && v.fecha_promesa === hoy && ids.has(v.credito_id)).map(v => v.credito_id));
    const pagadoHoy = {}; S.pagos.filter(p => p.fecha === hoy && ids.has(p.credito_id)).forEach(p => { pagadoHoy[p.credito_id] = (pagadoHoy[p.credito_id] || 0) + p.monto; });
    let meta = 0, cobrado = 0; const items = [];
    qs.forEach(c => {
      const r = resumen(c, hoy), pagado = pagadoHoy[c.id] || 0;
      if (r.ponerse <= 0 && !pagado && !promesas.has(c.id)) return;
      const v = visitasHoy[c.id]; let estado, clase;
      if (pagado) { estado = 'Cobrado'; clase = 'ok'; }
      else if (v) { estado = RESULTADOS[v.resultado]; clase = 'warn'; }
      else if (r.dias_atraso) { estado = r.dias_atraso + ' días'; clase = 'bad'; }
      else { estado = 'Hoy'; clase = 'info'; }
      meta += r.ponerse + pagado; cobrado += pagado;
      items.push({ c, k: cli(c.cliente_id), r, pagado, estado, clase, pendiente: !pagado, visitado: !!v, promesa: promesas.has(c.id) });
    });
    items.sort((a, b) => (a.pagado ? 1 : 0) - (b.pagado ? 1 : 0) || b.r.dias_atraso - a.r.dias_atraso);
    const avance = meta ? Math.round(cobrado / meta * 100) : 0, hechas = items.filter(i => !i.pendiente || i.visitado).length;
    const gestores = [...new Set(S.creditos.filter(c => c.estado === 'VIGENTE' && c.gestor).map(c => c.gestor))].sort();
    return shell(`<div class="hero"><img class="star" src="estrella.png" alt="" aria-hidden="true">
        <div class="muted">${fechaLarga(hoy)}${esGestor() ? ' · ' + esc(me().u) : ''}</div><h1>Ruta de cobro</h1>
        <div class="actions" style="justify-content:space-between;align-items:baseline;margin-top:12px"><div><div class="muted" style="font-size:13px">Cobrado</div><div class="big num">${C(cobrado)}</div></div>
        <div style="text-align:right"><div class="muted" style="font-size:13px">Meta del día</div><div class="num" style="font:700 18px Montserrat,sans-serif">${C(meta)}</div></div></div>
        <div class="bar"><div style="width:${avance}%"></div></div><div class="muted" style="font-size:13px;margin-top:6px">${hechas} de ${items.length} visitas atendidas</div></div>
      ${esGestor() ? '' : `<div class="actions noprint" style="margin-bottom:14px"><label for="g" class="muted">Gestor</label><select id="g" class="inp" style="width:auto;flex:1" data-change="gestor"><option value="">Todos</option>${gestores.map(g => `<option ${q.gestor === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>`}
      <div style="max-width:720px">${items.map(i => {
        const dir = i.k.direccion_negocio || i.k.direccion || '';
        return `<div class="visit ${i.pendiente ? '' : 'done'}"><div class="vt"><div style="min-width:0"><div class="nm">${esc(nombre(i.k))}</div><div class="muted" style="font-size:14px">${esc(dir || 'Sin dirección')}</div></div><span class="pill ${i.clase}">${esc(i.estado)}</span></div>
          <div class="row"><span class="muted">${FREQ[i.c.frecuencia]} · cuota ${Math.min(i.r.pagadas + 1, i.c.numero_cuotas)} de ${i.c.numero_cuotas}${i.promesa ? ' · promesa hoy' : ''}</span><strong class="num">${C(i.pendiente ? i.r.ponerse : i.pagado)}</strong></div>
          ${i.pendiente ? `<div class="acts"><a class="btn gold" href="#/pagar/${i.c.id}">Cobrar</a>
            <a class="btn ghost sq" href="tel:${esc(i.k.telefono)}" aria-label="Llamar a ${esc(nombre(i.k))}">${svg('tel', 20)}</a>
            <a class="btn ghost sq" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}" aria-label="Cómo llegar">${svg('pin', 20)}</a>
            <a class="btn ghost sq" href="#/visita/${i.c.id}" aria-label="Registrar visita sin cobro">${svg('edit', 20)}</a></div>` : ''}</div>`;
      }).join('') || '<div class="card muted">No hay cobros pendientes para hoy. Toda la cartera está al día.</div>'}</div>
      <p class="noprint"><button class="btn ghost" data-act="ics">Descargar agenda de visitas (.ics)</button></p>`, 'ruta');
  }

  function vVisita(id) {
    const c = creditosVisibles().find(x => x.id === id); if (!c) return vNoEncontrado();
    return shell(`${head(c.numero, 'Visita sin cobro', '', esc(nombre(cli(c.cliente_id))))}
      <form class="card f" data-form="visita" data-id="${c.id}" style="max-width:520px">
        ${sel('resultado', 'Resultado', Object.entries(RESULTADOS).filter(([k]) => k !== 'COBRADO'), 'PROMESA')}
        ${field('fecha_promesa', 'Fecha prometida', addDays(today(), 1), 'date')}
        ${field('nota', 'Nota', '', 'text', 'maxlength="200"')}
        <div class="actions"><button class="btn gold">Guardar visita</button><a class="btn ghost" href="#/ruta">Cancelar</a></div></form>`, 'ruta');
  }

  function vClientes(q) {
    const estado = q.estado ?? 'ACTIVO', t = (q.q || '').trim().toLowerCase();
    let l = clientesVisibles().filter(c => !estado || c.estado === estado);
    if (t) l = l.filter(c => [c.nombres, c.apellidos, c.cedula, c.codigo, c.telefono, c.negocio].some(x => String(x || '').toLowerCase().includes(t)));
    l = [...l].sort((a, b) => (a.apellidos + a.nombres).localeCompare(b.apellidos + b.nombres));
    return shell(`${head('Directorio', 'Clientes', puede('Gerente', 'Cajero') ? '<a class="btn gold" href="#/cliente/nuevo">+ Nuevo cliente</a>' : '')}
      <form class="card actions" data-form="buscar" role="search">
        <input class="inp" style="flex:1 1 240px" name="q" value="${esc(q.q || '')}" placeholder="Nombre, cédula, código, teléfono o negocio" aria-label="Buscar cliente">
        <select class="inp" style="width:auto" name="estado" aria-label="Estado"><option value="ACTIVO" ${estado === 'ACTIVO' ? 'selected' : ''}>Activos</option><option value="INACTIVO" ${estado === 'INACTIVO' ? 'selected' : ''}>Inactivos</option><option value="" ${!estado ? 'selected' : ''}>Todos</option></select>
        <button class="btn">Buscar</button></form>
      <div class="card tw"><table><thead><tr><th>Cliente</th><th>Cédula</th><th>Teléfono</th><th class="hide-m">Negocio</th><th>Estado</th></tr></thead><tbody>
      ${l.map(c => `<tr><td><a href="#/cliente/${c.id}" style="font-weight:700;text-decoration:none">${esc(nombre(c))}</a><div class="sub">${c.codigo}</div></td><td>${esc(c.cedula)}</td><td><a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a></td><td class="hide-m">${esc(c.negocio || '—')}</td><td>${pillEst(c.estado)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin resultados.</td></tr>'}
      </tbody></table></div>`, 'clientes');
  }

  function vClienteForm(id) {
    if (!puede('Gerente', 'Cajero')) return vSinPermiso();
    const c = id ? cli(id) : {}; if (id && !c) return vNoEncontrado();
    return shell(`${head('Clientes', id ? 'Editar cliente' : 'Nuevo cliente')}
      <form class="card f" data-form="cliente" data-id="${id || ''}"><div class="fgrid">
        ${field('nombres', 'Nombres', c.nombres, 'text', 'required maxlength="100"')}${field('apellidos', 'Apellidos', c.apellidos, 'text', 'required maxlength="100"')}
        ${field('cedula', 'Cédula', c.cedula, 'text', 'required maxlength="20"')}${field('telefono', 'Teléfono', c.telefono, 'tel', 'required maxlength="20"')}
        ${field('email', 'Correo', c.email, 'email')}${field('negocio', 'Negocio / actividad', c.negocio)}
        ${field('direccion', 'Dirección de domicilio', c.direccion)}${field('direccion_negocio', 'Dirección del negocio', c.direccion_negocio)}
        <p><label for="f_foto">Foto de cédula</label><input class="inp" id="f_foto" name="foto" type="file" accept="image/*" capture="environment">${c.foto_cedula ? '<span class="helptext">Ya tiene foto; suba otra solo para reemplazarla.</span>' : ''}</p>
      </div><div class="actions"><button class="btn gold">Guardar</button><a class="btn ghost" href="${id ? '#/cliente/' + id : '#/clientes'}">Cancelar</a></div></form>`, 'clientes');
  }

  function vClienteDetalle(id) {
    const c = clientesVisibles().find(x => x.id === id); if (!c) return vNoEncontrado();
    const crs = S.creditos.filter(x => x.cliente_id === id);
    const ger = puede('Gerente');
    return shell(`<div class="head"><div class="actions" style="gap:14px"><div class="avatar" style="width:56px;height:56px;font-size:20px" aria-hidden="true">${esc(iniciales(c))}</div>
        <div><div class="eyebrow">${c.codigo}</div><h1>${esc(nombre(c))}</h1></div>${pillEst(c.estado)}</div>
        <div class="actions noprint">${puede('Gerente', 'Cajero') ? `<a class="btn ghost" href="#/cliente/${id}/editar">Editar</a>${c.estado === 'ACTIVO' ? `<a class="btn gold" href="#/credito/nuevo/${id}">+ Nuevo crédito</a>` : ''}` : ''}</div></div>
      <div class="split"><div class="main">
        <section class="card"><h2>Datos del cliente</h2><div class="dl">
          <div><span>Cédula</span>${esc(c.cedula)}</div><div><span>Teléfono</span><a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a></div>
          <div><span>Correo</span>${esc(c.email || '—')}</div><div><span>Negocio</span>${esc(c.negocio || '—')}</div>
          <div style="grid-column:1/-1"><span>Dirección de domicilio</span>${esc(c.direccion || '—')}</div>
          <div style="grid-column:1/-1"><span>Dirección del negocio</span>${esc(c.direccion_negocio || '—')}</div>
          ${c.estado === 'INACTIVO' ? `<div style="grid-column:1/-1;color:var(--bad)"><span>Inactivo desde ${fdate(c.fecha_inactivo)}</span>${esc(c.motivo_inactivo)}</div>` : ''}
        </div></section>
        <section class="card"><h2>Créditos</h2><div class="tw"><table><thead><tr><th>Crédito</th><th>Desembolso</th><th class="n">Monto</th><th class="n">Saldo</th><th class="n">Atraso</th><th>Estado</th></tr></thead><tbody>
        ${crs.map(cr => { const r = resumen(cr); return `<tr><td><a href="#/credito/${cr.id}">${cr.numero}</a><div class="sub">${FREQ[cr.frecuencia]} · ${cr.tasa_mensual} % mensual</div></td><td>${fdate(cr.fecha_desembolso)}</td><td class="n">${C(cr.monto)}</td><td class="n">${C(r.saldo)}</td><td class="n">${r.dias_atraso ? `<span class="pill bad">${r.dias_atraso} d</span>` : '—'}</td><td>${pillEst(cr.estado)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Sin créditos.</td></tr>'}
        </tbody></table></div></section></div>
      <div class="side">
        ${c.foto_cedula ? `<section class="card"><h2>Cédula</h2><img src="${c.foto_cedula}" alt="Foto de la cédula" style="width:100%;border-radius:10px"></section>` : ''}
        ${ger ? `<section class="card noprint"><h2>Estado del cliente</h2>${c.estado === 'ACTIVO' ? (puedeInactivarse(c) ? `
          <form class="f" data-form="inactivar" data-id="${id}">${sel('motivo', 'Motivo', MOTIVOS.map(m => [m, m]), MOTIVOS[0])}<p><input class="inp" name="detalle" placeholder="Detalle (opcional)" maxlength="150" aria-label="Detalle"></p><button class="btn bad">Inactivar cliente</button></form>
          <p class="muted" style="font-size:14px">El cliente no se elimina: queda inactivo y su historial se conserva.</p>` : '<p class="muted" style="margin:0">No se puede inactivar mientras tenga créditos vigentes.</p>')
          : `<button class="btn ghost" data-act="reactivar" data-id="${id}">Reactivar cliente</button>`}</section>` : ''}
      </div></div>`, 'clientes');
  }

  function vCreditoNuevo(cid) {
    if (!puede('Gerente', 'Cajero')) return vSinPermiso();
    const c = cli(cid); if (!c) return vNoEncontrado();
    if (c.estado !== 'ACTIVO') { flash('Solo clientes activos pueden recibir créditos.', 'error'); return go('#/cliente/' + cid); }
    const gest = USUARIOS.map(u => [u.u, u.u]);
    return shell(`${head(c.codigo + ' · ' + esc(nombre(c)), 'Nuevo crédito')}
      <form class="card f" data-form="credito" data-id="${cid}"><div class="fgrid">
        <div class="sect">Condiciones</div>
        ${field('monto', 'Monto (C$)', '', 'number', 'required min="1" step="0.01" inputmode="decimal"')}
        ${field('tasa_mensual', 'Tasa mensual %', '', 'number', 'required min="0" step="0.01" inputmode="decimal"')}
        ${field('plazo_meses', 'Plazo (meses)', '', 'number', 'required min="1" step="1"')}
        ${sel('frecuencia', 'Frecuencia', Object.entries(FREQ), 'DIARIA')}
        <p><label for="f_numero_cuotas">Número de cuotas</label><input class="inp" id="f_numero_cuotas" name="numero_cuotas" type="number" min="1" step="1"><span class="helptext">Déjelo vacío para calcularlo: diaria 26 por mes, semanal 4, quincenal 2.</span></p>
        ${field('fecha_desembolso', 'Fecha de desembolso', today(), 'date', 'required')}
        <div class="sect">Otros datos</div>
        ${field('destino', 'Destino del crédito', 'Capital de trabajo')}
        ${sel('gestor', 'Gestor', [['', '—'], ...gest], me().u)}
        <div class="sect">Fiador</div>
        ${field('fiador_nombre', 'Nombre del fiador')}${field('fiador_cedula', 'Cédula del fiador')}${field('fiador_telefono', 'Teléfono del fiador', '', 'tel')}${field('fiador_direccion', 'Dirección del fiador')}
      </div><div class="actions"><button class="btn ghost" name="accion" value="simular">Calcular plan de pagos</button><button class="btn gold" name="accion" value="confirmar" id="btnConfirmar" disabled>Confirmar desembolso</button></div></form>
      <div id="plan"></div>`, 'clientes');
  }

  function vCreditos(q) {
    const estado = q.estado ?? 'VIGENTE', soloAtr = q.atraso === '1';
    let filas = creditosVisibles().filter(c => !estado || c.estado === estado).map(c => [c, resumen(c)]);
    if (soloAtr) filas = filas.filter(f => f[1].dias_atraso).sort((a, b) => b[1].dias_atraso - a[1].dias_atraso);
    return shell(`${head('Créditos', soloAtr ? 'Clientes atrasados' : 'Cartera')}
      <form class="card actions" data-form="filtro">
        <select class="inp" style="width:auto" name="estado" aria-label="Estado">${[['VIGENTE', 'Vigentes'], ['CANCELADO', 'Cancelados'], ['CASTIGADO', 'Incobrables'], ['', 'Todos']].map(([v, l]) => `<option value="${v}" ${estado === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="actions" style="gap:6px"><input type="checkbox" name="atraso" value="1" ${soloAtr ? 'checked' : ''} style="width:20px;height:20px"> Solo atrasados</label>
        <button class="btn">Filtrar</button></form>
      <div class="card tw"><table><thead><tr><th>Cliente</th><th>Frecuencia</th><th class="n">Cuota</th><th class="n">Saldo</th><th class="n">Para ponerse al día</th><th class="n">Atraso</th><th class="hide-m">Gestor</th></tr></thead><tbody>
      ${filas.map(([c, r]) => `<tr><td><a href="#/credito/${c.id}" style="font-weight:700;text-decoration:none">${esc(nombre(cli(c.cliente_id)))}</a><div class="sub">${c.numero}</div></td><td>${FREQ[c.frecuencia]}</td><td class="n">${money(valorCuota(c))}</td><td class="n">${money(r.saldo)}</td><td class="n">${money(r.ponerse)}</td><td class="n">${pillAtraso(r.dias_atraso)}</td><td class="hide-m">${esc(c.gestor || '—')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin créditos.</td></tr>'}
      </tbody></table></div>`, 'creditos');
  }

  function vCredito(id) {
    const c = creditosVisibles().find(x => x.id === id); if (!c) return vNoEncontrado();
    const k = cli(c.cliente_id), hoy = today(), r = resumen(c, hoy);
    const pagos = S.pagos.filter(p => p.credito_id === id).sort((a, b) => b.id - a.id);
    const gar = S.garantias.filter(g => g.credito_id === id), vis = S.visitas.filter(v => v.credito_id === id).reverse().slice(0, 10);
    const vig = c.estado === 'VIGENTE';
    const resumenTxt = `${EMPRESA} · Estado de cuenta ${c.numero}\n${nombre(k)}\nSaldo pendiente: ${C(r.saldo)}\n${r.dias_atraso ? 'Para ponerse al día: ' + C(r.ponerse) + '\n' : ''}${r.proxima ? 'Próxima cuota: ' + C(qPend(r.proxima)) + ' el ' + fdate(r.proxima.fecha) : ''}`;
    return shell(`${head(c.numero + ' · ' + FREQ[c.frecuencia], `<a href="#/cliente/${k.id}" style="color:inherit;text-decoration:none">${esc(nombre(k))}</a>`,
      `<a class="btn ghost" href="#/estado/${id}">Imprimir estado de cuenta</a>${vig ? `<a class="btn gold" href="#/pagar/${id}">Registrar pago</a>` : ''}`)}
      <div class="grid">
        <div class="kpi dark"><img class="star" src="estrella.png" alt="" aria-hidden="true"><div class="l">Saldo pendiente</div><div class="v">${C(r.saldo)}</div><div class="s">${r.pagadas} de ${c.numero_cuotas} cuotas pagadas</div></div>
        <div class="kpi"><div class="l">Para ponerse al día</div><div class="v ${r.dias_atraso ? 'bad' : ''}">${C(r.ponerse)}</div><div class="s">${r.dias_atraso ? `${r.cuotas_vencidas} cuota${plural(r.cuotas_vencidas)} atrasada${plural(r.cuotas_vencidas)} · ${r.dias_atraso} días` : 'Al día'}</div></div>
        <div class="kpi"><div class="l">Próxima cuota</div><div class="v">${r.proxima ? C(qPend(r.proxima)) : '—'}</div><div class="s">${r.proxima ? DIAS[dow(r.proxima.fecha)] + ' ' + fdate(r.proxima.fecha) : 'Crédito cancelado'}</div></div>
        <div class="kpi"><div class="l">Condiciones</div><div style="margin-top:6px;font-size:15px">${C(c.monto)} al ${c.tasa_mensual} % mensual<br>${c.plazo_meses} mes${plural(c.plazo_meses, 'es')} · cuota ${C(valorCuota(c))}<br><span class="muted">Desembolso ${fdate(c.fecha_desembolso)} · ${pillEst(c.estado)}</span></div></div>
      </div>
      <div class="split"><div class="main">
        <section class="card"><h2>Plan de pagos</h2><div class="tw" style="max-height:520px;overflow:auto"><table><thead><tr><th>#</th><th>Fecha</th><th class="n">Cuota</th><th class="n">Pagado</th><th class="n">Pendiente</th><th>Estado</th></tr></thead><tbody>
        ${c.cuotas.map(q => { const e = qEstado(q, hoy); return `<tr><td>${q.numero}</td><td>${fdateD(q.fecha)}</td><td class="n">${money(qTotal(q))}</td><td class="n">${money(q.pc + q.pi)}</td><td class="n">${money(qPend(q))}</td><td><span class="pill ${e}">${e}</span></td></tr>`; }).join('')}
        </tbody></table></div></section>
        <section class="card"><h2>Pagos recibidos</h2><div class="tw"><table><thead><tr><th>Recibo</th><th>Fecha</th><th class="n">Monto</th><th class="n">Interés</th><th class="n">Capital</th><th class="hide-m">Usuario</th></tr></thead><tbody>
        ${pagos.map(p => `<tr><td><a href="#/recibo/${p.id}">${p.recibo}</a></td><td>${fdate(p.fecha)}</td><td class="n"><strong>${money(p.monto)}</strong></td><td class="n">${money(p.ai)}</td><td class="n">${money(p.ac)}</td><td class="hide-m">${esc(p.usuario)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin pagos.</td></tr>'}
        </tbody></table></div></section></div>
      <div class="side">
        <section class="card"><h2>Fiador</h2>${c.fiador_nombre ? `<div class="dl"><div style="grid-column:1/-1"><span>Nombre</span>${esc(c.fiador_nombre)}</div><div><span>Cédula</span>${esc(c.fiador_cedula || '—')}</div><div><span>Teléfono</span>${c.fiador_telefono ? `<a href="tel:${esc(c.fiador_telefono)}">${esc(c.fiador_telefono)}</a>` : '—'}</div><div style="grid-column:1/-1"><span>Dirección</span>${esc(c.fiador_direccion || '—')}</div></div>` : '<p class="muted" style="margin:0">Sin fiador registrado.</p>'}</section>
        <section class="card"><h2>Garantías</h2>${gar.length ? `<div class="thumbs">${gar.map(g => `<figure>${g.foto ? `<img src="${g.foto}" alt="${esc(g.descripcion)}">` : ''}<figcaption><strong>${esc(g.descripcion)}</strong>${g.valor ? `<br><span class="muted">${C(g.valor)}</span>` : ''}</figcaption></figure>`).join('')}</div>` : '<p class="muted">Sin garantías registradas.</p>'}
          ${puede('Gerente', 'Cajero') ? `<form class="f noprint" data-form="garantia" data-id="${id}" style="margin-top:14px">${field('descripcion', 'Descripción', '', 'text', 'required maxlength="200"')}${field('valor', 'Valor estimado (C$)', '', 'number', 'min="0" step="0.01"')}<p><label for="f_gfoto">Foto</label><input class="inp" id="f_gfoto" name="foto" type="file" accept="image/*" capture="environment"></p><button class="btn ghost">Agregar garantía</button></form>` : ''}</section>
        <section class="card"><h2>Visitas</h2>${vis.map(v => `<div style="padding:8px 0;border-top:1px solid var(--line-2)"><div class="actions" style="justify-content:space-between"><strong>${fdate(v.fecha)}</strong><span class="pill ${v.resultado === 'COBRADO' ? 'ok' : 'warn'}">${RESULTADOS[v.resultado]}</span></div><div class="muted" style="font-size:13px">${esc(v.gestor)}${v.fecha_promesa ? ' · promete ' + fdate(v.fecha_promesa).slice(0, 5) : ''}${v.nota ? ' · ' + esc(v.nota) : ''}</div></div>`).join('') || '<p class="muted" style="margin:0">Sin visitas registradas.</p>'}</section>
        <div class="noprint" style="display:flex;flex-direction:column;gap:10px">
          <a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/${waLink(k.telefono)}?text=${encodeURIComponent(resumenTxt)}">Enviar resumen por WhatsApp</a>
          ${vig && puede('Gerente') ? `<button class="btn bad" data-act="incobrable" data-id="${id}">Declarar incobrable</button>` : ''}
        </div>
      </div></div>`, 'creditos');
  }

  function vPagar(id) {
    if (!puede('Gerente', 'Cajero', 'Gestor')) return vSinPermiso();
    const c = creditosVisibles().find(x => x.id === id); if (!c) return vNoEncontrado();
    if (c.estado !== 'VIGENTE') { flash('El crédito no está vigente.', 'error'); return go('#/credito/' + id); }
    const r = resumen(c), vc = valorCuota(c);
    const ops = [['Una cuota', vc]]; if (r.ponerse && r.ponerse !== vc) ops.push(['Ponerse al día', r.ponerse]); ops.push(['Cancelar todo', r.saldo]);
    const ini = r.ponerse || vc;
    return shell(`<div style="max-width:560px;margin:auto">${head(c.numero, 'Registrar pago', '', esc(nombre(cli(c.cliente_id))))}
      <div class="hero" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
        <div><div class="muted" style="font-size:13px">Saldo pendiente</div><div class="num" style="font:800 19px Montserrat,sans-serif">${C(r.saldo)}</div></div>
        <div><div class="muted" style="font-size:13px">Para ponerse al día</div><div class="num" style="font:800 19px Montserrat,sans-serif;color:var(--gold-lt)">${C(r.ponerse)}</div></div>
        <div><div class="muted" style="font-size:13px">Cuota ${FREQ[c.frecuencia].toLowerCase()}</div><div style="font-weight:700">${C(vc)}</div></div>
        <div><div class="muted" style="font-size:13px">Atraso</div><div style="font-weight:700">${r.dias_atraso ? `${r.dias_atraso} días · ${r.cuotas_vencidas} cuota${plural(r.cuotas_vencidas)}` : 'Al día'}</div></div></div>
      <form class="f" data-form="pago" data-id="${id}">
        <p><label for="f_monto">Monto recibido (C$)</label><input class="inp inp-xl" id="f_monto" name="monto" type="number" step="0.01" min="0.01" inputmode="decimal" required value="${(ini / 100).toFixed(2)}"></p>
        <div class="chips" role="group" aria-label="Montos rápidos">${ops.map(([l, v]) => `<button type="button" class="chip" data-v="${(v / 100).toFixed(2)}">${l} · ${money(v)}</button>`).join('')}</div>
        <div class="card" style="margin:16px 0" aria-live="polite"><div style="font:700 13px 'Source Sans 3',sans-serif;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">Resultado del pago</div><div id="res" style="font-weight:600">—</div><div class="muted" style="font-size:13px;margin-top:6px">Se aplica a la cuota más antigua: primero interés y luego capital.</div></div>
        <div class="fgrid">${field('fecha', 'Fecha', today(), 'date', 'required')}${field('nota', 'Nota', '', 'text', 'placeholder="Opcional" maxlength="200"')}</div>
        <button class="btn gold" style="width:100%;min-height:56px;font-size:18px">Confirmar y ver recibo</button>
        <p style="text-align:center"><a href="#/credito/${id}">Cancelar</a></p></form></div>`, esGestor() ? 'ruta' : 'creditos');
  }
  function bindPago(id) {
    const c = cred(id), hoy = today(), cuotas = c.cuotas.filter(q => !q.pagada).map(q => ({ f: q.fecha, p: qPend(q) }));
    const inp = document.getElementById('f_monto'), out = document.getElementById('res');
    function calc() {
      const m = toCents(inp.value) || 0; let resto = m, comp = 0, adel = 0, venc = 0;
      for (let i = 0; i < cuotas.length; i++) {
        const q = cuotas[i];
        if (resto >= q.p) { resto -= q.p; comp++; if (q.f > hoy) adel++; }
        else { for (let j = i; j < cuotas.length; j++) if (cuotas[j].f <= hoy) venc++; break; }
      }
      if (m <= 0) { out.textContent = 'Ingrese el monto recibido.'; return; }
      let t;
      if (comp === cuotas.length) t = 'Cancela el crédito por completo.' + (resto > 0 ? ' Sobran ' + C(resto) + ' para devolver.' : '');
      else if (venc === 0) t = 'Queda al día' + (adel ? ' y adelanta ' + adel + ' cuota' + plural(adel) : '') + '.';
      else t = 'Abono parcial: quedan ' + venc + ' cuota' + plural(venc) + ' por ponerse al día.';
      out.textContent = comp + ' cuota' + plural(comp) + ' completa' + plural(comp) + '. ' + t;
    }
    document.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      inp.value = b.dataset.v; document.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); calc();
    }));
    inp.addEventListener('input', calc); calc();
  }

  function vRecibo(id) {
    const p = S.pagos.find(x => x.id === id); const c = p && creditosVisibles().find(x => x.id === p.credito_id);
    if (!c) return vNoEncontrado();
    const k = cli(c.cliente_id), r = resumen(c);
    const situacion = r.saldo === 0 ? 'Crédito cancelado' : r.dias_atraso ? `${r.cuotas_vencidas} cuota${plural(r.cuotas_vencidas)} atrasada${plural(r.cuotas_vencidas)}` : 'Al día';
    const txt = `${EMPRESA} · Recibo ${p.recibo}\n${fdate(p.fecha)} · ${nombre(k)}\nCrédito ${c.numero}\nTotal recibido: ${C(p.monto)}\nSaldo pendiente: ${C(r.saldo)}\nSituación: ${situacion}\nGracias por su pago.`;
    const fila = (a, b, st = '') => `<tr><td>${a}</td><td class="n" ${st}>${b}</td></tr>`;
    return shell(`<div class="card" style="max-width:400px;margin:auto">
      <div style="text-align:center"><img src="logo.png" alt="${EMPRESA}" style="width:170px;height:auto"></div>
      <div style="text-align:center;margin:8px 0 14px"><div class="eyebrow">Recibo de pago</div><div class="disp" style="font-size:20px;font-weight:800">${p.recibo}</div></div>
      <table>${fila('Fecha', fdate(p.fecha))}${fila('Cliente', esc(nombre(k)), 'style="white-space:normal"')}${fila('Crédito', c.numero)}${fila('Interés', money(p.ai))}${fila('Capital', money(p.ac))}
        ${p.sobrante ? fila('Sobrante devuelto', money(p.sobrante)) : ''}
        <tr><th style="font-size:15px;color:var(--navy)">Total recibido</th><th class="n" style="font-size:17px;color:var(--navy)">${C(p.monto)}</th></tr>
        ${fila('Cuotas completadas', p.completas + (p.adelantadas ? ` (${p.adelantadas} adelantada${plural(p.adelantadas)})` : ''))}
        ${fila('Saldo pendiente', '<strong>' + C(r.saldo) + '</strong>')}${fila('Situación', situacion)}${fila('Atendió', esc(p.usuario))}</table>
      <p class="muted" style="text-align:center;font-size:13px">Gracias por su pago puntual · ${LEMA}</p>
      <div class="actions noprint" style="justify-content:center"><button class="btn gold" data-act="print">Imprimir</button>
        <a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/${waLink(k.telefono)}?text=${encodeURIComponent(txt)}">WhatsApp</a>
        <a class="btn ghost" href="${esGestor() ? '#/ruta' : '#/credito/' + c.id}">Continuar</a></div></div>`, esGestor() ? 'ruta' : 'creditos');
  }

  function vReportes(q) {
    if (!puede('Gerente', 'Cajero')) return vSinPermiso();
    const desde = q.desde || today(), hasta = q.hasta || today();
    const pagos = S.pagos.filter(p => p.fecha >= desde && p.fecha <= hasta).sort((a, b) => b.id - a.id);
    const tot = pagos.reduce((s, p) => ({ m: s.m + p.monto, i: s.i + p.ai, c: s.c + p.ac }), { m: 0, i: 0, c: 0 });
    const porU = {}; pagos.forEach(p => { const u = porU[p.usuario] = porU[p.usuario] || { n: 0, t: 0 }; u.n++; u.t += p.monto; });
    const cg = {}; S.creditos.filter(c => c.estado === 'VIGENTE').forEach(c => { const r = resumen(c), g = cg[c.gestor || 'Sin gestor'] = cg[c.gestor || 'Sin gestor'] || { n: 0, s: 0, v: 0 }; g.n++; g.s += r.saldo; g.v += r.vencido; });
    const des = S.creditos.filter(c => c.fecha_desembolso >= desde && c.fecha_desembolso <= hasta), totD = des.reduce((s, c) => s + c.monto, 0);
    return shell(`${head('Reporte interno', 'Cobros y cartera', '<button class="btn ghost" data-act="print">Imprimir</button>', `Del ${fdate(desde)} al ${fdate(hasta)}`)}
      <form class="card actions noprint" data-form="reporte"><label>Desde <input class="inp" type="date" name="desde" value="${desde}" style="width:auto"></label><label>Hasta <input class="inp" type="date" name="hasta" value="${hasta}" style="width:auto"></label><button class="btn">Ver</button></form>
      <div class="grid">
        <div class="kpi dark"><div class="l">Total cobrado</div><div class="v">${C(tot.m)}</div><div class="s">${pagos.length} recibos</div></div>
        <div class="kpi"><div class="l">Interés cobrado</div><div class="v">${C(tot.i)}</div></div>
        <div class="kpi"><div class="l">Capital recuperado</div><div class="v">${C(tot.c)}</div></div>
        <div class="kpi"><div class="l">Desembolsado</div><div class="v">${C(totD)}</div><div class="s">${des.length} crédito${plural(des.length)}</div></div></div>
      <div class="split"><section class="main card"><h2>Recibos del período</h2><div class="tw"><table><thead><tr><th>Recibo</th><th>Fecha</th><th>Cliente</th><th class="n">Monto</th><th class="hide-m">Usuario</th></tr></thead><tbody>
        ${pagos.map(p => `<tr><td><a href="#/recibo/${p.id}">${p.recibo}</a></td><td>${fdate(p.fecha)}</td><td>${esc(nombre(cli(cred(p.credito_id).cliente_id)))}</td><td class="n">${money(p.monto)}</td><td class="hide-m">${esc(p.usuario)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin cobros en este período.</td></tr>'}
      </tbody></table></div></section><div class="side">
        <section class="card"><h2>Cobrado por usuario</h2>${Object.entries(porU).sort((a, b) => b[1].t - a[1].t).map(([u, d]) => `<div class="actions" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line-2)"><span>${esc(u)} <span class="muted">· ${d.n}</span></span><strong class="num">${C(d.t)}</strong></div>`).join('') || '<p class="muted" style="margin:0">—</p>'}</section>
        <section class="card"><h2>Cartera por gestor (hoy)</h2>${Object.entries(cg).map(([g, d]) => `<div style="padding:8px 0;border-top:1px solid var(--line-2)"><div class="actions" style="justify-content:space-between"><strong>${esc(g)}</strong><span class="num">${C(d.s)}</span></div><div class="muted" style="font-size:13px">${d.n} créditos · atraso ${C(d.v)}</div></div>`).join('') || '<p class="muted" style="margin:0">—</p>'}</section>
      </div></div>`, 'reportes');
  }

  function vBitacora() {
    if (!puede('Gerente')) return vSinPermiso();
    return shell(`${head('Auditoría', 'Bitácora', '<button class="btn bad" data-act="reset">Restablecer datos de demostración</button>')}
      <div class="card tw"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>
      ${S.bitacora.slice(0, 300).map(b => { const d = new Date(b.fecha); return `<tr><td>${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}</td><td>${esc(b.usuario)}</td><td>${esc(b.accion)}</td><td style="white-space:normal">${esc(b.detalle)}</td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">Sin registros todavía.</td></tr>'}
      </tbody></table></div>`, 'bitacora');
  }

  function vEstado(id) {
    const c = creditosVisibles().find(x => x.id === id); if (!c) return vNoEncontrado();
    const k = cli(c.cliente_id), hoy = today(), r = resumen(c, hoy), pagos = S.pagos.filter(p => p.credito_id === id).sort((a, b) => b.id - a.id).slice(0, 15);
    return shell(`<div class="actions noprint" style="margin-bottom:14px"><button class="btn gold" data-act="print">Imprimir o guardar PDF</button><a class="btn ghost" href="#/credito/${id}">Volver</a></div>
      <div class="card" style="max-width:900px;margin:auto">
        <div class="actions" style="justify-content:space-between;align-items:flex-end"><img src="logo.png" alt="${EMPRESA}" style="height:70px;width:auto"><div style="text-align:right"><div class="disp" style="font-size:20px;font-weight:800">ESTADO DE CUENTA</div><div class="eyebrow">Al ${fdate(hoy)}</div></div></div>
        <div style="height:3px;background:var(--gold);margin:10px 0 14px"></div>
        <div class="dl" style="margin-bottom:14px">
          <div><span>Cliente</span>${esc(nombre(k))} (${k.codigo})</div><div><span>Cédula</span>${esc(k.cedula)}</div><div><span>Teléfono</span>${esc(k.telefono)}</div>
          <div><span>Crédito</span>${c.numero}</div><div><span>Desembolso</span>${fdate(c.fecha_desembolso)} · ${C(c.monto)}</div>
          <div><span>Condiciones</span>${c.tasa_mensual} % mensual · ${c.plazo_meses} meses · ${c.numero_cuotas} cuotas ${FREQ[c.frecuencia].toLowerCase()}</div>
          ${c.fiador_nombre ? `<div style="grid-column:1/-1"><span>Fiador</span>${esc(c.fiador_nombre)} · ${esc(c.fiador_cedula)} · ${esc(c.fiador_telefono)}</div>` : ''}</div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          <div class="kpi"><div class="l">Cuota</div><div class="v" style="font-size:20px">${C(valorCuota(c))}</div></div>
          <div class="kpi"><div class="l">Total pagado</div><div class="v" style="font-size:20px">${C(r.pagado_total)}</div></div>
          <div class="kpi"><div class="l">Saldo pendiente</div><div class="v" style="font-size:20px">${C(r.saldo)}</div></div>
          <div class="kpi"><div class="l">Para ponerse al día</div><div class="v ${r.dias_atraso ? 'bad' : ''}" style="font-size:20px">${C(r.ponerse)}</div></div></div>
        <h2>Plan de pagos</h2><div class="tw"><table><thead><tr><th>#</th><th>Fecha</th><th class="n">Capital</th><th class="n">Interés</th><th class="n">Cuota</th><th class="n">Pagado</th><th class="n">Pendiente</th><th>Estado</th></tr></thead><tbody>
        ${c.cuotas.map(q => { const e = qEstado(q, hoy); return `<tr><td>${q.numero}</td><td>${fdate(q.fecha)}</td><td class="n">${money(q.capital)}</td><td class="n">${money(q.interes)}</td><td class="n">${money(qTotal(q))}</td><td class="n">${money(q.pc + q.pi)}</td><td class="n">${money(qPend(q))}</td><td><span class="pill ${e}">${e}</span></td></tr>`; }).join('')}
        </tbody></table></div>
        <h2 style="margin-top:18px">Últimos pagos</h2><div class="tw"><table><thead><tr><th>Recibo</th><th>Fecha</th><th class="n">Monto</th><th class="n">Interés</th><th class="n">Capital</th></tr></thead><tbody>
        ${pagos.map(p => `<tr><td>${p.recibo}</td><td>${fdate(p.fecha)}</td><td class="n">${money(p.monto)}</td><td class="n">${money(p.ai)}</td><td class="n">${money(p.ac)}</td></tr>`).join('') || '<tr><td colspan="5">Sin pagos registrados.</td></tr>'}
        </tbody></table></div>
        <div style="display:flex;gap:10%;margin-top:70px"><div style="flex:1;border-top:1px solid var(--ink);text-align:center;padding-top:4px">Firma del cliente</div><div style="flex:1;border-top:1px solid var(--ink);text-align:center;padding-top:4px">${EMPRESA}</div></div>
        <p class="muted" style="font-size:12px;margin-top:18px">${EMPRESA} · ${LEMA}. Documento informativo; para consultas comuníquese con su gestor.</p>
      </div>`, 'creditos');
  }

  const vNoEncontrado = () => shell('<div class="card"><h1>No encontrado</h1><p class="muted">El registro no existe o no tiene acceso a él.</p><a class="btn" href="#/">Ir al inicio</a></div>', '');
  const vSinPermiso = () => shell('<div class="card"><h1>Sin permiso</h1><p class="muted">Su rol no permite abrir esta pantalla.</p><a class="btn" href="#/">Ir al inicio</a></div>', '');

  // ---------------- Fotos ----------------
  function leerFoto(input, max = 900) {
    return new Promise(res => {
      const f = input && input.files && input.files[0]; if (!f) return res('');
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = () => res('');
        img.src = rd.result;
      };
      rd.onerror = () => res('');
      rd.readAsDataURL(f);
    });
  }

  // ---------------- Agenda .ics ----------------
  function descargarIcs() {
    const hoy = today(), fin = addDays(hoy, 14), vig = creditosVisibles().filter(c => c.estado === 'VIGENTE');
    const e = s => String(s).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
    const st = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kred Nova//ERP Cobros//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Visitas de cobro Kred Nova'];
    const ev = (uid, f, t, d, l) => L.push('BEGIN:VEVENT', `UID:${uid}@kred-nova`, `DTSTAMP:${st}`, `DTSTART;VALUE=DATE:${f.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(f, 1).replace(/-/g, '')}`, `SUMMARY:${e(t)}`, `DESCRIPTION:${e(d)}`, `LOCATION:${e(l)}`, 'END:VEVENT');
    vig.forEach(c => {
      const k = cli(c.cliente_id), lugar = k.direccion_negocio || k.direccion || '';
      c.cuotas.filter(q => !q.pagada && q.fecha >= hoy && q.fecha <= fin).forEach(q => ev(`c${c.id}-${q.numero}`, q.fecha, `Cobro: ${nombre(k)} (${C(qTotal(q))})`, `Crédito ${c.numero} · cuota ${q.numero} · Tel. ${k.telefono}`, lugar));
    });
    const ids = new Set(vig.map(c => c.id));
    S.visitas.filter(v => v.resultado === 'PROMESA' && v.fecha_promesa >= hoy && ids.has(v.credito_id)).forEach(v => {
      const c = cred(v.credito_id), k = cli(c.cliente_id);
      ev(`p${v.id}`, v.fecha_promesa, `Promesa de pago: ${nombre(k)}`, `Crédito ${c.numero} · ${v.nota} · Tel. ${k.telefono}`, k.direccion_negocio || k.direccion || '');
    });
    L.push('END:VCALENDAR');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([L.join('\r\n')], { type: 'text/calendar' }));
    a.download = 'visitas_kred_nova.ics'; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------------- Formularios ----------------
  const F = form => Object.fromEntries(new FormData(form).entries());
  const FORMS = {
    login(f) {
      const d = F(f), u = USUARIOS.find(x => x.u === d.u.trim().toLowerCase());
      if (!u || d.p !== CLAVE_DEMO) { flash('Usuario o contraseña incorrectos.', 'error'); return route(); }
      MEM_USER = u.u; store.set(UKEY, u.u); go('#/');
    },
    buscar(f) { const d = F(f); go(`#/clientes?q=${encodeURIComponent(d.q)}&estado=${d.estado}`); },
    filtro(f) { const d = F(f); go(`#/creditos?estado=${d.estado}${d.atraso ? '&atraso=1' : ''}`); },
    reporte(f) { const d = F(f); go(`#/reportes?desde=${d.desde}&hasta=${d.hasta}`); },
    async cliente(f) {
      const d = F(f), id = Number(f.dataset.id) || null;
      const dup = S.clientes.find(c => c.cedula.trim() === d.cedula.trim() && c.id !== id);
      if (dup) { flash('Ya existe un cliente con esa cédula: ' + dup.codigo, 'error'); return; }
      const foto = await leerFoto(f.querySelector('[name=foto]'));
      const datos = { nombres: d.nombres.trim(), apellidos: d.apellidos.trim(), cedula: d.cedula.trim(), telefono: d.telefono.trim(), email: d.email.trim(), negocio: d.negocio.trim(), direccion: d.direccion.trim(), direccion_negocio: d.direccion_negocio.trim() };
      if (foto) datos.foto_cedula = foto;
      let c;
      if (id) { c = Object.assign(cli(id), datos); bit('Cliente editado', c.codigo + ' · ' + nombre(c)); }
      else { c = crearCliente(datos); bit('Cliente creado', c.codigo + ' · ' + nombre(c)); }
      if (save()) flash(`Cliente ${c.codigo} guardado.`);
      go('#/cliente/' + c.id);
    },
    credito(f, accion) {
      const d = F(f), cid = Number(f.dataset.id);
      const cr = { cliente_id: cid, monto: toCents(d.monto), tasa_mensual: parseFloat(d.tasa_mensual), plazo_meses: parseInt(d.plazo_meses, 10), frecuencia: d.frecuencia, numero_cuotas: parseInt(d.numero_cuotas, 10) || 0, fecha_desembolso: d.fecha_desembolso, destino: d.destino, gestor: d.gestor, fiador_nombre: d.fiador_nombre, fiador_cedula: d.fiador_cedula, fiador_telefono: d.fiador_telefono, fiador_direccion: d.fiador_direccion };
      if (!(cr.monto > 0) || !(cr.tasa_mensual >= 0) || !(cr.plazo_meses >= 1) || !cr.fecha_desembolso) { alert('Revise monto, tasa, plazo y fecha.'); return; }
      if (accion === 'confirmar') {
        if (!confirm('¿Confirmar el desembolso de este crédito?')) return;
        const n = crearCredito(cr); bit('Crédito desembolsado', `${n.numero} ${C(n.monto)}`);
        if (save()) flash(`Crédito ${n.numero} creado con ${n.numero_cuotas} cuotas de ${C(valorCuota(n))}.`);
        return go('#/credito/' + n.id);
      }
      cr.numero_cuotas = nCuotas(cr);
      const plan = calcularPlan(cr), I = interesTotal(cr);
      document.getElementById('plan').innerHTML = `<div class="grid">
        <div class="kpi dark"><div class="l">Cuota</div><div class="v">${C(valorCuota(cr))}</div><div class="s">${plan.length} cuotas</div></div>
        <div class="kpi"><div class="l">Interés total</div><div class="v">${C(I)}</div></div>
        <div class="kpi"><div class="l">Total a pagar</div><div class="v">${C(cr.monto + I)}</div><div class="s">Última cuota: ${fdate(plan[plan.length - 1].fecha)}</div></div></div>
        <section class="card"><h2>Plan de pagos</h2><div class="tw" style="max-height:420px;overflow:auto"><table><thead><tr><th>#</th><th>Fecha</th><th class="n">Capital</th><th class="n">Interés</th><th class="n">Cuota</th></tr></thead><tbody>
        ${plan.map(p => `<tr><td>${p.numero}</td><td>${fdateD(p.fecha)}</td><td class="n">${money(p.capital)}</td><td class="n">${money(p.interes)}</td><td class="n"><strong>${money(qTotal(p))}</strong></td></tr>`).join('')}</tbody></table></div></section>`;
      document.getElementById('btnConfirmar').disabled = false;
      document.getElementById('plan').scrollIntoView({ behavior: 'smooth' });
    },
    async garantia(f) {
      const d = F(f), id = Number(f.dataset.id);
      const foto = await leerFoto(f.querySelector('[name=foto]'));
      S.garantias.push({ id: nextId('garantia'), credito_id: id, descripcion: d.descripcion.trim(), valor: toCents(d.valor) || 0, foto });
      bit('Garantía agregada', cred(id).numero + ': ' + d.descripcion);
      if (save()) flash('Garantía agregada.');
      route();
    },
    pago(f) {
      const d = F(f), c = cred(Number(f.dataset.id));
      try {
        const p = aplicarPago(c, toCents(d.monto), me().u, d.fecha, d.nota);
        if (esGestor()) S.visitas.push({ id: nextId('visita'), credito_id: c.id, gestor: me().u, fecha: p.fecha, resultado: 'COBRADO', fecha_promesa: '', nota: '', pago_id: p.id, creado: ahora() });
        bit('Pago registrado', `${p.recibo} ${c.numero} ${C(p.monto)}`);
        save(); go('#/recibo/' + p.id);
      } catch (e) { flash(e.message, 'error'); route(); }
    },
    visita(f) {
      const d = F(f), c = cred(Number(f.dataset.id));
      S.visitas.push({ id: nextId('visita'), credito_id: c.id, gestor: me().u, fecha: today(), resultado: d.resultado, fecha_promesa: d.resultado === 'PROMESA' ? d.fecha_promesa : '', nota: d.nota, creado: ahora() });
      bit('Visita registrada', `${c.numero}: ${RESULTADOS[d.resultado]}`);
      if (save()) flash(`Visita a ${nombre(cli(c.cliente_id))} registrada.`);
      go('#/ruta');
    },
    inactivar(f) {
      const d = F(f), c = cli(Number(f.dataset.id));
      if (!puedeInactivarse(c)) { flash('El cliente tiene créditos vigentes.', 'error'); return route(); }
      if (!confirm('¿Inactivar a este cliente?')) return;
      const motivo = d.motivo + (d.detalle ? ': ' + d.detalle : '');
      Object.assign(c, { estado: 'INACTIVO', fecha_inactivo: today(), motivo_inactivo: motivo });
      bit('Cliente inactivado', c.codigo + ' - ' + motivo);
      if (save()) flash('Cliente inactivado. Su historial se conserva.');
      route();
    }
  };
  const ACTS = {
    logout() { MEM_USER = null; store.del(UKEY); go('#/'); },
    print() { window.print(); },
    ics() { descargarIcs(); },
    reactivar(el) { const c = cli(Number(el.dataset.id)); Object.assign(c, { estado: 'ACTIVO', fecha_inactivo: '', motivo_inactivo: '' }); bit('Cliente reactivado', c.codigo); if (save()) flash('Cliente reactivado.'); route(); },
    incobrable(el) {
      const c = cred(Number(el.dataset.id));
      if (!confirm('¿Declarar este crédito como incobrable?')) return;
      c.estado = 'CASTIGADO'; bit('Crédito declarado incobrable', `${c.numero} saldo ${C(resumen(c).saldo)}`);
      if (save()) flash(`Crédito ${c.numero} pasó a cartera incobrable.`, 'warning'); route();
    },
    reset() {
      if (!confirm('Se borrarán todos los datos de este navegador y se cargarán los de demostración. ¿Continuar?')) return;
      seed(); save(); flash('Datos de demostración restablecidos.'); go('#/');
    }
  };

  // ---------------- Enrutador ----------------
  let lastHash = null;
  function go(h) { if (location.hash === h) route(); else location.hash = h; return null; }
  function route() {
    const app = document.getElementById('app');
    const h = location.hash.slice(1) || '/', [path, qs] = h.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs || '')), p = path.split('/').filter(Boolean), n = Number(p[1]);
    let html;
    if (!me()) html = vLogin();
    else {
      switch (p[0]) {
        case undefined: html = vPanel(); break;
        case 'ruta': html = vRuta(q); break;
        case 'visita': html = vVisita(n); break;
        case 'clientes': html = vClientes(q); break;
        case 'cliente':
          if (p[1] === 'nuevo') html = vClienteForm(null);
          else if (p[2] === 'editar') html = vClienteForm(n);
          else html = vClienteDetalle(n);
          break;
        case 'credito': html = p[1] === 'nuevo' ? vCreditoNuevo(Number(p[2])) : vCredito(n); break;
        case 'creditos': html = vCreditos(q); break;
        case 'pagar': html = vPagar(n); break;
        case 'recibo': html = vRecibo(n); break;
        case 'reportes': html = vReportes(q); break;
        case 'bitacora': html = vBitacora(); break;
        case 'estado': html = vEstado(n); break;
        default: html = vNoEncontrado();
      }
    }
    if (html == null) return;   // la vista redirigió
    app.innerHTML = html;
    if (lastHash !== h) { window.scrollTo(0, 0); lastHash = h; }
    app.querySelectorAll('form[data-form]').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      const btn = e.submitter; FORMS[f.dataset.form](f, btn && btn.value);
    }));
    app.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); ACTS[el.dataset.act](el); }));
    const g = app.querySelector('[data-change=gestor]');
    if (g) g.addEventListener('change', () => go('#/ruta' + (g.value ? '?gestor=' + encodeURIComponent(g.value) : '')));
    if (p[0] === 'pagar' && document.getElementById('f_monto')) bindPago(n);
    document.title = (document.querySelector('h1') ? document.querySelector('h1').textContent.trim() + ' · ' : '') + EMPRESA;
  }

  load();
  window.addEventListener('hashchange', route);
  route();
})();
