from django.contrib import admin
from .models import Item, Movement, Todo, Archive, Order, OrderLine


from django.utils.html import format_html


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ("thumb", "name", "quantity", "price")
    list_display_links = ("thumb", "name")
    search_fields = ("name",)

    @admin.display(description="Photo")
    def thumb(self, obj):
        if obj.image:
            return format_html('<img src="{}" style="height:40px;width:40px;object-fit:cover;border-radius:8px">', obj.image.url)
        return "—"


@admin.register(Movement)
class MovementAdmin(admin.ModelAdmin):
    list_display = ("ts", "type", "item_name", "qty", "before", "after", "value")
    list_filter = ("type",)
    search_fields = ("item_name", "note")
    date_hierarchy = "ts"


@admin.register(Todo)
class TodoAdmin(admin.ModelAdmin):
    list_display = ("text", "priority", "completed")
    list_filter = ("priority", "completed")


@admin.register(Archive)
class ArchiveAdmin(admin.ModelAdmin):
    list_display = ("day", "movements_count", "total_in", "total_out", "sales_value", "created_at")
    date_hierarchy = "day"


class OrderLineInline(admin.TabularInline):
    model = OrderLine
    extra = 0


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("id", "label", "total", "created_at")
    date_hierarchy = "created_at"
    inlines = [OrderLineInline]
