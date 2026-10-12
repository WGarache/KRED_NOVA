import json
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied
from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render

from . import servicios
from .forms import ClienteForm, CreditoForm, GarantiaForm, InactivarForm, PagoForm, VisitaForm
from .models import CERO, Bitacora, Cliente, Credito, Cuota, Pago, Visita

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre",
         "octubre", "noviembre", "diciembre"]


def fecha_larga(d):
    return f"{DIAS[d.weekday()].capitalize()} {d.day} de {MESES[d.month - 1]}, {d.year}"


# ---------- Roles ----------
# Administrador / Gerente: todo. Cajero: clientes, créditos y pagos. Gestor: solo su cartera.

def rol(user):
    if not user.is_authenticated:
        return ""
    if user.is_superuser:
        return "Administrador"
    g = set(user.groups.values_list("name", flat=True))
    for r in ("Administrador", "Gerente", "Cajero", "Gestor"):
        if r in g:
            return r
    return "Consulta"


def marca(request):
    """Contexto disponible en todas las plantillas."""
    return {"empresa": settings.EMPRESA_NOMBRE, "lema": settings.EMPRESA_LEMA,
            "rol": rol(request.user) if hasattr(request, "user") else ""}


def requiere(*roles):
    def deco(fn):
        @login_required
        def wrap(request, *a, **kw):
            if rol(request.user) not in roles + ("Administrador",):
                raise PermissionDenied
            return fn(request, *a, **kw)
        return wrap
    return deco


def es_gestor(user):
    return rol(user) == "Gestor"


def creditos_visibles(user):
    qs = Credito.objects.select_related("cliente", "gestor")
    return qs.filter(gestor=user) if es_gestor(user) else qs


def clientes_visibles(user):
    qs = Cliente.objects.all()
    return qs.filter(creditos__gestor=user).distinct() if es_gestor(user) else qs


# ---------- Panel ----------
@login_required
def dashboard(request):
    if es_gestor(request.user):
        return redirect("ruta")
    hoy = date.today()
    vigentes = creditos_visibles(request.user).filter(estado="VIGENTE").prefetch_related("cuotas", "pagos")
    cartera = vencido = por_cobrar_hoy = CERO
    tramos = defaultdict(lambda: {"n": 0, "saldo": CERO})
    en_atraso = []
    for c in vigentes:
        r = c.resumen(hoy)
        cartera += r["saldo"]
        vencido += r["vencido"]
        por_cobrar_hoy += r["para_ponerse_al_dia"]
        if r["dias_atraso"]:
            t = tramos[Credito.tramo_atraso(r["dias_atraso"])]
            t["n"] += 1
            t["saldo"] += r["vencido"]
            en_atraso.append((c, r))
    en_atraso.sort(key=lambda x: -x[1]["dias_atraso"])
    pagos_hoy = Pago.objects.filter(fecha=hoy, credito__in=creditos_visibles(request.user))
    recaudado = pagos_hoy.aggregate(s=Sum("monto"))["s"] or CERO
    meta = por_cobrar_hoy + recaudado  # lo exigible hoy antes de cobrar
    max_tramo = max([t["saldo"] for t in tramos.values()] + [Decimal("1")])
    orden = ["1–7 días", "8–30 días", "31–60 días", "+60 días"]
    tabla_tramos = [{"label": o, "n": tramos[o]["n"], "saldo": tramos[o]["saldo"],
                     "pct": int(tramos[o]["saldo"] / max_tramo * 100), "clase": f"t{i}"}
                    for i, o in enumerate(orden)]
    por_gestor = (Pago.objects.filter(fecha=hoy).values("usuario__username")
                  .annotate(total=Sum("monto"), n=Count("id")).order_by("-total"))
    visitas_hoy = Visita.objects.filter(fecha=hoy).select_related("credito__cliente", "gestor")[:8]
    return render(request, "cartera/dashboard.html", {
        "hoy_txt": fecha_larga(hoy), "cartera": cartera, "n_creditos": len(vigentes), "vencido": vencido,
        "n_atraso": len(en_atraso), "indice": (vencido / cartera * 100) if cartera else 0,
        "meta": meta, "recaudado": recaudado, "avance": int(recaudado / meta * 100) if meta else 0,
        "en_atraso": en_atraso[:10], "tabla_tramos": tabla_tramos, "por_gestor": por_gestor,
        "visitas_hoy": visitas_hoy,
    })


