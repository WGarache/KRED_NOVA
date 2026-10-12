"""Modelo de datos — ERP de cobros Kred Nova (v0.2).

Reglas de negocio confirmadas:
- Créditos comerciales en córdobas, interés FLAT expresado como % MENSUAL.
- Interés total = monto × tasa mensual × plazo en meses, repartido en partes iguales entre las cuotas.
- Frecuencias: diaria (lunes a sábado), semanal y quincenal.
- No hay cargos por mora ni días de gracia.
- Pagos: se aplican a la cuota más antigua, primero interés y luego capital.
  Lo que sobra adelanta cuotas siguientes.
- Los clientes nunca se eliminan: se inactivan (solo si no tienen créditos vigentes).
"""
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import models, transaction

CENT = Decimal("0.01")
CERO = Decimal("0")


def r2(x):
    return Decimal(x).quantize(CENT, rounding=ROUND_HALF_UP)


def es_dia_de_cobro(d):
    if d.weekday() == 6 and not getattr(settings, "COBRAR_DOMINGOS", False):
        return False
    return d.isoformat() not in getattr(settings, "FERIADOS", [])


class Cliente(models.Model):
    ESTADOS = [("ACTIVO", "Activo"), ("INACTIVO", "Inactivo")]

    codigo = models.CharField(max_length=20, unique=True, editable=False)
    nombres = models.CharField(max_length=100)
    apellidos = models.CharField(max_length=100)
    cedula = models.CharField("Cédula", max_length=20, unique=True)
    telefono = models.CharField("Teléfono", max_length=20)
    email = models.EmailField("Correo", blank=True)
    direccion = models.TextField("Dirección", blank=True)
    negocio = models.CharField("Negocio / actividad", max_length=120, blank=True)
    direccion_negocio = models.CharField("Dirección del negocio", max_length=200, blank=True)
    foto_cedula = models.ImageField("Foto de cédula", upload_to="cedulas/", blank=True)
    estado = models.CharField(max_length=10, choices=ESTADOS, default="ACTIVO")
    fecha_inactivo = models.DateField(null=True, blank=True)
    motivo_inactivo = models.CharField(max_length=200, blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["apellidos", "nombres"]

    def __str__(self):
        return f"{self.codigo} · {self.nombre_completo}"

    @property
    def nombre_completo(self):
        return f"{self.nombres} {self.apellidos}"

    @property
    def iniciales(self):
        return (self.nombres[:1] + self.apellidos[:1]).upper()

    def save(self, *args, **kwargs):
        if not self.codigo:
            ultimo = Cliente.objects.order_by("-id").first()
            self.codigo = f"CL-{(ultimo.id + 1 if ultimo else 1):05d}"
        super().save(*args, **kwargs)

    def puede_inactivarse(self):
        return not self.creditos.filter(estado="VIGENTE").exists()

    def inactivar(self, motivo):
        if not self.puede_inactivarse():
            raise ValueError("El cliente tiene créditos vigentes.")
        self.estado, self.fecha_inactivo, self.motivo_inactivo = "INACTIVO", date.today(), motivo
        self.save()

    def reactivar(self):
        self.estado, self.fecha_inactivo, self.motivo_inactivo = "ACTIVO", None, ""
        self.save()


class Credito(models.Model):
    FRECUENCIAS = [("DIARIA", "Diaria (lun–sáb)"), ("SEMANAL", "Semanal"), ("QUINCENAL", "Quincenal")]
    CUOTAS_POR_MES = {"DIARIA": 26, "SEMANAL": 4, "QUINCENAL": 2}
    ESTADOS = [("VIGENTE", "Vigente"), ("CANCELADO", "Cancelado"), ("CASTIGADO", "Incobrable")]

    numero = models.CharField(max_length=20, unique=True, editable=False)
    cliente = models.ForeignKey(Cliente, on_delete=models.PROTECT, related_name="creditos")
    monto = models.DecimalField("Monto (C$)", max_digits=12, decimal_places=2)
    tasa_mensual = models.DecimalField("Tasa mensual %", max_digits=5, decimal_places=2)
    plazo_meses = models.PositiveIntegerField("Plazo (meses)")
    frecuencia = models.CharField(max_length=10, choices=FRECUENCIAS, default="DIARIA")
    numero_cuotas = models.PositiveIntegerField("Número de cuotas")
    fecha_desembolso = models.DateField(default=date.today)
    destino = models.CharField("Destino del crédito", max_length=150, blank=True)
    gestor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                               related_name="cartera")
    # Fiador
    fiador_nombre = models.CharField("Nombre del fiador", max_length=150, blank=True)
    fiador_cedula = models.CharField("Cédula del fiador", max_length=20, blank=True)
    fiador_telefono = models.CharField("Teléfono del fiador", max_length=20, blank=True)
    fiador_direccion = models.CharField("Dirección del fiador", max_length=200, blank=True)
    estado = models.CharField(max_length=10, choices=ESTADOS, default="VIGENTE")
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_desembolso", "-id"]

    def __str__(self):
        return f"{self.numero} ({self.cliente.nombre_completo})"

    def save(self, *args, **kwargs):
        if not self.numero:
            ultimo = Credito.objects.order_by("-id").first()
            self.numero = f"CR-{(ultimo.id + 1 if ultimo else 1):06d}"
        if not self.numero_cuotas:
            self.numero_cuotas = self.plazo_meses * self.CUOTAS_POR_MES[self.frecuencia]
        super().save(*args, **kwargs)

    # ---------- Plan de pagos ----------
    @property
    def interes_total(self):
        return r2(Decimal(self.monto) * Decimal(self.tasa_mensual) / 100 * self.plazo_meses)

    @property
    def total_a_pagar(self):
        return Decimal(self.monto) + self.interes_total

    @property
    def valor_cuota(self):
        n = self.numero_cuotas or self.plazo_meses * self.CUOTAS_POR_MES[self.frecuencia]
        return r2(Decimal(self.monto) / n) + r2(self.interes_total / n)

    def fechas_de_cuotas(self):
        fechas, d = [], self.fecha_desembolso
        while len(fechas) < self.numero_cuotas:
            if self.frecuencia == "DIARIA":
                d += timedelta(days=1)
                while not es_dia_de_cobro(d):
                    d += timedelta(days=1)
            else:
                d += timedelta(days=7 if self.frecuencia == "SEMANAL" else 15)
            fechas.append(d)
        return fechas

    def calcular_plan(self):
        n = self.numero_cuotas or self.plazo_meses * self.CUOTAS_POR_MES[self.frecuencia]
        self.numero_cuotas = n
        monto, interes = Decimal(self.monto), self.interes_total
        cap_c, int_c = r2(monto / n), r2(interes / n)
        plan, acum_cap, acum_int = [], CERO, CERO
        for k, f in enumerate(self.fechas_de_cuotas(), start=1):
            cap = monto - acum_cap if k == n else cap_c          # la última absorbe el redondeo
            inte = interes - acum_int if k == n else int_c
            acum_cap += cap
            acum_int += inte
            plan.append({"numero": k, "fecha": f, "capital": cap, "interes": inte, "total": cap + inte})
        return plan

    def generar_cuotas(self):
        self.cuotas.all().delete()
        Cuota.objects.bulk_create([
            Cuota(credito=self, numero=c["numero"], fecha_vencimiento=c["fecha"],
                  capital=c["capital"], interes=c["interes"]) for c in self.calcular_plan()
        ])

    # ---------- Saldos ----------
    def resumen(self, al=None):
        al = al or date.today()
        cuotas = list(self.cuotas.all())
        pend = [c for c in cuotas if not c.pagada]
        vencidas = [c for c in pend if c.fecha_vencimiento < al]
        exigibles = [c for c in pend if c.fecha_vencimiento <= al]
        return {
            "saldo": sum((c.pendiente for c in pend), CERO),
            "saldo_capital": sum((c.capital_pendiente for c in pend), CERO),
            "vencido": sum((c.pendiente for c in vencidas), CERO),
            "para_ponerse_al_dia": sum((c.pendiente for c in exigibles), CERO),
            "cuotas_vencidas": len(vencidas),
            "dias_atraso": max(((al - c.fecha_vencimiento).days for c in vencidas), default=0),
            "proxima_cuota": pend[0] if pend else None,
            "cuotas_pagadas": len(cuotas) - len(pend),
            "pagado_total": sum((p.monto for p in self.pagos.all()), CERO),
        }

    @staticmethod
    def tramo_atraso(dias):
        if dias == 0:
            return "Al día"
        if dias <= 7:
            return "1–7 días"
        if dias <= 30:
            return "8–30 días"
        if dias <= 60:
            return "31–60 días"
        return "+60 días"

    # ---------- Pagos ----------
    @transaction.atomic
    def aplicar_pago(self, monto, usuario=None, fecha=None, nota=""):
        """Aplica el pago a la cuota más antigua: interés y luego capital.
        Lo que sobra adelanta las cuotas siguientes."""
        fecha = fecha or date.today()
        restante = r2(monto)
        if restante <= 0:
            raise ValueError("El monto debe ser mayor que cero.")
        if self.estado != "VIGENTE":
            raise ValueError("El crédito no está vigente.")
        pago = Pago.objects.create(credito=self, monto=restante, fecha=fecha, usuario=usuario, nota=nota)
        tot_int = tot_cap = CERO
        completas = adelantadas = 0
        for c in self.cuotas.select_for_update().filter(pagada=False).order_by("numero"):
            if restante <= 0:
                break
            a_int = min(restante, c.interes_pendiente)
            c.pagado_interes += a_int
            restante -= a_int
            a_cap = min(restante, c.capital_pendiente)
            c.pagado_capital += a_cap
            restante -= a_cap
            tot_int += a_int
            tot_cap += a_cap
            if c.pendiente <= 0:
                c.pagada, c.fecha_pago = True, fecha
                completas += 1
                adelantadas += c.fecha_vencimiento > fecha
            c.save()
        pago.aplicado_interes, pago.aplicado_capital = tot_int, tot_cap
        pago.cuotas_completadas, pago.sobrante = completas, restante
        pago.adelantadas = adelantadas
        pago.save()
        if not self.cuotas.filter(pagada=False).exists():
            self.estado = "CANCELADO"
            self.save(update_fields=["estado"])
        return pago


