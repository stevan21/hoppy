import csv
import json
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.http import JsonResponse, HttpResponseNotAllowed, HttpResponse
from django.shortcuts import render, get_object_or_404
from django.utils import timezone
from django.utils.html import escape
from django.views.decorators.csrf import csrf_exempt

from .models import Item, Movement, Todo, Archive, Order, OrderLine


# ----------------------------------------------------------------------------
# Sérialisation
# ----------------------------------------------------------------------------
def ms(dt):
    return int(dt.timestamp() * 1000)


def item_dict(it):
    return {
        "id": str(it.id), "name": it.name, "quantity": it.quantity,
        "price": float(it.price),
        "image": it.image.url if it.image else "",
    }


def move_dict(m):
    return {
        "id": str(m.id),
        "ts": ms(m.ts),
        "itemId": str(m.item_id) if m.item_id else None,
        "itemName": m.item_name,
        "type": m.type,
        "qty": m.qty,
        "before": m.before,
        "after": m.after,
        "note": m.note,
        "value": float(m.value),
    }


def todo_dict(t):
    return {"id": str(t.id), "text": t.text, "completed": t.completed, "priority": t.priority}


def archive_dict(a):
    return {
        "id": a.id,
        "day": a.day.isoformat(),
        "created_at": ms(a.created_at),
        "count": a.movements_count,
        "in": a.total_in,
        "out": a.total_out,
        "sales_value": float(a.sales_value),
        "pdf_url": f"/archive/{a.id}/pdf/",
        "download_url": f"/archive/{a.id}/download/",  # CSV (secondaire)
    }


_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
         "septembre", "octobre", "novembre", "décembre"]


def fr_date(d):
    return f"{_JOURS[d.weekday()]} {d.day} {_MOIS[d.month - 1]} {d.year}"


def fr_money(v):
    return f"{round(float(v or 0)):,}".replace(",", " ") + " XAF"


def order_dict(o):
    return {
        "id": str(o.id),
        "label": o.label,
        "ts": ms(o.created_at),
        "total": float(o.total),
        "lines": [
            {"name": l.item_name, "qty": l.qty,
             "unit_price": float(l.unit_price), "line_total": float(l.line_total)}
            for l in o.lines.all()
        ],
    }


def full_state():
    return {
        "items": [item_dict(i) for i in Item.objects.all()],
        "movements": [move_dict(m) for m in Movement.objects.all()],  # du + ancien au + récent
        "todos": [todo_dict(t) for t in Todo.objects.all()],
        "archives": [archive_dict(a) for a in Archive.objects.all()],  # plus récent en premier
        "orders": [order_dict(o) for o in Order.objects.prefetch_related("lines").all()],
    }


# ----------------------------------------------------------------------------
# Archivage (snapshot quotidien de l'historique + inventaire)
# ----------------------------------------------------------------------------
def _day_bounds(d):
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(d, time.min), tz)
    return start, start + timedelta(days=1)


def build_day_content(d):
    start, end = _day_bounds(d)
    moves = Movement.objects.filter(ts__gte=start, ts__lt=end)
    total_in = total_out = 0
    sales_value = Decimal(0)
    mlist = []
    for m in moves:
        if m.type in ("in", "create"):
            total_in += m.qty
        elif m.type == "out":
            total_out += m.qty
            sales_value += m.value
        mlist.append({
            "time": timezone.localtime(m.ts).strftime("%H:%M"),
            "ts": ms(m.ts),
            "item": m.item_name,
            "type": m.type,
            "qty": m.qty,
            "after": m.after,
            "note": m.note,
            "value": float(m.value),
        })
    stock = [
        {"name": i.name, "quantity": i.quantity, "price": float(i.price),
         "value": float(i.price) * i.quantity}
        for i in Item.objects.all()
    ]
    content = {
        "day": d.isoformat(),
        "summary": {"in": total_in, "out": total_out,
                    "sales_value": float(sales_value), "count": len(mlist)},
        "movements": mlist,
        "stock": stock,
    }
    return content, total_in, total_out, sales_value, len(mlist)


def archive_day(d):
    content, tin, tout, sval, count = build_day_content(d)
    arch, _ = Archive.objects.update_or_create(
        day=d,
        defaults={"movements_count": count, "total_in": tin, "total_out": tout,
                  "sales_value": sval, "content": content},
    )
    return arch


