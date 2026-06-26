import json

from django.contrib.auth.models import User
from django.test import TestCase

from .models import Bar, Profile, Item, Order, PendingOrder, DEFAULT_CATEGORIES


class SaasMultiBarTests(TestCase):
    """Vérifie le multi-tenant : inscription, isolation, auth API et rôles."""

    def _signup(self, bar_name, email, password="motdepasse"):
        return self.client.post("/signup/", {
            "bar_name": bar_name, "email": email,
            "password1": password, "password2": password,
        })

    def _create_item(self, name, qty=5, price=1000):
        return self.client.post(
            "/api/items/",
            data=json.dumps({"name": name, "quantity": qty, "price": price}),
            content_type="application/json",
        )

    # ---- Accès public / auth ------------------------------------------------
    def test_landing_is_public(self):
        self.assertEqual(self.client.get("/").status_code, 200)

    def test_api_requires_auth(self):
        r = self.client.get("/api/state/")
        self.assertEqual(r.status_code, 401)

    # ---- Inscription d'un gérant -------------------------------------------
    def test_signup_creates_bar_user_profile_and_logs_in(self):
        r = self._signup("Le Phénix", "phenix@bar.cm")
        self.assertRedirects(r, "/dashboard/", fetch_redirect_response=False)
        user = User.objects.get(username="phenix@bar.cm")
        self.assertEqual(user.profile.role, "gerant")
        self.assertEqual(user.profile.bar.name, "Le Phénix")
        # connecté : le dashboard répond 200
        self.assertEqual(self.client.get("/dashboard/").status_code, 200)

    # ---- Isolation des données entre bars ----------------------------------
    def test_data_is_isolated_between_bars(self):
        # Bar A
        self._signup("Le Phénix", "phenix@bar.cm")
        self._create_item("Whisky")
        state_a = self.client.get("/api/state/").json()
        self.assertEqual([i["name"] for i in state_a["items"]], ["Whisky"])
        self.client.post("/logout/")

        # Bar B : ne voit rien du bar A
        self._signup("Le Baobab", "baobab@bar.cm")
        state_b = self.client.get("/api/state/").json()
        self.assertEqual(state_b["items"], [])
        self._create_item("Gin")
        state_b = self.client.get("/api/state/").json()
        self.assertEqual([i["name"] for i in state_b["items"]], ["Gin"])

        # Même nom d'article autorisé dans deux bars différents
        self.client.post("/logout/")
        self.client.login(username="phenix@bar.cm", password="motdepasse")
        self.assertEqual(self._create_item("Gin").status_code, 200)

    def test_cannot_touch_other_bar_item(self):
        self._signup("Le Phénix", "phenix@bar.cm")
        self._create_item("Whisky")
        item_id = Item.objects.get(name="Whisky", bar__slug="le-phenix").id
        self.client.post("/logout/")

        self._signup("Le Baobab", "baobab@bar.cm")
        r = self.client.post(
            f"/api/items/{item_id}/move/",
            data=json.dumps({"type": "out", "qty": 1}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 404)

    # ---- Rôles : gérant vs serveur -----------------------------------------
    def test_serveur_cannot_access_dashboard(self):
        self._signup("Le Phénix", "phenix@bar.cm")
        bar = Bar.objects.get(slug="le-phenix")
        # le gérant crée un serveur
        self.client.post("/equipe/", {"username": "serveur1", "password": "1234"})
        self.assertTrue(Profile.objects.filter(user__username="serveur1", role="serveur", bar=bar).exists())
        self.client.post("/logout/")

        # le serveur : caisse OK, dashboard -> redirigé vers la caisse
        self.client.login(username="serveur1", password="1234")
        self.assertEqual(self.client.get("/caisse/").status_code, 200)
        self.assertRedirects(self.client.get("/dashboard/"), "/caisse/", fetch_redirect_response=False)
        # et il ne peut pas gérer l'équipe
        self.assertRedirects(self.client.get("/equipe/"), "/caisse/", fetch_redirect_response=False)

    # ---- Une commande décrémente bien le stock (scopé) ---------------------
    def test_order_decrements_stock(self):
        self._signup("Le Phénix", "phenix@bar.cm")
        self._create_item("Bière", qty=10, price=500)
        item_id = Item.objects.get(name="Bière").id
        r = self.client.post(
            "/api/orders/",
            data=json.dumps({"label": "Table 3", "lines": [{"item_id": str(item_id), "qty": 4}]}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Item.objects.get(id=item_id).quantity, 6)
        self.assertEqual(Order.objects.count(), 1)


class QrOrderingTests(TestCase):
    """Commande client par QR : menu public, file d'attente, validation, isolation."""

    def setUp(self):
        self.client.post("/signup/", {
            "bar_name": "Le Phénix", "email": "phenix@bar.cm",
            "password1": "motdepasse", "password2": "motdepasse",
        })
        self.bar = Bar.objects.get(slug="le-phenix")
        self.token = self.bar.public_token
        # un article en stock + un en rupture (l'API force qty>=1, on remet Eau à 0)
        self._item("Bière", qty=10, price=500)
        self._item("Eau", qty=1, price=300)
        Item.objects.filter(name="Eau", bar=self.bar).update(quantity=0)
        self.beer_id = Item.objects.get(name="Bière", bar=self.bar).id

    def _item(self, name, qty, price):
        return self.client.post(
            "/api/items/",
            data=json.dumps({"name": name, "quantity": qty, "price": price}),
            content_type="application/json",
        )

    def test_public_menu_state_lists_only_in_stock(self):
        self.client.post("/logout/")  # le menu est public, sans session
        r = self.client.get(f"/menu/{self.token}/state/")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["bar"], "Le Phénix")
        self.assertEqual([i["name"] for i in data["items"]], ["Bière"])  # "Eau" (rupture) exclue

    def test_client_order_creates_pending_without_touching_stock(self):
        self.client.post("/logout/")
        r = self.client.post(
            f"/menu/{self.token}/order/",
            data=json.dumps({"table": "5", "lines": [{"item_id": str(self.beer_id), "qty": 3}]}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json().get("ok"))
        # commande en attente créée, stock intact
        self.assertEqual(PendingOrder.objects.filter(bar=self.bar, status="pending").count(), 1)
        self.assertEqual(Item.objects.get(id=self.beer_id).quantity, 10)
        # visible dans l'état de la caisse
        self.client.login(username="phenix@bar.cm", password="motdepasse")
        state = self.client.get("/api/state/").json()
        self.assertEqual(len(state["pending"]), 1)
        self.assertEqual(state["pending"][0]["table"], "5")

    def test_accept_decrements_stock_and_creates_order(self):
        self.client.post("/logout/")
        self.client.post(
            f"/menu/{self.token}/order/",
            data=json.dumps({"table": "5", "lines": [{"item_id": str(self.beer_id), "qty": 3}]}),
            content_type="application/json",
        )
        po = PendingOrder.objects.get(bar=self.bar)
        self.client.login(username="phenix@bar.cm", password="motdepasse")
        r = self.client.post(f"/api/pending/{po.id}/accept/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Item.objects.get(id=self.beer_id).quantity, 7)  # 10 - 3
        self.assertEqual(Order.objects.filter(bar=self.bar).count(), 1)
        po.refresh_from_db()
        self.assertEqual(po.status, "done")
        # plus aucune commande en attente
        self.assertEqual(self.client.get("/api/state/").json()["pending"], [])

    def test_reject_leaves_stock_untouched(self):
        self.client.post("/logout/")
        self.client.post(
            f"/menu/{self.token}/order/",
            data=json.dumps({"lines": [{"item_id": str(self.beer_id), "qty": 3}]}),
            content_type="application/json",
        )
        po = PendingOrder.objects.get(bar=self.bar)
        self.client.login(username="phenix@bar.cm", password="motdepasse")
        self.client.post(f"/api/pending/{po.id}/reject/")
        po.refresh_from_db()
        self.assertEqual(po.status, "rejected")
        self.assertEqual(Item.objects.get(id=self.beer_id).quantity, 10)
        self.assertEqual(Order.objects.filter(bar=self.bar).count(), 0)

    def test_other_bar_cannot_accept_pending(self):
        self.client.post("/logout/")
        self.client.post(
            f"/menu/{self.token}/order/",
            data=json.dumps({"lines": [{"item_id": str(self.beer_id), "qty": 2}]}),
            content_type="application/json",
        )
        po = PendingOrder.objects.get(bar=self.bar)
        # un autre bar ne peut pas valider la commande du Phénix
        self.client.post("/signup/", {
            "bar_name": "Le Baobab", "email": "baobab@bar.cm",
            "password1": "motdepasse", "password2": "motdepasse",
        })
        r = self.client.post(f"/api/pending/{po.id}/accept/")
        self.assertEqual(r.status_code, 404)
        po.refresh_from_db()
        self.assertEqual(po.status, "pending")  # inchangée


class EstablishmentTypeCategoryTests(TestCase):
    """Type d'établissement (cave/bar/restaurant) + catégories d'articles."""

    def _signup(self, name, email, etype):
        return self.client.post("/signup/", {
            "bar_name": name, "type": etype, "email": email,
            "password1": "motdepasse", "password2": "motdepasse",
        })

    def _item(self, name, category="", qty=5, price=1000):
        return self.client.post(
            "/api/items/",
            data=json.dumps({"name": name, "category": category, "quantity": qty, "price": price}),
            content_type="application/json",
        )

    def test_signup_sets_type(self):
        self._signup("Chez Resto", "resto@x.cm", "restaurant")
        self.assertEqual(Bar.objects.get(slug="chez-resto").type, "restaurant")

    def test_category_saved_and_served(self):
        self._signup("Chez Resto", "resto@x.cm", "restaurant")
        self._item("Poulet DG", category="Plats")
        state = self.client.get("/api/state/").json()
        item = next(i for i in state["items"] if i["name"] == "Poulet DG")
        self.assertEqual(item["category"], "Plats")
        # présent aussi sur le menu public
        token = Bar.objects.get(slug="chez-resto").public_token
        self.client.post("/logout/")
        menu = self.client.get(f"/menu/{token}/state/").json()
        self.assertEqual(next(i for i in menu["items"] if i["name"] == "Poulet DG")["category"], "Plats")

    def test_menu_state_returns_default_categories_for_type(self):
        self._signup("Chez Resto", "resto@x.cm", "restaurant")
        token = Bar.objects.get(slug="chez-resto").public_token
        self.client.post("/logout/")
        cats = self.client.get(f"/menu/{token}/state/").json()["categories"]
        # les catégories par défaut du restaurant sont en tête
        for c in DEFAULT_CATEGORIES["restaurant"]:
            self.assertIn(c, cats)

    def test_item_category_endpoint_updates_and_is_scoped(self):
        self._signup("Le Phénix", "phenix@x.cm", "bar")
        self._item("Coca", category="Boissons")
        item_id = Item.objects.get(name="Coca", bar__slug="le-phenix").id
        r = self.client.post(
            f"/api/items/{item_id}/category/",
            data=json.dumps({"category": "Sans alcool"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Item.objects.get(id=item_id).category, "Sans alcool")
        # un autre bar ne peut pas modifier cet article
        self.client.post("/logout/")
        self._signup("Le Baobab", "baobab@x.cm", "bar")
        r = self.client.post(
            f"/api/items/{item_id}/category/",
            data=json.dumps({"category": "Pirate"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 404)

    def test_reglages_changes_type(self):
        self._signup("Le Phénix", "phenix@x.cm", "bar")
        r = self.client.post("/reglages/", {"name": "Le Phénix", "type": "bar_resto"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Bar.objects.get(slug="le-phenix").type, "bar_resto")


class AdminModalApiTests(TestCase):
    """Endpoints JSON des modales du dashboard (Réglages / Équipe / QR)."""

    def setUp(self):
        self.client.post("/signup/", {
            "bar_name": "Le Phénix", "type": "bar", "email": "phenix@x.cm",
            "password1": "motdepasse", "password2": "motdepasse",
        })
        self.bar = Bar.objects.get(slug="le-phenix")

    def test_settings_api_get_and_post(self):
        r = self.client.get("/api/settings/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["type"], "bar")
        r = self.client.post("/api/settings/", data=json.dumps({"name": "Le Phénix", "type": "restaurant"}),
                             content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Bar.objects.get(slug="le-phenix").type, "restaurant")

    def test_team_api_create_list_delete(self):
        r = self.client.post("/api/team/", data=json.dumps({"username": "serveur1", "password": "1234"}),
                             content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([s["username"] for s in r.json()["serveurs"]], ["serveur1"])
        sid = Profile.objects.get(user__username="serveur1").id
        r = self.client.delete(f"/api/team/{sid}/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["serveurs"], [])

    def test_qrcodes_api_returns_data_uris(self):
        r = self.client.get("/api/qrcodes/?n=4")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(data["n"], 4)
        self.assertEqual(len(data["tables"]), 4)
        self.assertTrue(data["tables"][0]["qr"].startswith("data:image/png;base64,"))

    def test_admin_api_forbidden_for_serveur(self):
        self.client.post("/api/team/", data=json.dumps({"username": "serv", "password": "1234"}),
                         content_type="application/json")
        self.client.post("/logout/")
        self.client.login(username="serv", password="1234")
        self.assertEqual(self.client.get("/api/settings/").status_code, 403)
        self.assertEqual(self.client.get("/api/team/").status_code, 403)
        self.assertEqual(self.client.get("/api/qrcodes/").status_code, 403)


class ServeurLoginTests(TestCase):
    """Accès dédié serveur : /serveur/ ouvre directement la caisse."""

    def setUp(self):
        self.client.post("/signup/", {
            "bar_name": "Le Phénix", "type": "bar", "email": "phenix@x.cm",
            "password1": "motdepasse", "password2": "motdepasse",
        })
        self.client.post("/equipe/", {"username": "serveur1", "password": "1234"})
        self.client.post("/logout/")

    def test_serveur_login_page_renders(self):
        r = self.client.get("/serveur/")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "Espace serveur")

    def test_serveur_login_redirects_to_caisse(self):
        r = self.client.post("/serveur/", {"username": "serveur1", "password": "1234"})
        self.assertRedirects(r, "/caisse/", fetch_redirect_response=False)
        self.assertEqual(self.client.get("/caisse/").status_code, 200)

    def test_serveur_login_bad_credentials(self):
        r = self.client.post("/serveur/", {"username": "serveur1", "password": "nope"})
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "incorrect")

    def test_serveur_login_redirects_when_authenticated(self):
        self.client.login(username="serveur1", password="1234")
        self.assertRedirects(self.client.get("/serveur/"), "/caisse/", fetch_redirect_response=False)
