from django.db import migrations, models


def backfill_kind(apps, schema_editor):
    """Pré-classe les articles existants : ceux dont la catégorie évoque la
    nourriture passent en 'food' ; tout le reste garde la valeur par défaut 'drink'."""
    from inventory.models import guess_kind
    Item = apps.get_model("inventory", "Item")
    for it in Item.objects.exclude(category=""):
        kind = guess_kind(it.category)
        if kind != it.kind:
            it.kind = kind
            it.save(update_fields=["kind"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0012_alter_bar_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="item",
            name="kind",
            field=models.CharField(
                choices=[("drink", "Boisson"), ("food", "Nourriture")],
                default="drink",
                max_length=8,
                verbose_name="Type",
            ),
        ),
        migrations.RunPython(backfill_kind, noop),
    ]
