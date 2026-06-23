from django.db import models


class Item(models.Model):
    """Un article du stock (boisson)."""
    name = models.CharField("Nom", max_length=120, unique=True)
    quantity = models.IntegerField("Quantité", default=0)
    price = models.DecimalField("Prix unitaire (XAF)", max_digits=12, decimal_places=2, default=0)
    image = models.ImageField("Photo", upload_to="items/", blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.quantity})"


class Movement(models.Model):
    """Un mouvement de stock (entrée / sortie / création / suppression / réinitialisation)."""
    TYPE_CHOICES = [
        ("in", "Entrée"),
        ("out", "Sortie"),
        ("create", "Création"),
        ("delete", "Suppression"),
        ("reset", "Réinitialisation"),
    ]
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL, related_name="movements")
    item_name = models.CharField(max_length=120)  # nom figé au moment du mouvement
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    qty = models.IntegerField(default=0)
    before = models.IntegerField(default=0)
    after = models.IntegerField(default=0)
    note = models.CharField(max_length=160, blank=True, default="")
    value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    ts = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["ts"]  # du plus ancien au plus récent

    def __str__(self):
        return f"{self.ts:%Y-%m-%d %H:%M} {self.type} {self.item_name} x{self.qty}"


class Todo(models.Model):
    PRIORITY_CHOICES = [("low", "Basse"), ("medium", "Moyenne"), ("high", "Haute")]
    text = models.CharField(max_length=200)
    completed = models.BooleanField(default=False)
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="medium")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.text


class Order(models.Model):
    """Une commande (prise par le serveur) — décrémente le stock à la validation."""
    label = models.CharField("Table / client", max_length=120, blank=True, default="")
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Commande #{self.id} ({self.total} XAF)"


class OrderLine(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL)
    item_name = models.CharField(max_length=120)
    qty = models.IntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.qty} x {self.item_name}"


class Archive(models.Model):
    """Snapshot quotidien de l'historique + inventaire (téléchargeable)."""
    day = models.DateField("Jour", unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    movements_count = models.IntegerField(default=0)
    total_in = models.IntegerField(default=0)
    total_out = models.IntegerField(default=0)
    sales_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    content = models.JSONField(default=dict)  # {summary, movements, stock}

    class Meta:
        ordering = ["-day"]  # plus récent en premier

    def __str__(self):
        return f"Archive {self.day}"