def auto_archive_past():
    """Archive automatiquement chaque jour passé (fin de journée) non encore archivé."""
    today = timezone.localdate()
    done = set(Archive.objects.values_list("day", flat=True))
    for d in Movement.objects.dates("ts", "day"):
        if d < today and d not in done:
            archive_day(d)


def state_response():
    return JsonResponse(full_state())


def body(request):
    try:
        return json.loads(request.body or b"{}")
    except (ValueError, TypeError):
        return {}


def to_int(v, default=0):
    try:
        return int(v)
    except (ValueError, TypeError):
        return default


def to_price(v):
    try:
        p = Decimal(str(v))
        return p if p >= 0 else Decimal(0)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(0)


def err(message, status=400):
    return JsonResponse({"error": message}, status=status)


# ----------------------------------------------------------------------------
# Page
# ----------------------------------------------------------------------------
def index(request):
    return render(request, "index.html")


def gerant(request):
    """Page serveur / caisse : prise de commande rapide (POS)."""
    return render(request, "gerant.html")


def service_worker(request):
    """Service worker servi à la racine pour couvrir toute l'app (PWA)."""
    sw = """
const CACHE = 'barstock-v2';
const SHELL = ['/', '/gerant/',
               '/static/style.css', '/static/app.js',
               '/static/gerant.css', '/static/gerant.js',
               '/static/offline.js', '/static/manifest.webmanifest',
               '/static/icons/icon-192.png', '/static/icons/icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // addAll échoue en bloc si une URL manque -> on met en cache au mieux, une par une.
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Données : toujours réseau. La couche hors ligne (offline.js) gère le cache/queue.
  if (u.pathname.indexOf('/api/') === 0 || u.pathname.indexOf('/media/') === 0) return;

  // Navigation (page HTML) : réseau d'abord, repli sur la page mise en cache.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(function () {
        var page = u.pathname.indexOf('/gerant') === 0 ? '/gerant/' : '/';
        return caches.match(page).then(function (m) { return m || caches.match('/gerant/'); });
      })
    );
    return;
  }

  // Ressources statiques : cache d'abord (rapide + hors ligne), mise à jour en tâche de fond.
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var net = fetch(e.request).then(function (r) {
        if (r && r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, cp); }); }
        return r;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});
"""
    resp = HttpResponse(sw, content_type="application/javascript")
    resp["Service-Worker-Allowed"] = "/"
    return resp


# ----------------------------------------------------------------------------
# API
# ----------------------------------------------------------------------------
def state(request):
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    try:
        auto_archive_past()  # archive les journées passées non archivées
    except Exception:
        pass
    return state_response()


@csrf_exempt
def items(request):
    """POST : créer une boisson (avec photo en multipart) ou réapprovisionner si le nom existe déjà."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])

    image = None
    ctype = request.content_type or ""
    if ctype.startswith("multipart"):
        name = (request.POST.get("name") or "").strip()
        qty = to_int(request.POST.get("quantity"), 1)
        price = to_price(request.POST.get("price"))
        image = request.FILES.get("image")
    else:
        data = body(request)
        name = (data.get("name") or "").strip()
        qty = to_int(data.get("quantity"), 1)
        price = to_price(data.get("price"))

    if not name:
        return err("Nom requis")
    if qty < 1:
        qty = 1

    with transaction.atomic():
        existing = Item.objects.filter(name__iexact=name).first()
        if existing:
            before = existing.quantity
            existing.quantity = before + qty
            if price > 0:
                existing.price = price
            if image:
                existing.image = image
            existing.save()
            Movement.objects.create(
                item=existing, item_name=existing.name, type="in", qty=qty,
                before=before, after=existing.quantity, note="Réapprovisionnement",
                value=Decimal(qty) * existing.price,
            )
        else:
            it = Item.objects.create(name=name, quantity=qty, price=price, image=image)
            Movement.objects.create(
                item=it, item_name=it.name, type="create", qty=qty,
                before=0, after=qty, note="Création article", value=Decimal(qty) * price,
            )
    return state_response()


@csrf_exempt
def item_detail(request, pk):
    """DELETE : supprimer un article (mouvement 'delete' enregistré)."""
    if request.method != "DELETE":
        return HttpResponseNotAllowed(["DELETE"])
    it = get_object_or_404(Item, pk=pk)
    with transaction.atomic():
        Movement.objects.create(
            item=None, item_name=it.name, type="delete", qty=it.quantity,
            before=it.quantity, after=0, note="Article supprimé",
            value=Decimal(it.quantity) * it.price,
        )
        it.delete()
    return state_response()


@csrf_exempt
def item_move(request, pk):
    """POST : mouvement d'entrée/sortie. body: {type:'in'|'out', qty, note}"""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    it = get_object_or_404(Item, pk=pk)
    data = body(request)
    mtype = data.get("type")
    if mtype not in ("in", "out"):
        return err("Type invalide")
    qty = to_int(data.get("qty"), 0)
    if qty < 1:
        return err("Quantité invalide")
    note = (data.get("note") or "").strip()

    before = it.quantity
    if mtype == "out" and qty > before:
        return err(f"Sortie impossible : seulement {before} en stock")

    with transaction.atomic():
        it.quantity = before + qty if mtype == "in" else before - qty
        it.save()
        Movement.objects.create(
            item=it, item_name=it.name, type=mtype, qty=qty,
            before=before, after=it.quantity,
            note=note or ("Réapprovisionnement" if mtype == "in" else "Sortie"),
            value=Decimal(qty) * it.price,
        )
    return state_response()


