"""Servicios: estado de cuenta en PDF, correo (opcional) y calendario .ics."""
import io
from datetime import date, datetime, timedelta

from django.conf import settings
from django.contrib.staticfiles import finders
from django.core.mail import EmailMessage
from django.template.loader import render_to_string


def contexto_estado_cuenta(credito):
    hoy = date.today()
    return {"c": credito, "cliente": credito.cliente, "res": credito.resumen(hoy), "hoy": hoy,
            "cuotas": [(q, q.estado(hoy)) for q in credito.cuotas.all()],
            "pagos": credito.pagos.all()[:15], "garantias": credito.garantias.all(),
            "empresa": settings.EMPRESA_NOMBRE, "lema": settings.EMPRESA_LEMA,
            "logo_path": finders.find("kred/logo.png")}


def estado_cuenta_pdf(credito):
    from xhtml2pdf import pisa
    html = render_to_string("cartera/estado_cuenta_pdf.html", contexto_estado_cuenta(credito))
    out = io.BytesIO()
    pisa.CreatePDF(html, dest=out, encoding="utf-8")
    return out.getvalue()


def _esc(t):
    return str(t).replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


def calendario_ics(eventos):
    """eventos: lista de dicts {uid, fecha, titulo, descripcion, lugar}. Compatible con Google Calendar y Outlook."""
    ahora = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lineas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kred Nova//ERP Cobros//ES", "CALSCALE:GREGORIAN",
              "X-WR-CALNAME:Visitas de cobro Kred Nova"]
    for e in eventos:
        d = e["fecha"]
        lineas += [
            "BEGIN:VEVENT", f"UID:{e['uid']}@kred-nova", f"DTSTAMP:{ahora}",
            f"DTSTART;VALUE=DATE:{d:%Y%m%d}", f"DTEND;VALUE=DATE:{(d + timedelta(days=1)):%Y%m%d}",
            f"SUMMARY:{_esc(e['titulo'])}", f"DESCRIPTION:{_esc(e.get('descripcion', ''))}",
            f"LOCATION:{_esc(e.get('lugar', ''))}", "END:VEVENT",
        ]
    lineas.append("END:VCALENDAR")
    return "\r\n".join(lineas)


def enviar_estado_cuenta(credito):
    cliente = credito.cliente
    if not cliente.email:
        raise ValueError("El cliente no tiene correo registrado.")
    ctx = contexto_estado_cuenta(credito)
    msg = EmailMessage(subject=f"Estado de cuenta {credito.numero} - {settings.EMPRESA_NOMBRE}",
                       body=render_to_string("cartera/email_estado_cuenta.txt", ctx), to=[cliente.email])
    msg.attach(f"estado_{credito.numero}.pdf", estado_cuenta_pdf(credito), "application/pdf")
    msg.send()