# ---------- Ruta del gestor ----------
@login_required
def ruta(request):
    hoy = date.today()
    gestor_id = request.GET.get("gestor")
    qs = creditos_visibles(request.user).filter(estado="VIGENTE").prefetch_related("cuotas", "pagos")
    if gestor_id and not es_gestor(request.user):
        qs = qs.filter(gestor_id=gestor_id)
    visitas_hoy = {v.credito_id: v for v in Visita.objects.filter(fecha=hoy, credito__in=qs).order_by("creado")}
    promesas = set(Visita.objects.filter(resultado="PROMESA", fecha_promesa=hoy, credito__in=qs)
                   .values_list("credito_id", flat=True))
    pagados_hoy = defaultdict(lambda: CERO)
    for p in Pago.objects.filter(fecha=hoy, credito__in=qs):
        pagados_hoy[p.credito_id] += p.monto
    items, meta, cobrado = [], CERO, CERO
    for c in qs:
        r = c.resumen(hoy)
        pagado = pagados_hoy.get(c.id, CERO)
        if r["para_ponerse_al_dia"] <= 0 and not pagado and c.id not in promesas:
            continue
        v = visitas_hoy.get(c.id)
        if pagado:
            estado, clase = "Cobrado", "ok"
        elif v:
            estado, clase = v.get_resultado_display(), "warn"
        elif r["dias_atraso"]:
            estado, clase = f"{r['dias_atraso']} días", "bad"
        else:
            estado, clase = "Hoy", "info"
        meta += r["para_ponerse_al_dia"] + pagado
        cobrado += pagado
        items.append({"c": c, "r": r, "pagado": pagado, "estado": estado, "clase": clase,
                      "pendiente": not pagado, "promesa": c.id in promesas,
                      "orden": (bool(pagado), -r["dias_atraso"])})
    items.sort(key=lambda i: i["orden"])
    from django.contrib.auth.models import User
    return render(request, "cartera/ruta.html", {
        "items": items, "hoy_txt": fecha_larga(hoy), "meta": meta, "cobrado": cobrado,
        "avance": int(cobrado / meta * 100) if meta else 0,
        "hechas": sum(1 for i in items if not i["pendiente"] or i["c"].id in visitas_hoy),
        "gestores": [] if es_gestor(request.user) else User.objects.filter(cartera__estado="VIGENTE").distinct(),
        "gestor_id": gestor_id, "visita_form": VisitaForm(),
    })


@login_required
def visita_registrar(request, pk):
    cr = get_object_or_404(creditos_visibles(request.user), pk=pk)
    form = VisitaForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        v = form.save(commit=False)
        v.credito, v.gestor = cr, request.user
        v.save()
        Bitacora.log(request.user, "Visita registrada", f"{cr.numero}: {v.get_resultado_display()}")
        messages.success(request, f"Visita a {cr.cliente.nombre_completo} registrada.")
        return redirect("ruta")
    return render(request, "cartera/visita.html", {"form": form, "c": cr})


# ---------- Clientes ----------
@login_required
def clientes(request):
    q = request.GET.get("q", "").strip()
    estado = request.GET.get("estado", "ACTIVO")
    qs = clientes_visibles(request.user)
    if estado:
        qs = qs.filter(estado=estado)
    if q:
        qs = qs.filter(Q(nombres__icontains=q) | Q(apellidos__icontains=q) | Q(cedula__icontains=q)
                       | Q(codigo__icontains=q) | Q(telefono__icontains=q) | Q(negocio__icontains=q))
    return render(request, "cartera/clientes.html", {"clientes": qs[:300], "q": q, "estado": estado})


