import secrets

from django.contrib.auth.models import User
from django.db import models


def generate_token():
    """Jeton public aléatoire pour l'URL du menu à scanner (non devinable)."""
    return secrets.token_hex(16)


# Catégories proposées par défaut selon le type d'établissement (suggestions, modifiables).
DEFAULT_CATEGORIES = {
    "cave": ["Vins", "Spiritueux", "Bières", "Sans alcool", "Autres"],
    "bar": ["Bières", "Spiritueux", "Cocktails", "Sans alcool", "Snacks"],
    "restaurant": ["Entrées", "Plats", "Accompagnements", "Desserts", "Boissons"],
    "bar_resto": ["Boissons", "Entrées", "Plats", "Desserts", "Snacks"],
}

# Indices textuels d'une catégorie « nourriture » (tout le reste = boisson) — sert
# au pré-classement automatique. Le gérant garde le dernier mot via le champ Item.kind.
FOOD_CATEGORY_HINTS = (
    "entrée", "entree", "plat", "accompagn", "dessert", "snack", "nourriture",
    "manger", "food", "tapas", "pizza", "burger", "sandwich", "grillade",
    "salade", "viande", "poisson", "frite", "brochette",
)


def guess_kind(category):
    """Devine si une catégorie relève de la nourriture ('food') ou des boissons ('drink')."""
    c = (category or "").lower()
    return "food" if any(h in c for h in FOOD_CATEGORY_HINTS) else "drink"


class Bar(models.Model):
    """Un établissement (tenant). Chaque bar a ses propres données, isolées."""
    TYPE_CHOICES = [
        ("cave", "Cave"),
        ("bar", "Bar"),
        ("restaurant", "Restaurant"),
        ("bar_resto", "Bar-Restaurant"),
    ]
    name = models.CharField("Nom de l'établissement", max_length=120)
    slug = models.SlugField(unique=True)
    type = models.CharField("Type d'établissement", max_length=12, choices=TYPE_CHOICES, default="bar")
    public_token = models.CharField(max_length=32, unique=True, default=generate_token, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    @property
    def noun(self):
        """Nom générique d'un article selon le type ('boisson' pour un bar, sinon 'article')."""
        return "boisson" if self.type == "bar" else "article"

    @property
    def noun_plural(self):
        return self.noun + "s"

    def category_suggestions(self):
        """Catégories par défaut du type + catégories déjà utilisées par les articles
        (uniques, ordre stable : défauts d'abord, puis personnalisées). Sert aux datalists
        et à l'ordre de groupage."""
        ordered = list(DEFAULT_CATEGORIES.get(self.type, DEFAULT_CATEGORIES["bar"]))
        seen = {c.lower() for c in ordered}
        for cat in self.items.exclude(category="").values_list("category", flat=True).distinct():
            if cat.lower() not in seen:
                ordered.append(cat)
                seen.add(cat.lower())
        return ordered


class Profile(models.Model):
    """Lie un utilisateur Django à un bar avec un rôle."""
    ROLE_CHOICES = [("gerant", "Gérant"), ("serveur", "Serveur")]
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    bar = models.ForeignKey(Bar, on_delete=models.CASCADE, related_name="members")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="gerant")

    @property
    def is_gerant(self):
        return self.role == "gerant"

    def __str__(self):
        return f"{self.user.username} — {self.bar.name} ({self.get_role_display()})"


class Item(models.Model):
    """Un article du stock (boisson, plat, etc.)."""
    KIND_CHOICES = [("drink", "Boisson"), ("food", "Nourriture")]

    bar = models.ForeignKey(Bar, on_delete=models.CASCADE, related_name="items")
    name = models.CharField("Nom", max_length=120)
    category = models.CharField("Catégorie", max_length=60, blank=True, default="")
    kind = models.CharField("Type", max_length=8, choices=KIND_CHOICES, default="drink")
    quantity = models.IntegerField("Quantité", default=0)
    price = models.DecimalField("Prix unitaire (XAF)", max_digits=12, decimal_places=2, default=0)
    image = models.ImageField("Photo", upload_to="items/", blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["bar", "name"], name="uniq_item_bar_name"),
        ]

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
    bar = models.ForeignKey(Bar, on_delete=models.CASCADE, related_name="movements")
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
    bar = models.ForeignKey(Bar, on_delete=models.CASCADE, related_name="todos")
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
    bar = models.ForeignKey(Bar, on_delete=models.CASCADE, related_name="orders")
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
    bar = models.ForeignKey(Bar, on_delete=models.CASCADE, related_name="archives")
    day = models.DateField("Jour")
    created_at = models.DateTimeField(auto_now_add=True)
    movements_count = models.IntegerField(default=0)
    total_in = models.IntegerField(default=0)
    total_out = models.IntegerField(default=0)
    sales_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    content = models.JSONField(default=dict)  # {summary, movements, stock}

    class Meta:
        ordering = ["-day"]  # plus récent en premier
        constraints = [
            models.UniqueConstraint(fields=["bar", "day"], name="uniq_archive_bar_day"),
        ]

    def __str__(self):
        return f"Archive {self.day}"


class PendingOrder(models.Model):
    """Commande envoyée par un client (QR code) — en attente de validation au comptoir.
    Ne touche pas au stock : c'est la validation par un serveur qui crée l'Order réelle."""
    STATUS_CHOICES = [("pending", "En attente"), ("done", "Validée"), ("rejected", "Refusée")]
    bar = models.ForeignKey(Bar, on_delete=models.CASCADE, related_name="pending_orders")
    table = models.CharField("Table", max_length=40, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)  # estimé à l'envoi
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]  # plus anciennes en premier (à traiter d'abord)

    def __str__(self):
        return f"Commande client {self.table} ({self.get_status_display()})"


class PendingOrderLine(models.Model):
    order = models.ForeignKey(PendingOrder, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL)
    item_name = models.CharField(max_length=120)
    qty = models.IntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    def __str__(self):
        return f"{self.qty} x {self.item_name}"
