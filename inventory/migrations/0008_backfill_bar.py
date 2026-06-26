from django.db import migrations
from django.utils.text import slugify


def backfill(apps, schema_editor):
    """Rattache toutes les données existantes à un « Bar de démonstration »
    et lui associe un gérant (le 1er superuser, sinon un compte demo/demo)."""
    Bar = apps.get_model("inventory", "Bar")
    Profile = apps.get_model("inventory", "Profile")
    User = apps.get_model("auth", "User")

    Item = apps.get_model("inventory", "Item")
    Movement = apps.get_model("inventory", "Movement")
    Todo = apps.get_model("inventory", "Todo")
    Order = apps.get_model("inventory", "Order")
    Archive = apps.get_model("inventory", "Archive")

    has_data = any(m.objects.exists() for m in (Item, Movement, Todo, Order, Archive))
    if not has_data and not User.objects.exists():
        return  # base vierge : rien à rattacher, pas de bar de démo

    bar, _ = Bar.objects.get_or_create(slug="demo", defaults={"name": "Bar de démonstration"})

    # Gérant : 1er superuser existant, sinon un compte demo
    gerant = User.objects.filter(is_superuser=True).order_by("id").first()
    if gerant is None:
        gerant = User.objects.filter(profile__isnull=True).order_by("id").first()
    if gerant is None:
        gerant = User(username="demo", email="demo@example.com", is_staff=True, is_superuser=True)
        # mot de passe "demo" (hash PBKDF2 généré hors migration pour rester déterministe)
        from django.contrib.auth.hashers import make_password
        gerant.password = make_password("demo")
        gerant.save()

    Profile.objects.get_or_create(user=gerant, defaults={"bar": bar, "role": "gerant"})

    for model in (Item, Movement, Todo, Order, Archive):
        model.objects.filter(bar__isnull=True).update(bar=bar)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0007_saas_schema'),
    ]

    operations = [
        migrations.RunPython(backfill, noop),
    ]