class Cuota(models.Model):
    credito = models.ForeignKey(Credito, on_delete=models.CASCADE, related_name="cuotas")
    numero = models.PositiveIntegerField()
    fecha_vencimiento = models.DateField()
    capital = models.DecimalField(max_digits=12, decimal_places=2)
    interes = models.DecimalField(max_digits=12, decimal_places=2)
    pagado_capital = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pagado_interes = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pagada = models.BooleanField(default=False)
    fecha_pago = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["numero"]
        unique_together = [("credito", "numero")]

    @property
    def total(self):
        return self.capital + self.interes

    @property
    def pagado(self):
        return self.pagado_capital + self.pagado_interes

    @property
    def capital_pendiente(self):
        return max(self.capital - self.pagado_capital, CERO)

    @property
    def interes_pendiente(self):
        return max(self.interes - self.pagado_interes, CERO)

    @property
    def pendiente(self):
        return self.capital_pendiente + self.interes_pendiente

    def estado(self, al=None):
        al = al or date.today()
        if self.pagada:
            return "Pagada"
        if self.fecha_vencimiento < al:
            return "Atrasada"
        if self.fecha_vencimiento == al:
            return "Hoy"
        if self.pagado:
            return "Abonada"
        return "Pendiente"


class Pago(models.Model):
    recibo = models.CharField(max_length=20, unique=True, editable=False)
    credito = models.ForeignKey(Credito, on_delete=models.PROTECT, related_name="pagos")
    fecha = models.DateField(default=date.today)
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    aplicado_interes = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    aplicado_capital = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cuotas_completadas = models.PositiveIntegerField(default=0)
    adelantadas = models.PositiveIntegerField(default=0)
    sobrante = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    nota = models.CharField(max_length=200, blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]

    def save(self, *args, **kwargs):
        if not self.recibo:
            ultimo = Pago.objects.order_by("-id").first()
            self.recibo = f"RC-{(ultimo.id + 1 if ultimo else 1):07d}"
        super().save(*args, **kwargs)


