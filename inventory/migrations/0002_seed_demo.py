from django.db import migrations


def seed(apps, schema_editor):
    Item = apps.get_model("inventory", "Item")
    Todo = apps.get_model("inventory", "Todo")

    if not Item.objects.exists():
        Item.objects.bulk_create([
            Item(name="Vodka", quantity=12, price=12000),
            Item(name="Rhum", quantity=8, price=9000),
            Item(name="Whisky", quantity=3, price=22000),
            Item(name="Tequila", quantity=1, price=18000),
            Item(name="Gin", quantity=6, price=15000),
            Item(name="Cointreau", quantity=0, price=13000),
        ])

    if not Todo.objects.exists():
        Todo.objects.bulk_create([
            Todo(text="Commander du gin", completed=False, priority="high"),
            Todo(text="Nettoyer le bar", completed=False, priority="medium"),
            Todo(text="Préparer les sirops", completed=True, priority="low"),
        ])


def unseed(apps, schema_editor):
    apps.get_model("inventory", "Item").objects.all().delete()
    apps.get_model("inventory", "Todo").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('inventory', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