@requiere("Gerente", "Cajero")
def cliente_form(request, pk=None):
    obj = get_object_or_404(Cliente, pk=pk) if pk else None
    form = ClienteForm(request.POST or None, request.FILES or None, instance=obj)
    if form.is_valid():
        c = form.save()
        Bitacora.log(request.user, "Cliente editado" if pk else "Cliente creado", str(c))
        messages.success(request, f"Cliente {c.codigo} guardado.")
        return redirect("cliente_detalle", c.pk)
    return render(request, "cartera/form.html", {
        "form": form, "titulo": "Editar cliente" if pk else "Nuevo cliente", "multipart": True})


@login_required
def cliente_detalle(request, pk):
    c = get_object_or_404(Cliente, pk=pk)
    if es_gestor(request.user) and not c.creditos.filter(gestor=request.user).exists():
        raise PermissionDenied
    return render(request, "cartera/cliente_detalle.html", {
        "c": c, "creditos": [(cr, cr.resumen()) for cr in c.creditos.all()], "inactivar_form": InactivarForm()})


@requiere("Gerente")
def cliente_inactivar(request, pk):
    c = get_object_or_404(Cliente, pk=pk)
    form = InactivarForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        motivo = form.cleaned_data["motivo"]
        if form.cleaned_data["detalle"]:
            motivo += f": {form.cleaned_data['detalle']}"
        try:
            c.inactivar(motivo)
            Bitacora.log(request.user, "Cliente inactivado", f"{c} - {motivo}")
            messages.success(request, "Cliente inactivado. Su historial se conserva.")
        except ValueError as e:
            messages.error(request, str(e))
    return redirect("cliente_detalle", pk)


@requiere("Gerente")
def cliente_reactivar(request, pk):
    c = get_object_or_404(Cliente, pk=pk)
    if request.method == "POST":
        c.reactivar()
        Bitacora.log(request.user, "Cliente reactivado", str(c))
        messages.success(request, "Cliente reactivado.")
    return redirect("cliente_detalle", pk)


# ---------- Créditos ----------
@requiere("Gerente", "Cajero")
def credito_nuevo(request, cliente_pk):
    cliente = get_object_or_404(Cliente, pk=cliente_pk)
    if cliente.estado != "ACTIVO":
        messages.error(request, "Solo clientes activos pueden recibir créditos.")
        return redirect("cliente_detalle", cliente.pk)
    form = CreditoForm(request.POST or None, initial={"gestor": request.user, "fecha_desembolso": date.today()})
    plan = None
    if form.is_valid():
        cr = form.save(commit=False)
        cr.cliente = cliente
        if "confirmar" in request.POST:
            cr.save()
            cr.generar_cuotas()
            Bitacora.log(request.user, "Crédito desembolsado", f"{cr.numero} C${cr.monto}")
            messages.success(request, f"Crédito {cr.numero} creado con {cr.numero_cuotas} cuotas de C$ {cr.valor_cuota:,.2f}.")
            return redirect("credito_detalle", cr.pk)
        cuotas = cr.calcular_plan()
        plan = {"cuotas": cuotas, "interes": cr.interes_total, "total": cr.total_a_pagar, "cuota": cr.valor_cuota,
                "n": cr.numero_cuotas, "ultima": cuotas[-1]["fecha"] if cuotas else None}
    return render(request, "cartera/credito_nuevo.html", {"form": form, "cliente": cliente, "plan": plan})


@login_required
def creditos(request):
    estado = request.GET.get("estado", "VIGENTE")
    qs = creditos_visibles(request.user).prefetch_related("cuotas", "pagos")
    if estado:
        qs = qs.filter(estado=estado)
    filas = [(c, c.resumen()) for c in qs[:400]]
    solo_atraso = request.GET.get("atraso") == "1"
    if solo_atraso:
        filas = sorted([f for f in filas if f[1]["dias_atraso"]], key=lambda f: -f[1]["dias_atraso"])
    return render(request, "cartera/creditos.html", {"filas": filas, "estado": estado, "solo_atraso": solo_atraso})


