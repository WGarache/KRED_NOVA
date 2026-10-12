from django.urls import path

from . import views as v

urlpatterns = [
    path("", v.dashboard, name="dashboard"),
    path("ruta/", v.ruta, name="ruta"),
    path("clientes/", v.clientes, name="clientes"),
    path("clientes/nuevo/", v.cliente_form, name="cliente_nuevo"),
    path("clientes/<int:pk>/", v.cliente_detalle, name="cliente_detalle"),
    path("clientes/<int:pk>/editar/", v.cliente_form, name="cliente_editar"),
    path("clientes/<int:pk>/inactivar/", v.cliente_inactivar, name="cliente_inactivar"),
    path("clientes/<int:pk>/reactivar/", v.cliente_reactivar, name="cliente_reactivar"),
    path("clientes/<int:cliente_pk>/credito/", v.credito_nuevo, name="credito_nuevo"),
    path("creditos/", v.creditos, name="creditos"),
    path("creditos/<int:pk>/", v.credito_detalle, name="credito_detalle"),
    path("creditos/<int:pk>/pagar/", v.pagar, name="pagar"),
    path("creditos/<int:pk>/visita/", v.visita_registrar, name="visita"),
    path("creditos/<int:pk>/garantia/", v.garantia_agregar, name="garantia_agregar"),
    path("creditos/<int:pk>/incobrable/", v.credito_incobrable, name="credito_incobrable"),
    path("creditos/<int:pk>/estado.pdf", v.estado_cuenta_pdf, name="estado_pdf"),
    path("creditos/<int:pk>/enviar/", v.estado_cuenta_enviar, name="estado_enviar"),
    path("recibos/<int:pk>/", v.recibo, name="recibo"),
    path("reportes/", v.reportes, name="reportes"),
    path("agenda.ics", v.agenda_ics, name="agenda_ics"),
    path("bitacora/", v.bitacora, name="bitacora"),
]
