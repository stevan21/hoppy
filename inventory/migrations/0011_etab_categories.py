from django.db import migrations, models


def set_default_category(apps, schema_editor):
    """Les articles existants sont des boissons -> catégorie « Boissons »."""
    Item = apps.get_model("inventory", "Item")
    Item.objects.filter(category="").update(category="Boissons")


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0010_qr_pending'),
    ]

    operations = [
        migrations.AddField(
            model_name='bar',
            name='type',
            field=models.CharField(
                choices=[('cave', 'Cave'), ('bar', 'Bar'), ('restaurant', 'Restaurant'), ('bar_resto', 'Bar-Restaurant')],
                default='bar', max_length=12, verbose_name="Type d'établissement"),
        ),
        migrations.AddField(
            model_name='item',
            name='category',
            field=models.CharField(blank=True, default='', max_length=60, verbose_name='Catégorie'),
        ),
        migrations.RunPython(set_default_category, noop),
    ]