@login_required
def credito_detalle(request, pk):
    cr = get_object_or_404(creditos_visibles(request.user), pk=pk)
    ctx = servicios.contexto_estado_cuenta(cr)
    ctx.update({"garantia_form": GarantiaForm(), "visitas": cr.visitas.select_related("gestor")[:10]})
    return render(request, "cartera/credito_detalle.html", ctx)


@requiere("Gerente", "Cajero")
def garantia_agregar(request, pk):
    cr = get_object_or_404(Credito, pk=pk)
    form = GarantiaForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        g = form.save(commit=False)
        g.credito = cr
        g.save()
        Bitacora.log(request.user, "Garantía agregada", f"{cr.numero}: {g.descripcion}")
        messages.success(request, "Garantía agregada.")
    elif request.method == "POST":
        messages.error(request, "Revise los datos de la garantía.")
    return redirect("credito_detalle", pk)


@requiere("Gerente")
def credito_incobrable(request, pk):
    cr = get_object_or_404(Credito, pk=pk)
    if request.method == "POST" and cr.estado == "VIGENTE":
        cr.estado = "CASTIGADO"
        cr.save(update_fields=["estado"])
        Bitacora.log(request.user, "Crédito declarado incobrable", f"{cr.numero} saldo {cr.resumen()['saldo']}")
        messages.warning(request, f"Crédito {cr.numero} pasó a cartera incobrable.")
    return redirect("credito_detalle", pk)


# ---------- Pagos ----------
@requiere("Gerente", "Cajero", "Gestor")
def pagar(request, pk):
    cr = get_object_or_404(creditos_visibles(request.user), pk=pk)
    if cr.estado != "VIGENTE":
        messages.error(request, "El crédito no está vigente.")
        return redirect("credito_detalle", pk)
    hoy = date.today()
    r = cr.resumen(hoy)
    form = PagoForm(request.POST or None, initial={"fecha": hoy, "monto": r["para_ponerse_al_dia"] or cr.valor_cuota})
    if request.method == "POST" and form.is_valid():
        p = cr.aplicar_pago(form.cleaned_data["monto"], request.user, form.cleaned_data["fecha"],
                            form.cleaned_data["nota"])
        if es_gestor(request.user):
            Visita.objects.create(credito=cr, gestor=request.user, fecha=p.fecha, resultado="COBRADO", pago=p)
        Bitacora.log(request.user, "Pago registrado", f"{p.recibo} {cr.numero} C${p.monto}")
        return redirect("recibo", p.pk)
    pendientes = [{"f": q.fecha_vencimiento.isoformat(), "p": float(q.pendiente)}
                  for q in cr.cuotas.filter(pagada=False)]
    opciones = [("Una cuota", cr.valor_cuota)]
    if r["para_ponerse_al_dia"] and r["para_ponerse_al_dia"] != cr.valor_cuota:
        opciones.append(("Ponerse al día", r["para_ponerse_al_dia"]))
    opciones.append(("Cancelar todo", r["saldo"]))
    return render(request, "cartera/pagar.html", {
        "c": cr, "r": r, "form": form, "opciones": opciones,
        "pendientes_json": json.dumps(pendientes), "hoy_iso": hoy.isoformat()})


@login_required
def recibo(request, pk):
    p = get_object_or_404(Pago.objects.select_related("credito__cliente", "usuario"),
                          pk=pk, credito__in=creditos_visibles(request.user))
    return render(request, "cartera/recibo.html", {"p": p, "r": p.credito.resumen()})


