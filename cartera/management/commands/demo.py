"""Crea roles, usuarios de prueba y una cartera de ejemplo.  Uso: python manage.py demo"""
import random
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.models import Group, Permission, User
from django.core.management.base import BaseCommand

from cartera.models import Cliente, Credito, Garantia, Visita

NOMBRES = ["María José", "Carlos", "Ana Lucía", "José Ramón", "Rosa", "Luis Alberto", "Martha", "Juan Carlos",
           "Yesenia", "Pedro", "Karla", "Francisco", "Gloria", "Ernesto", "Indira", "Roberto", "Fátima", "Álvaro",
           "Scarleth", "Danilo", "Xiomara", "Byron", "Jessenia", "Félix", "Arlen", "Orlando", "Mayra", "Henry",
           "Lissette", "Norman", "Darling", "Wilber"]
APELLIDOS = ["López Martínez", "García Rivas", "Hernández Úbeda", "Pérez Castillo", "Sánchez Mairena",
             "Rodríguez Obando", "Gutiérrez Lacayo", "Morales Téllez", "Aguilar Zamora", "Espinoza Ruiz",
             "Mendoza Arauz", "Torres Blandón", "Rivera Solís", "Cruz Duarte", "Flores Picado", "Reyes Membreño",
             "Jarquín Báez", "Martínez Soza", "Chavarría Gómez", "Ortega Pineda", "Navarrete Ruiz", "Dávila Cruz",
             "Vanegas López", "Bermúdez Rocha", "Moreno Gaitán", "Castro Urbina", "Siles Mejía", "Rocha Aráuz",
             "Palacios Vega", "Montenegro Ríos", "Tercero Juárez", "Zelaya Ocón"]
NEGOCIOS = ["Pulpería", "Venta de ropa", "Taller mecánico", "Comedor", "Costura", "Venta de frutas",
            "Panadería", "Ferretería", "Salón de belleza", "Venta de verduras", "Tortillería", "Zapatería"]
BARRIOS = ["Managua, B° Altagracia", "Managua, Mercado Oriental", "Ciudad Sandino, zona 3", "Masaya, Monimbó",
           "Managua, B° Monseñor Lezcano", "Tipitapa, centro", "Managua, Villa Venezuela", "Managua, Bello Horizonte"]
GARANTIAS = ["Televisor 50 pulgadas", "Refrigeradora", "Motocicleta", "Máquina de coser industrial",
             "Equipo de sonido", "Cocina de 4 quemadores"]


class Command(BaseCommand):
    help = "Carga datos de demostración de Kred Nova"

    def handle(self, *args, **opts):
        random.seed(11)
        roles = {r: Group.objects.get_or_create(name=r)[0] for r in ("Administrador", "Gerente", "Cajero", "Gestor")}
        ver = Permission.objects.get(codename="view_bitacora")
        roles["Gerente"].permissions.add(ver)
        roles["Administrador"].permissions.add(ver)

        def usuario(nombre, rol, superuser=False):
            u, creado = User.objects.get_or_create(username=nombre)
            if creado:
                u.set_password("demo1234")
                u.is_staff = u.is_superuser = superuser
                u.save()
            u.groups.add(roles[rol])
            return u

        usuario("admin", "Administrador", superuser=True)
        usuario("gerente", "Gerente")
        cajero = usuario("cajero", "Cajero")
        gestores = [usuario("gestor1", "Gestor"), usuario("gestor2", "Gestor")]

        if Cliente.objects.exists():
            self.stdout.write("Ya hay clientes; no se cargó la cartera de ejemplo.")
            return

        hoy = date.today()
        for i in range(32):
            barrio = random.choice(BARRIOS)
            c = Cliente.objects.create(
                nombres=NOMBRES[i], apellidos=APELLIDOS[i],
                cedula=f"001-{random.randint(10, 28):02d}{random.randint(1, 12):02d}{random.randint(60, 99)}-{1000 + i}{chr(65 + i % 26)}",
                telefono=f"8{random.randint(100, 999)}-{random.randint(1000, 9999)}",
                email=f"cliente{i + 1}@ejemplo.com" if i % 4 == 0 else "",
                direccion=f"{barrio}, casa {random.randint(10, 400)}",
                negocio=random.choice(NEGOCIOS), direccion_negocio=f"{barrio}, de la iglesia {random.randint(1, 4)}c al sur")
            freq = ["DIARIA", "DIARIA", "SEMANAL", "QUINCENAL"][i % 4]
            meses = random.choice([2, 3, 4]) if freq != "QUINCENAL" else random.choice([3, 4, 6])
            cr = Credito.objects.create(
                cliente=c, monto=Decimal(random.choice([3000, 5000, 8000, 10000, 15000, 20000])),
                tasa_mensual=Decimal(random.choice([5, 6, 8])), plazo_meses=meses, frecuencia=freq, numero_cuotas=0,
                fecha_desembolso=hoy - timedelta(days=random.randint(12, 70)), gestor=gestores[i % 2],
                destino="Capital de trabajo",
                fiador_nombre=f"{random.choice(NOMBRES)} {random.choice(APELLIDOS)}",
                fiador_cedula=f"001-{random.randint(100000, 999999)}-{random.randint(1000, 9999)}X",
                fiador_telefono=f"8{random.randint(100, 999)}-{random.randint(1000, 9999)}",
                fiador_direccion=random.choice(BARRIOS))
            cr.generar_cuotas()
            if i % 3 == 0:
                Garantia.objects.create(credito=cr, descripcion=random.choice(GARANTIAS),
                                        valor_estimado=Decimal(random.choice([6000, 9000, 15000])))
            # Perfil de pago: 0-4 al día · 5 atraso leve · 6 atraso medio · 7 atraso fuerte
            perfil = i % 8
            exigibles = list(cr.cuotas.filter(fecha_vencimiento__lt=hoy))
            atraso = {5: 2, 6: 5, 7: 12}.get(perfil, 0)
            pagar = exigibles[: max(0, len(exigibles) - atraso)]
            for q in pagar:
                cr.aplicar_pago(q.total, cajero, q.fecha_vencimiento)
            if perfil in (5, 6):
                Visita.objects.create(credito=cr, gestor=cr.gestor, fecha=hoy - timedelta(days=1),
                                      resultado="PROMESA", fecha_promesa=hoy, nota="Paga cuando cobre ventas")
            if perfil == 7:
                Visita.objects.create(credito=cr, gestor=cr.gestor, fecha=hoy - timedelta(days=2),
                                      resultado="NO_ENCONTRADO", nota="Negocio cerrado")
        c = Cliente.objects.create(nombres="Julio César", apellidos="Vargas Bonilla", cedula="001-150378-0099X",
                                   telefono="8555-0101", negocio="Carpintería")
        c.inactivar("Crédito cancelado, sin renovación")
        self.stdout.write(self.style.SUCCESS(
            "Listo. Usuarios: admin, gerente, cajero, gestor1, gestor2 (contraseña: demo1234)"))
