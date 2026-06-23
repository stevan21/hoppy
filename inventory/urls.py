from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("gerant/", views.gerant, name="gerant"),
    path("sw.js", views.service_worker, name="sw"),

    # API
    path("api/state/", views.state),
    path("api/items/", views.items),
    path("api/items/<int:pk>/", views.item_detail),
    path("api/items/<int:pk>/move/", views.item_move),
    path("api/items/<int:pk>/price/", views.item_price),
    path("api/reset/", views.reset_stock),
    path("api/history/clear/", views.history_clear),
    path("api/todos/", views.todos),
    path("api/todos/<int:pk>/toggle/", views.todo_toggle),
    path("api/todos/<int:pk>/", views.todo_detail),

    # Commandes
    path("api/orders/", views.orders),
    path("api/orders/<int:pk>/", views.order_detail),

    # Archives
    path("api/archive/run/", views.archive_run),
    path("api/archives/<int:pk>/", views.archive_detail),
    path("archive/<int:pk>/pdf/", views.archive_pdf),
    path("archive/<int:pk>/download/", views.archive_download),
]
