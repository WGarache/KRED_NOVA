from django import forms
from django.contrib.auth.models import User

from .models import Cliente, Credito, Garantia, Visita


class Base(forms.ModelForm):
    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        for f in self.fields.values():
            f.widget.attrs.setdefault("class", "inp")


class ClienteForm(Base):
    class Meta:
        model = Cliente
        fields = ["nombres", "apellidos", "cedula", "telefono", "email", "direccion",
                  "negocio", "direccion_negocio", "foto_cedula"]
        widgets = {
            "direccion": forms.Textarea(attrs={"rows": 2}),
            "foto_cedula": forms.ClearableFileInput(attrs={"accept": "image/*", "capture": "environment"}),
        }


class CreditoForm(Base):
    numero_cuotas = forms.IntegerField(
        label="Número de cuotas", required=False, min_value=1,
        help_text="Déjelo vacío para calcularlo: diaria 26 por mes, semanal 4, quincenal 2.")

    class Meta:
        model = Credito
        fields = ["monto", "tasa_mensual", "plazo_meses", "frecuencia", "numero_cuotas", "fecha_desembolso",
                  "destino", "gestor", "fiador_nombre", "fiador_cedula", "fiador_telefono", "fiador_direccion"]
        widgets = {"fecha_desembolso": forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d")}

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.fields["gestor"].queryset = User.objects.filter(is_active=True).order_by("username")
        self.fields["numero_cuotas"].widget.attrs["class"] = "inp"

    def clean(self):
        d = super().clean()
        if d.get("frecuencia") and d.get("plazo_meses") and not d.get("numero_cuotas"):
            d["numero_cuotas"] = d["plazo_meses"] * Credito.CUOTAS_POR_MES[d["frecuencia"]]
        return d


class PagoForm(forms.Form):
    monto = forms.DecimalField(max_digits=12, decimal_places=2, min_value=0.01,
                               widget=forms.NumberInput(attrs={"class": "inp inp-xl", "step": "0.01",
                                                               "inputmode": "decimal"}))
    fecha = forms.DateField(widget=forms.DateInput(attrs={"class": "inp", "type": "date"}, format="%Y-%m-%d"))
    nota = forms.CharField(required=False, max_length=200,
                           widget=forms.TextInput(attrs={"class": "inp", "placeholder": "Opcional"}))


class GarantiaForm(Base):
    class Meta:
        model = Garantia
        fields = ["descripcion", "valor_estimado", "foto"]
        widgets = {"foto": forms.ClearableFileInput(attrs={"accept": "image/*", "capture": "environment"})}


class VisitaForm(Base):
    class Meta:
        model = Visita
        fields = ["resultado", "fecha_promesa", "nota"]
        widgets = {"fecha_promesa": forms.DateInput(attrs={"type": "date"})}

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.fields["resultado"].choices = [c for c in Visita.RESULTADOS if c[0] != "COBRADO"]


class InactivarForm(forms.Form):
    MOTIVOS = [("Crédito cancelado, sin renovación", "Crédito cancelado, sin renovación"),
               ("Solicitud del cliente", "Solicitud del cliente"),
               ("Fallecimiento", "Fallecimiento"),
               ("Mal historial de pago", "Mal historial de pago"),
               ("Otro", "Otro")]
    motivo = forms.ChoiceField(choices=MOTIVOS, widget=forms.Select(attrs={"class": "inp"}))
    detalle = forms.CharField(required=False, max_length=150,
                              widget=forms.TextInput(attrs={"class": "inp", "placeholder": "Detalle (opcional)"}))
