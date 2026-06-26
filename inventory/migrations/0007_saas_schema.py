from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('inventory', '0006_alter_item_name'),
    ]

    operations = [
        migrations.CreateModel(
            name='Bar',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120, verbose_name='Nom du bar')),
                ('slug', models.SlugField(unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering': ['name']},
        ),
        migrations.CreateModel(
            name='Profile',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('gerant', 'Gérant'), ('serveur', 'Serveur')], default='gerant', max_length=10)),
                ('bar', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='members', to='inventory.bar')),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='profile', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        # FK bar (temporairement nullable, le temps du backfill)
        migrations.AddField(
            model_name='item',
            name='bar',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='items', to='inventory.bar'),
        ),
        migrations.AddField(
            model_name='movement',
            name='bar',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='movements', to='inventory.bar'),
        ),
        migrations.AddField(
            model_name='todo',
            name='bar',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='todos', to='inventory.bar'),
        ),
        migrations.AddField(
            model_name='order',
            name='bar',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='orders', to='inventory.bar'),
        ),
        migrations.AddField(
            model_name='archive',
            name='bar',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='archives', to='inventory.bar'),
        ),
        # Lever les contraintes d'unicité globales (deviennent unicité par bar en 0009)
        migrations.AlterField(
            model_name='item',
            name='name',
            field=models.CharField(max_length=120, verbose_name='Nom'),
        ),
        migrations.AlterField(
            model_name='archive',
            name='day',
            field=models.DateField(verbose_name='Jour'),
        ),
    ]