class Garantia(models.Model):
    credito = models.ForeignKey(Credito, on_delete=models.CASCADE, related_name="garantias")
    descripcion = models.CharField("Descripción", max_length=200)
    valor_estimado = models.DecimalField("Valor estimado (C$)", max_digits=12, decimal_places=2, null=True, blank=True)
    foto = models.ImageField(upload_to="garantias/%Y/%m/", blank=True)
    creado = models.DateTimeField(auto_now_add=True)


class Visita(models.Model):
    RESULTADOS = [("COBRADO", "Cobrado"), ("PROMESA", "Promesa de pago"),
                  ("NO_ENCONTRADO", "No se encontró"), ("SIN_DINERO", "Sin dinero"), ("OTRO", "Otro")]

    credito = models.ForeignKey(Credito, on_delete=models.CASCADE, related_name="visitas")
    gestor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    fecha = models.DateField(default=date.today)
    resultado = models.CharField(max_length=15, choices=RESULTADOS)
    fecha_promesa = models.DateField("Fecha prometida", null=True, blank=True)
    nota = models.CharField(max_length=200, blank=True)
    pago = models.ForeignKey(Pago, on_delete=models.SET_NULL, null=True, blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-creado"]


class Bitacora(models.Model):
    """Registro de auditoría: quién hizo qué y cuándo."""
    fecha = models.DateTimeField(auto_now_add=True)
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    accion = models.CharField(max_length=60)
    detalle = models.CharField(max_length=300)

    class Meta:
        ordering = ["-fecha"]

    @classmethod
    def log(cls, usuario, accion, detalle):
        cls.objects.create(usuario=usuario if usuario and usuario.is_authenticated else None,
                           accion=accion, detalle=detalle[:300])