# ---------- Reportes ----------
@requiere("Gerente", "Cajero")
def reportes(request):
    hoy = date.today()
    try:
        desde = date.fromisoformat(request.GET.get("desde", ""))
    except ValueError:
        desde = hoy
    try:
        hasta = date.fromisoformat(request.GET.get("hasta", ""))
    except ValueError:
        hasta = hoy
    pagos = Pago.objects.filter(fecha__range=(desde, hasta)).select_related("credito__cliente", "usuario")
    tot = pagos.aggregate(m=Sum("monto"), i=Sum("aplicado_interes"), c=Sum("aplicado_capital"))
    por_usuario = pagos.values("usuario__username").annotate(total=Sum("monto"), n=Count("id")).order_by("-total")
    cartera_gestor = defaultdict(lambda: {"n": 0, "saldo": CERO, "vencido": CERO})
    for c in Credito.objects.filter(estado="VIGENTE").select_related("gestor").prefetch_related("cuotas", "pagos"):
        r = c.resumen(hoy)
        g = cartera_gestor[c.gestor.username if c.gestor else "Sin gestor"]
        g["n"] += 1
        g["saldo"] += r["saldo"]
        g["vencido"] += r["vencido"]
    desembolsos = Credito.objects.filter(fecha_desembolso__range=(desde, hasta))
    return render(request, "cartera/reportes.html", {
        "desde": desde, "hasta": hasta, "pagos": pagos, "tot": tot, "por_usuario": por_usuario,
        "cartera_gestor": dict(cartera_gestor), "desembolsos": desembolsos,
        "tot_desembolsos": desembolsos.aggregate(s=Sum("monto"))["s"] or CERO})


# ---------- Estado de cuenta, correo y calendario ----------
@login_required
def estado_cuenta_pdf(request, pk):
    cr = get_object_or_404(creditos_visibles(request.user), pk=pk)
    resp = HttpResponse(servicios.estado_cuenta_pdf(cr), content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="estado_{cr.numero}.pdf"'
    return resp


@login_required
def estado_cuenta_enviar(request, pk):
    cr = get_object_or_404(creditos_visibles(request.user), pk=pk)
    if request.method == "POST":
        try:
            servicios.enviar_estado_cuenta(cr)
            Bitacora.log(request.user, "Estado de cuenta enviado", f"{cr.numero} -> {cr.cliente.email}")
            messages.success(request, f"Estado de cuenta enviado a {cr.cliente.email}.")
        except Exception as e:  # noqa: BLE001 - mostrar el error de correo al usuario
            messages.error(request, f"No se pudo enviar: {e}")
    return redirect("credito_detalle", pk)


@login_required
def agenda_ics(request):
    """Visitas de cobro de los próximos 14 días (cuotas por vencer y promesas de pago)."""
    hoy = date.today()
    vig = creditos_visibles(request.user).filter(estado="VIGENTE")
    eventos = []
    cuotas = (Cuota.objects.filter(credito__in=vig, pagada=False, fecha_vencimiento__range=(hoy, hoy + timedelta(days=14)))
              .select_related("credito__cliente"))
    for q in cuotas:
        cl = q.credito.cliente
        eventos.append({"uid": f"cuota-{q.id}", "fecha": q.fecha_vencimiento,
                        "titulo": f"Cobro: {cl.nombre_completo} (C$ {q.total:,.2f})",
                        "descripcion": f"Crédito {q.credito.numero} · cuota {q.numero} · Tel. {cl.telefono}",
                        "lugar": cl.direccion_negocio or cl.direccion})
    for v in Visita.objects.filter(credito__in=vig, resultado="PROMESA", fecha_promesa__gte=hoy).select_related("credito__cliente"):
        cl = v.credito.cliente
        eventos.append({"uid": f"promesa-{v.id}", "fecha": v.fecha_promesa,
                        "titulo": f"Promesa de pago: {cl.nombre_completo}",
                        "descripcion": f"Crédito {v.credito.numero} · {v.nota} · Tel. {cl.telefono}",
                        "lugar": cl.direccion_negocio or cl.direccion})
    resp = HttpResponse(servicios.calendario_ics(eventos), content_type="text/calendar")
    resp["Content-Disposition"] = 'attachment; filename="visitas_kred_nova.ics"'
    return resp


@requiere("Gerente")
def bitacora(request):
    return render(request, "cartera/bitacora.html",
                  {"registros": Bitacora.objects.select_related("usuario")[:300]})
