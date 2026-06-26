from django.contrib import admin
from django.utils.html import format_html

from .models import (Item, Movement, Todo, Archive, Order, OrderLine, Bar, Profile,
                     PendingOrder, PendingOrderLine)


@admin.register(Bar)
class BarAdmin(admin.ModelAdmin):
    list_display = ("name", "type", "slug", "created_at")
    list_filter = ("type",)
    search_fields = ("name", "slug")


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "bar", "role")
    list_filter = ("role", "bar")
    search_fields = ("user__username",)


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ("thumb", "name", "category", "kind", "bar", "quantity", "price")
    list_display_links = ("thumb", "name")
    list_filter = ("bar", "kind", "category")
    search_fields = ("name", "category")

    @admin.display(description="Photo")
    def thumb(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="height:40px;width:40px;object-fit:cover;border-radius:8px">', obj.image.url)
        return "—"


@admin.register(Movement)
class MovementAdmin(admin.ModelAdmin):
    list_display = ("ts", "bar", "type", "item_name", "qty", "before", "after", "value")
    list_filter = ("bar", "type")
    search_fields = ("item_name", "note")
    date_hierarchy = "ts"


@admin.register(Todo)
class TodoAdmin(admin.ModelAdmin):
    list_display = ("text", "bar", "priority", "completed")
    list_filter = ("bar", "priority", "completed")


@admin.register(Archive)
class ArchiveAdmin(admin.ModelAdmin):
    list_display = ("day", "bar", "movements_count", "total_in", "total_out", "sales_value", "created_at")
    list_filter = ("bar",)
    date_hierarchy = "day"


class OrderLineInline(admin.TabularInline):
    model = OrderLine
    extra = 0


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("id", "bar", "label", "total", "created_at")
    list_filter = ("bar",)
    date_hierarchy = "created_at"
    inlines = [OrderLineInline]


class PendingOrderLineInline(admin.TabularInline):
    model = PendingOrderLine
    extra = 0


@admin.register(PendingOrder)
class PendingOrderAdmin(admin.ModelAdmin):
    list_display = ("id", "bar", "table", "status", "total", "created_at")
    list_filter = ("bar", "status")
    date_hierarchy = "created_at"
    inlines = [PendingOrderLineInline]