@csrf_exempt
def item_price(request, pk):
    """POST : modifier le prix unitaire. body: {price}"""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    it = get_object_or_404(Item, pk=pk)
    data = body(request)
    it.price = to_price(data.get("price"))
    it.save()
    return state_response()


@csrf_exempt
def reset_stock(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    with transaction.atomic():
        count = Item.objects.count()
        if count:
            Movement.objects.create(
                item=None, item_name="— Inventaire —", type="reset", qty=count,
                before=0, after=0, note=f"{count} articles supprimés", value=0,
            )
            Item.objects.all().delete()
    return state_response()


@csrf_exempt
def history_clear(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    Movement.objects.all().delete()
    return state_response()


@csrf_exempt
def todos(request):
    """POST : créer une tâche. body: {text, priority}"""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    data = body(request)
    text = (data.get("text") or "").strip()
    if not text:
        return err("Texte requis")
    priority = data.get("priority")
    if priority not in ("low", "medium", "high"):
        priority = "medium"
    Todo.objects.create(text=text, priority=priority)
    return state_response()


@csrf_exempt
def todo_toggle(request, pk):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    t = get_object_or_404(Todo, pk=pk)
    t.completed = not t.completed
    t.save()
    return state_response()


@csrf_exempt
def todo_detail(request, pk):
    if request.method != "DELETE":
        return HttpResponseNotAllowed(["DELETE"])
    get_object_or_404(Todo, pk=pk).delete()
    return state_response()


# ----------------------------------------------------------------------------
# Commandes (prise de commande -> décrémente le stock)
# ----------------------------------------------------------------------------
@csrf_exempt
def orders(request):
    """POST : créer une commande. body: {label, lines:[{item_id, qty}, ...]}"""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    data = body(request)
    label = (data.get("label") or "").strip()
    raw_lines = data.get("lines") or []

    # Regroupe les quantités par article
    req = {}
    for ln in raw_lines:
        iid = str(ln.get("item_id"))
        q = to_int(ln.get("qty"), 0)
        if q > 0:
            req[iid] = req.get(iid, 0) + q
    if not req:
        return err("Commande vide")

    items_map = {str(i.id): i for i in Item.objects.filter(id__in=list(req.keys()))}

    # Validation du stock AVANT toute modification
    for iid, q in req.items():
        it = items_map.get(iid)
        if not it:
            return err("Article introuvable")
        if q > it.quantity:
            return err(f"Stock insuffisant pour {it.name} ({it.quantity} en stock)")

    with transaction.atomic():
        order = Order.objects.create(label=label)
        total = Decimal(0)
        for iid, q in req.items():
            it = items_map[iid]
            before = it.quantity
            it.quantity = before - q
            it.save()
            line_total = Decimal(q) * it.price
            OrderLine.objects.create(
                order=order, item=it, item_name=it.name, qty=q,
                unit_price=it.price, line_total=line_total,
            )
            note = f"Commande #{order.id}" + (f" — {label}" if label else "")
            Movement.objects.create(
                item=it, item_name=it.name, type="out", qty=q,
                before=before, after=it.quantity, note=note, value=line_total,
            )
            total += line_total
        order.total = total
        order.save()

    return state_response()


@csrf_exempt
def order_detail(request, pk):
    """DELETE : supprimer l'enregistrement d'une commande (ne restocke pas)."""
    if request.method != "DELETE":
        return HttpResponseNotAllowed(["DELETE"])
    get_object_or_404(Order, pk=pk).delete()
    return state_response()


# ----------------------------------------------------------------------------
# Archives
# ----------------------------------------------------------------------------
@csrf_exempt
def archive_run(request):
    """POST : archiver la journée du jour (bouton manuel)."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    archive_day(timezone.localdate())
    return state_response()


@csrf_exempt
def archive_detail(request, pk):
    """GET : contenu complet de l'archive (pour affichage). DELETE : supprimer."""
    a = get_object_or_404(Archive, pk=pk)
    if request.method == "GET":
        data = dict(a.content or {})
        data["id"] = a.id
        data["day"] = a.day.isoformat()
        return JsonResponse(data)
    if request.method == "DELETE":
        a.delete()
        return state_response()
    return HttpResponseNotAllowed(["GET", "DELETE"])


def archive_pdf(request, pk):
    """GET : page imprimable de l'archive (historique + inventaire) -> PDF via le navigateur."""
    a = get_object_or_404(Archive, pk=pk)
    c = a.content or {}
    moves = c.get("movements", [])
    stock = c.get("stock", [])
    type_fr = {"in": "Entrée", "create": "Création", "out": "Sortie",
               "delete": "Suppression", "reset": "Réinitialisation"}
    gen = timezone.localtime().strftime("%d/%m/%Y %H:%M")

    mv_rows = ""
    for m in moves:
        sign = "+" if m.get("type") in ("in", "create") else ("-" if m.get("type") == "out" else "")
        cls = "pos" if m.get("type") in ("in", "create") else ("neg" if m.get("type") == "out" else "")
        val = fr_money(m.get("value")) if (m.get("value") or 0) > 0 else "—"
        mv_rows += (
            "<tr>"
            f"<td class='hr'>{escape(m.get('time', ''))}</td>"
            f"<td class='nm'>{escape(m.get('item', '—'))}</td>"
            f"<td>{type_fr.get(m.get('type'), m.get('type'))}</td>"
            f"<td>{escape(m.get('note', ''))}</td>"
            f"<td class='r {cls}'>{sign}{m.get('qty', 0)}</td>"
            f"<td class='r'>{m.get('after', '')}</td>"
            f"<td class='r'>{val}</td>"
            "</tr>"
        )
    if not mv_rows:
        mv_rows = "<tr><td colspan='7' class='empty'>Aucun mouvement ce jour-là</td></tr>"

    stock_total = 0
    st_rows = ""
    for s in stock:
        stock_total += float(s.get("value") or 0)
        st_rows += (
            "<tr>"
            f"<td class='nm'>{escape(s.get('name', ''))}</td>"
            f"<td class='r'>{s.get('quantity', 0)}</td>"
            f"<td class='r'>{fr_money(s.get('price'))}</td>"
            f"<td class='r'>{fr_money(s.get('value'))}</td>"
            "</tr>"
        )
    if not st_rows:
        st_rows = "<tr><td colspan='4' class='empty'>Inventaire vide</td></tr>"

    s = c.get("summary", {})
    css = (
        "*{box-sizing:border-box}"
        "body{font-family:'Segoe UI',Arial,sans-serif;color:#1c3e55;margin:26px}"
        ".head{border-bottom:3px solid #ffd700;padding-bottom:12px;margin-bottom:16px}"
        ".brand{color:#b8920a;font-weight:700;letter-spacing:1px;font-size:11px}"
        ".head h1{margin:2px 0;font-size:19px}"
        ".sub{color:#5a6b7e;font-size:12px}"
        ".totals{display:flex;gap:10px;margin:14px 0;flex-wrap:wrap}"
        ".totals div{border:1px solid #e0e6ee;border-radius:8px;padding:7px 14px;font-size:12px}"
        ".totals b{display:block;font-size:15px;margin-top:2px}"
        ".totals .in b{color:#2f855a}.totals .out b{color:#c53030}.totals .val b{color:#b8920a}"
        "h2{font-size:13px;margin:18px 0 6px;border-bottom:2px solid #e8edf5;padding-bottom:5px}"
        "table{width:100%;border-collapse:collapse;font-size:11px}"
        "th{text-align:left;background:#f4f7fb;color:#5a6b7e;text-transform:uppercase;font-size:9px;letter-spacing:.4px;padding:6px 8px;border-bottom:1px solid #dce3ec}"
        "td{padding:5px 8px;border-bottom:1px solid #eef2f7}"
        "td.nm{font-weight:700}.hr{font-weight:700;color:#1c3e55}"
        "td.r,th.r{text-align:right}td.pos{color:#2f855a;font-weight:700}td.neg{color:#c53030;font-weight:700}"
        ".empty{color:#9aa7b6;text-align:center;padding:14px}"
        ".tot-row td{font-weight:800;border-top:2px solid #dce3ec}"
        ".foot{margin-top:20px;font-size:10px;color:#9aa7b6;border-top:1px solid #e8edf5;padding-top:8px}"
        "@media print{body{margin:12px}tr{break-inside:avoid}}"
    )
    html = (
        "<!DOCTYPE html><html lang='fr'><head><meta charset='UTF-8'>"
        f"<title>Archive {a.day} - BarStock</title><style>{css}</style></head><body>"
        "<div class='head'><div class='brand'>BARSTOCK PRO</div>"
        f"<h1>Archive — {fr_date(a.day)}</h1>"
        f"<div class='sub'>Inventaire & historique de la journée · édité le {gen}</div></div>"
        "<div class='totals'>"
        f"<div class='in'>Entrées<b>+{s.get('in', 0)}</b></div>"
        f"<div class='out'>Sorties<b>-{s.get('out', 0)}</b></div>"
        f"<div class='val'>Ventes du jour<b>{fr_money(s.get('sales_value'))}</b></div>"
        f"<div>Mouvements<b>{s.get('count', 0)}</b></div></div>"
        "<h2>Historique de la journée (avec heures)</h2>"
        "<table><thead><tr><th>Heure</th><th>Article</th><th>Type</th><th>Motif</th>"
        "<th class='r'>Qté</th><th class='r'>Stock</th><th class='r'>Montant</th></tr></thead>"
        f"<tbody>{mv_rows}</tbody></table>"
        "<h2>Inventaire (stock au moment de l'archivage)</h2>"
        "<table><thead><tr><th>Article</th><th class='r'>En stock</th>"
        "<th class='r'>Prix unit.</th><th class='r'>Valeur</th></tr></thead>"
        f"<tbody>{st_rows}"
        f"<tr class='tot-row'><td>Total</td><td></td><td></td><td class='r'>{fr_money(stock_total)}</td></tr>"
        "</tbody></table>"
        f"<div class='foot'>BarStock Pro — document généré le {gen}</div>"
        "<script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>"
        "</body></html>"
    )
    return HttpResponse(html)


def archive_download(request, pk):
    """GET : télécharge l'archive (CSV : historique du jour + inventaire)."""
    a = get_object_or_404(Archive, pk=pk)
    resp = HttpResponse(content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="barstock_{a.day}.csv"'
    resp.write("﻿")  # BOM pour Excel
    w = csv.writer(resp, delimiter=";")
    w.writerow(["Historique du", a.day.isoformat()])
    w.writerow(["Entrees", a.total_in, "Sorties", a.total_out, "Ventes (XAF)", float(a.sales_value)])
    w.writerow([])
    w.writerow(["Heure", "Article", "Type", "Motif", "Quantite", "Stock apres", "Montant (XAF)"])
    type_fr = {"in": "Entree", "create": "Creation", "out": "Sortie",
               "delete": "Suppression", "reset": "Reinitialisation"}
    for m in a.content.get("movements", []):
        w.writerow([m.get("time"), m.get("item"), type_fr.get(m.get("type"), m.get("type")),
                    m.get("note"), m.get("qty"), m.get("after"), m.get("value")])
    w.writerow([])
    w.writerow(["Inventaire (stock au moment de l'archive)"])
    w.writerow(["Article", "Quantite", "Prix unit. (XAF)", "Valeur (XAF)"])
    for s in a.content.get("stock", []):
        w.writerow([s.get("name"), s.get("quantity"), s.get("price"), s.get("value")])
    return resp
