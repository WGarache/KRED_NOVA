from django.contrib import admin

from .models import Bitacora, Cliente, Credito, Cuota, Garantia, Pago, Visita

admin.site.site_header = "Kred Nova · Administración"


class CuotaInline(admin.TabularInline):
    model = Cuota
    extra = 0


class GarantiaInline(admin.TabularInline):
    model = Garantia
    extra = 0


@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = ("codigo", "nombres", "apellidos", "cedula", "telefono", "estado")
    search_fields = ("codigo", "nombres", "apellidos", "cedula")
    list_filter = ("estado",)

    def has_delete_permission(self, request, obj=None):
        return False  # los clientes no se eliminan, se inactivan


@admin.register(Credito)
class CreditoAdmin(admin.ModelAdmin):
    list_display = ("numero", "cliente", "monto", "tasa_mensual", "frecuencia", "estado", "gestor")
    list_filter = ("estado", "frecuencia")
    inlines = [GarantiaInline, CuotaInline]


admin.site.register([Pago, Visita, Bitacora])
