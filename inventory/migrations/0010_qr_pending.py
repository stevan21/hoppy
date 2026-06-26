import secrets

import django.db.models.deletion
from django.db import migrations, models

import inventory.models


def gen_tokens(apps, schema_editor):
    Bar = apps.get_model("inventory", "Bar")
    used = set()
    for bar in Bar.objects.filter(public_token__isnull=True):
        tok = secrets.token_hex(16)
        while tok in used:
            tok = secrets.token_hex(16)
        used.add(tok)
        bar.public_token = tok
        bar.save(update_fields=["public_token"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0009_finalize_bar'),
    ]

    operations = [
        migrations.CreateModel(
            name='PendingOrder',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('table', models.CharField(blank=True, default='', max_length=40, verbose_name='Table')),
                ('status', models.CharField(choices=[('pending', 'En attente'), ('done', 'Validée'), ('rejected', 'Refusée')], default='pending', max_length=10)),
                ('total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('bar', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='pending_orders', to='inventory.bar')),
            ],
            options={'ordering': ['created_at']},
        ),
        migrations.CreateModel(
            name='PendingOrderLine',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('item_name', models.CharField(max_length=120)),
                ('qty', models.IntegerField(default=1)),
                ('unit_price', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('line_total', models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ('item', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='inventory.item')),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lines', to='inventory.pendingorder')),
            ],
        ),
        # Jeton public du bar : ajout nullable -> backfill -> état final
        migrations.AddField(
            model_name='bar',
            name='public_token',
            field=models.CharField(editable=False, max_length=32, null=True),
        ),
        migrations.RunPython(gen_tokens, noop),
        migrations.AlterField(
            model_name='bar',
            name='public_token',
            field=models.CharField(default=inventory.models.generate_token, editable=False, max_length=32, unique=True),
        ),
    ]
