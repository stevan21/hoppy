/* ============================================================================
 * BarStock — Couche hors ligne (PWA)
 * ----------------------------------------------------------------------------
 * Objectif : permettre à l'app (admin + caisse) de continuer à fonctionner
 * sans connexion réseau, puis de se resynchroniser automatiquement.
 *
 * Principe : CHAQUE écriture serveur renvoie l'état complet, que le front
 * ré-applique. On peut donc, hors ligne, produire localement le même « état
 * complet » via un reducer qui imite la logique du serveur. L'interface ne
 * voit aucune différence : qu'il vienne du serveur ou du cache local, c'est
 * toujours un objet `state` que `applyState()` consomme.
 *
 * Expose `window.BarStock` :
 *   - api(method, path, payload)  -> Promise<state | data>   (compatible apiCall)
 *   - upload(path, fields, file)  -> Promise<state>          (création multipart)
 *   - flush()                     -> Promise<bool>           (forcer la synchro)
 *   - pendingCount()              -> nombre d'écritures en attente
 *
 * Émet `window`-event `barstock:state` (detail = state) après une resynchro
 * en arrière-plan, pour que les pages se redessinent.
 * ==========================================================================*/
(function () {
  "use strict";

  var API = "/api";
  // Cloisonnement par bar (tenant) : chaque bar a son propre cache local, pour
  // qu'aucune donnée ne fuite entre deux comptes utilisant le même navigateur.
  var TENANT = (typeof window.BS_CACHE_KEY !== "undefined" && window.BS_CACHE_KEY) ? String(window.BS_CACHE_KEY) : "anon";
  var SUFFIX = "_b" + TENANT;
  var K_STATE = "barstock_state_v1" + SUFFIX;   // dernier état complet connu
  var K_QUEUE = "barstock_queue_v1" + SUFFIX;   // écritures en attente de synchro
  var K_IDMAP = "barstock_idmap_v1" + SUFFIX;   // id temporaires -> id réels (après synchro)

  // ---- Persistance (localStorage) -----------------------------------------
  function readJSON(k, d) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch (e) { return d; } }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function getState() { return readJSON(K_STATE, null); }
  function setState(s) { writeJSON(K_STATE, s); }
  function getQueue() { return readJSON(K_QUEUE, []); }
  function setQueue(q) { writeJSON(K_QUEUE, q); refreshIndicator(); }
  function getIdMap() { return readJSON(K_IDMAP, {}); }
  function setIdMap(m) { writeJSON(K_IDMAP, m); }

  var seq = 0;
  function uid() { return "tmp_" + Date.now().toString(36) + "_" + (seq++); }
  function isTmp(id) { return typeof id === "string" && id.indexOf("tmp_") === 0; }

  // État de connexion (meilleure estimation, basée sur les vrais échecs réseau)
  var online = (typeof navigator.onLine === "boolean") ? navigator.onLine : true;

  // ---- Utilitaires --------------------------------------------------------
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function isNetworkError(err) {
    // fetch() rejette avec TypeError quand le réseau est indisponible.
    // Nos erreurs serveur (HTTP != ok) portent err.server = true.
    return !err || err.server !== true;
  }

  function handleRes(res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) {
        var e = new Error(data.error || ("Erreur serveur (" + res.status + ")"));
        e.server = true;
        throw e;
      }
      return data;
    });
  }

  function setOnline(v) {
    if (online !== v) { online = v; refreshIndicator(); }
    else online = v;
  }

  function emitState(state) {
    try { window.dispatchEvent(new CustomEvent("barstock:state", { detail: state })); } catch (e) {}
  }

  // ---- Reducer : applique une écriture à un état cloné --------------------
  // Reproduit la logique de inventory/views.py. Mute `s` (déjà cloné).
  // Retourne { error } en cas de refus, ou { meta } (infos pour la file).
  function reIdFrom(path, re) { var m = path.match(re); return m ? m[1] : null; }

  function findItem(s, id) { for (var i = 0; i < s.items.length; i++) if (s.items[i].id === id) return s.items[i]; return null; }
  function findItemByName(s, name) {
    var n = (name || "").toLowerCase();
    for (var i = 0; i < s.items.length; i++) if ((s.items[i].name || "").toLowerCase() === n) return s.items[i];
    return null;
  }
  function sortItems(s) { s.items.sort(function (a, b) { return (a.name || "").localeCompare(b.name || "", "fr"); }); }
  function pushMove(s, m) {
    m.id = uid(); m.ts = Date.now();
    s.movements.push(m); // chronologique : du + ancien au + récent
  }
  function toInt(v, d) { var n = parseInt(v, 10); return isNaN(n) ? (d || 0) : n; }
  function toPrice(v) { var n = parseFloat(String(v).replace(",", ".")); return (isNaN(n) || n < 0) ? 0 : n; }

  function reduce(method, path, payload, s) {
    payload = payload || {};
    s.items = s.items || []; s.movements = s.movements || [];
    s.todos = s.todos || []; s.orders = s.orders || []; s.archives = s.archives || [];

    // --- Articles : créer / réapprovisionner ---
    if (method === "POST" && path === "/items/") {
      var name = (payload.name || "").trim();
      if (!name) return { error: "Nom requis" };
      var qty = toInt(payload.quantity, 1); if (qty < 1) qty = 1;
      var price = toPrice(payload.price);
      var category = (payload.category || "").trim();
      var existing = findItemByName(s, name);
      if (existing) {
        var before = existing.quantity || 0;
        existing.quantity = before + qty;
        if (price > 0) existing.price = price;
        if (category) existing.category = category;
        if (payload.image) existing.image = payload.image;
        pushMove(s, { itemId: existing.id, itemName: existing.name, type: "in", qty: qty,
          before: before, after: existing.quantity, note: "Réapprovisionnement", value: qty * existing.price });
        return { meta: {} };
      }
      var nid = uid();
      var it = { id: nid, name: name, quantity: qty, price: price, category: category, image: payload.image || "" };
      s.items.push(it); sortItems(s);
      pushMove(s, { itemId: nid, itemName: name, type: "create", qty: qty,
        before: 0, after: qty, note: "Création article", value: qty * price });
      return { meta: { tmpItemId: nid, itemName: name } };
    }

    // --- Article : mouvement entrée/sortie ---
    var idm = reIdFrom(path, /^\/items\/([^/]+)\/move\/$/);
    if (method === "POST" && idm) {
      var item = findItem(s, idm);
      if (!item) return { error: "Article introuvable" };
      var t = payload.type;
      if (t !== "in" && t !== "out") return { error: "Type invalide" };
      var q = toInt(payload.qty, 0);
      if (q < 1) return { error: "Quantité invalide" };
      var b = item.quantity || 0;
      if (t === "out" && q > b) return { error: "Sortie impossible : seulement " + b + " en stock" };
      item.quantity = t === "in" ? b + q : b - q;
      pushMove(s, { itemId: item.id, itemName: item.name, type: t, qty: q,
        before: b, after: item.quantity, note: (payload.note || "").trim() || (t === "in" ? "Réapprovisionnement" : "Sortie"),
        value: q * (item.price || 0) });
      return { meta: {} };
    }

    // --- Article : prix ---
    var idp = reIdFrom(path, /^\/items\/([^/]+)\/price\/$/);
    if (method === "POST" && idp) {
      var ip = findItem(s, idp);
      if (!ip) return { error: "Article introuvable" };
      ip.price = toPrice(payload.price);
      return { meta: {} };
    }

    // --- Article : suppression ---
    var idd = reIdFrom(path, /^\/items\/([^/]+)\/$/);
    if (method === "DELETE" && idd) {
      var del = findItem(s, idd);
      if (!del) return { error: "Article introuvable" };
      pushMove(s, { itemId: null, itemName: del.name, type: "delete", qty: del.quantity || 0,
        before: del.quantity || 0, after: 0, note: "Article supprimé", value: (del.quantity || 0) * (del.price || 0) });
      s.items = s.items.filter(function (x) { return x.id !== idd; });
      return { meta: {} };
    }

    // --- Réinitialiser le stock ---
    if (method === "POST" && path === "/reset/") {
      var c = s.items.length;
      if (c) {
        pushMove(s, { itemId: null, itemName: "— Inventaire —", type: "reset", qty: c,
          before: 0, after: 0, note: c + " articles supprimés", value: 0 });
        s.items = [];
      }
      return { meta: {} };
    }

    // --- Vider l'historique ---
    if (method === "POST" && path === "/history/clear/") { s.movements = []; return { meta: {} }; }

    // --- Tâches ---
    if (method === "POST" && path === "/todos/") {
      var txt = (payload.text || "").trim();
      if (!txt) return { error: "Texte requis" };
      var pr = payload.priority; if (pr !== "low" && pr !== "medium" && pr !== "high") pr = "medium";
      s.todos.push({ id: uid(), text: txt, completed: false, priority: pr });
      return { meta: {} };
    }
    var idt = reIdFrom(path, /^\/todos\/([^/]+)\/toggle\/$/);
    if (method === "POST" && idt) {
      for (var i = 0; i < s.todos.length; i++) if (s.todos[i].id === idt) { s.todos[i].completed = !s.todos[i].completed; break; }
      return { meta: {} };
    }
    var idtd = reIdFrom(path, /^\/todos\/([^/]+)\/$/);
    if (method === "DELETE" && idtd) { s.todos = s.todos.filter(function (x) { return x.id !== idtd; }); return { meta: {} }; }

    // --- Commandes : prise de commande -> décrémente le stock ---
    if (method === "POST" && path === "/orders/") {
      var label = (payload.label || "").trim();
      var raw = payload.lines || [];
      var req = {};
      for (var L = 0; L < raw.length; L++) {
        var iid = String(raw[L].item_id);
        var lq = toInt(raw[L].qty, 0);
        if (lq > 0) req[iid] = (req[iid] || 0) + lq;
      }
      var keys = Object.keys(req);
      if (!keys.length) return { error: "Commande vide" };
      // Validation du stock AVANT toute modification
      for (var k = 0; k < keys.length; k++) {
        var oi = findItem(s, keys[k]);
        if (!oi) return { error: "Article introuvable" };
        if (req[keys[k]] > (oi.quantity || 0)) return { error: "Stock insuffisant pour " + oi.name + " (" + oi.quantity + " en stock)" };
      }
      var oid = uid();
      var order = { id: oid, label: label, ts: Date.now(), total: 0, lines: [] };
      var total = 0;
      for (var z = 0; z < keys.length; z++) {
        var oit = findItem(s, keys[z]);
        var ob = oit.quantity || 0;
        var oq = req[keys[z]];
        oit.quantity = ob - oq;
        var lt = oq * (oit.price || 0);
        order.lines.push({ name: oit.name, qty: oq, unit_price: oit.price || 0, line_total: lt });
        pushMove(s, { itemId: oit.id, itemName: oit.name, type: "out", qty: oq, before: ob, after: oit.quantity,
          note: "Commande" + (label ? " — " + label : ""), value: lt });
        total += lt;
      }
      order.total = total;
      s.orders.unshift(order); // plus récente en premier
      return { meta: { tmpOrderId: oid } };
    }
    var ido = reIdFrom(path, /^\/orders\/([^/]+)\/$/);
    if (method === "DELETE" && ido) { s.orders = s.orders.filter(function (x) { return x.id !== ido; }); return { meta: {} }; }

    // --- Archives (synchro déléguée au serveur ; effet local minimal) ---
    if (method === "POST" && path === "/archive/run/") { return { meta: {} }; }
    var ida = reIdFrom(path, /^\/archives\/([^/]+)\/$/);
    if (method === "DELETE" && ida) { s.archives = s.archives.filter(function (x) { return String(x.id) !== String(ida); }); return { meta: {} }; }

    return { error: "Action non disponible hors ligne" };
  }

  // ---- File d'attente -----------------------------------------------------
  function enqueue(entry) { var q = getQueue(); q.push(entry); setQueue(q); }
  function dropFromQueue(id) { setQueue(getQueue().filter(function (e) { return e.id !== id; })); }

  // Annule une création encore en attente (suppression d'une entité créée hors ligne)
  function cancelPendingCreate(tmpId) {
    var q = getQueue();
    var found = false;
    q = q.filter(function (e) {
      if (e.meta && (e.meta.tmpItemId === tmpId || e.meta.tmpOrderId === tmpId)) { found = true; return false; }
      // retire aussi les opérations qui ciblaient cette entité temporaire
      if (e.path && e.path.indexOf(tmpId) !== -1) { found = true; return false; }
      return true;
    });
    if (found) setQueue(q);
    return found;
  }

  // ---- Synchronisation (rejoue la file dans l'ordre) ----------------------
  function dataURLtoBlob(durl) {
    var parts = durl.split(",");
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
    var bin = atob(parts[1]); var n = bin.length; var u8 = new Uint8Array(n);
    while (n--) u8[n] = bin.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  function remapPath(path) {
    var m = getIdMap();
    Object.keys(m).forEach(function (tmp) { if (path.indexOf(tmp) !== -1) path = path.split(tmp).join(m[tmp]); });
    return path;
  }
  function remapPayload(payload) {
    if (!payload) return payload;
    var m = getIdMap();
    if (payload.lines) {
      payload = clone(payload);
      payload.lines.forEach(function (l) { var k = String(l.item_id); if (m[k]) l.item_id = m[k]; });
    }
    return payload;
  }
  function learnIdMap(entry, state) {
    if (!entry.meta || !entry.meta.tmpItemId || !entry.meta.itemName) return;
    var real = findItemByName(state, entry.meta.itemName);
    if (real) { var m = getIdMap(); m[entry.meta.tmpItemId] = String(real.id); setIdMap(m); }
  }

  function sendEntry(entry) {
    var path = remapPath(entry.path);
    if (entry.multipart) {
      var fd = new FormData();
      Object.keys(entry.fields || {}).forEach(function (k) { fd.append(k, entry.fields[k]); });
      if (entry.imageDataUrl) { try { fd.append("image", dataURLtoBlob(entry.imageDataUrl), "photo.jpg"); } catch (e) {} }
      return fetch(API + path, { method: "POST", body: fd }).then(handleRes)
        .then(function (state) { learnIdMap(entry, state); return state; });
    }
    var payload = remapPayload(entry.payload);
    var opts = { method: entry.method, headers: {} };
    if (payload !== undefined && payload !== null) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(payload);
    }
    return fetch(API + path, opts).then(handleRes)
      .then(function (state) { learnIdMap(entry, state); return state; });
  }

  var flushing = false;
  var syncErrors = [];

  function flush() {
    if (flushing) return Promise.resolve(false);
    var q = getQueue();
    if (!q.length) return Promise.resolve(false);
    flushing = true; refreshIndicator();
    syncErrors = [];

    var STOP = {};
    var chain = q.reduce(function (p, entry) {
      return p.then(function () {
        return sendEntry(entry).then(function () {
          dropFromQueue(entry.id);
        }, function (err) {
          if (isNetworkError(err)) throw STOP;           // toujours hors ligne : on s'arrête
          dropFromQueue(entry.id);                       // refus serveur (ex. stock) : on abandonne cette op
          syncErrors.push((entry.label || "Opération") + " : " + (err.message || "refusée"));
        });
      });
    }, Promise.resolve());

    return chain.then(function () {
      // File vidée -> on récupère l'état autoritatif du serveur
      flushing = false; setOnline(true);
      return fetch(API + "/state/").then(handleRes).then(function (state) {
        setState(state); setIdMap({}); emitState(state);
        if (syncErrors.length) notify("Synchro : " + syncErrors.length + " opération(s) refusée(s)", syncErrors);
        else notify("Synchronisé ✓");
        refreshIndicator();
        return true;
      }).catch(function () { refreshIndicator(); return true; });
    }, function (stop) {
      flushing = false;
      if (stop === STOP) { setOnline(false); refreshIndicator(); return false; }
      flushing = false; refreshIndicator();
      throw stop;
    });
  }

  var flushTimer = null;
  function scheduleFlush(delay) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flush().catch(function () {}); }, delay || 400);
  }

  // ---- API publique -------------------------------------------------------
  function offlineWrite(method, path, payload, labelTxt, extra) {
    var s = getState();
    if (!s) return Promise.reject(new Error("Hors ligne : données indisponibles. Connectez-vous une première fois."));
    var ns = clone(s);
    var r = reduce(method, path, payload, ns);
    if (r.error) return Promise.reject(new Error(r.error));
    setState(ns);
    var entry = { id: uid(), method: method, path: path, payload: payload, label: labelTxt, meta: r.meta || {} };
    if (extra) { for (var k in extra) entry[k] = extra[k]; }
    enqueue(entry);
    setOnline(false);
    scheduleFlush();
    return Promise.resolve(ns);
  }

  function api(method, path, payload) {
    method = (method || "GET").toUpperCase();

    // Lecture de l'état complet
    if (method === "GET" && path === "/state/") {
      if (getQueue().length) { scheduleFlush(0); return Promise.resolve(getState()); }
      return fetch(API + "/state/").then(handleRes).then(function (state) {
        setState(state); setOnline(true);
        return state;
      }).catch(function (err) {
        if (isNetworkError(err)) {
          setOnline(false);
          var c = getState();
          if (c) return c;
        }
        throw err;
      });
    }

    // Écritures : si des opérations sont déjà en attente, on reste en mode file
    // (préserve l'ordre). Sinon on tente le réseau, repli hors ligne si échec.
    var labelTxt = labelFor(method, path);
    if (getQueue().length) return offlineWrite(method, path, payload, labelTxt);

    // Suppression d'une entité créée hors ligne (jamais synchronisée) :
    // on annule sa création en attente et on l'efface localement, SANS envoyer
    // de DELETE au serveur (l'entité n'y existe pas).
    var delId = (reIdFrom(path, /^\/items\/([^/]+)\/$/) || reIdFrom(path, /^\/orders\/([^/]+)\/$/) || reIdFrom(path, /^\/todos\/([^/]+)\/$/));
    if (method === "DELETE" && delId && isTmp(delId)) {
      cancelPendingCreate(delId);
      var sd = getState();
      if (sd) {
        var nsd = clone(sd);
        var rd = reduce(method, path, payload, nsd);
        if (rd.error) return Promise.reject(new Error(rd.error));
        setState(nsd); refreshIndicator();
        return Promise.resolve(nsd);
      }
    }

    var opts = { method: method, headers: {} };
    if (payload !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(payload); }
    return fetch(API + path, opts).then(handleRes).then(function (state) {
      setState(state); setOnline(true);
      return state;
    }).catch(function (err) {
      if (isNetworkError(err)) return offlineWrite(method, path, payload, labelTxt);
      throw err; // refus serveur réel -> remonte l'erreur
    });
  }

  // Création multipart (avec photo). app.js l'utilise pour les nouvelles boissons.
  function upload(path, fields, file) {
    function doOffline() {
      function withImage(dataUrl) {
        var payload = { name: fields.name, quantity: fields.quantity, price: fields.price, category: fields.category };
        if (dataUrl) payload.image = dataUrl;
        var s = getState();
        if (!s) return Promise.reject(new Error("Hors ligne : données indisponibles."));
        var ns = clone(s);
        var r = reduce("POST", path, payload, ns);
        if (r.error) return Promise.reject(new Error(r.error));
        setState(ns);
        enqueue({ id: uid(), multipart: true, path: path, method: "POST",
          fields: { name: fields.name, quantity: fields.quantity, price: fields.price, category: fields.category || "" },
          imageDataUrl: dataUrl || "", label: labelFor("POST", path), meta: r.meta || {} });
        setOnline(false); scheduleFlush();
        return Promise.resolve(ns);
      }
      if (file) {
        return new Promise(function (resolve, reject) {
          var fr = new FileReader();
          fr.onload = function () { withImage(fr.result).then(resolve, reject); };
          fr.onerror = function () { withImage("").then(resolve, reject); };
          fr.readAsDataURL(file);
        });
      }
      return withImage("");
    }

    if (getQueue().length) return doOffline();

    var fd = new FormData();
    Object.keys(fields).forEach(function (k) { fd.append(k, fields[k]); });
    if (file) fd.append("image", file);
    return fetch(API + path, { method: "POST", body: fd }).then(handleRes).then(function (state) {
      setState(state); setOnline(true); return state;
    }).catch(function (err) {
      if (isNetworkError(err)) return doOffline();
      throw err;
    });
  }

  function labelFor(method, path) {
    if (method === "POST" && path === "/orders/") return "Commande";
    if (method === "POST" && path === "/items/") return "Article";
    if (path.indexOf("/move/") !== -1) return "Mouvement de stock";
    if (path.indexOf("/todos/") !== -1) return "Tâche";
    return method + " " + path;
  }

  function pendingCount() { return getQueue().length; }

  // ---- Indicateur d'état (pastille flottante) -----------------------------
  var pill = null, pillTimer = null;
  function ensurePill() {
    if (pill || !document.body) return pill;
    pill = document.createElement("div");
    pill.id = "bs-net-pill";
    pill.style.cssText = [
      "position:fixed", "z-index:99998", "right:14px", "bottom:74px",
      "padding:9px 14px", "border-radius:999px", "font:600 13px/1 'Segoe UI',Arial,sans-serif",
      "color:#fff", "box-shadow:0 6px 18px rgba(0,0,0,.25)", "cursor:pointer",
      "display:none", "align-items:center", "gap:8px", "user-select:none",
      "transition:opacity .25s,transform .25s"
    ].join(";");
    pill.addEventListener("click", function () { scheduleFlush(0); });
    document.body.appendChild(pill);
    return pill;
  }

  function refreshIndicator() {
    var p = ensurePill();
    if (!p) return;
    var n = getQueue().length;
    if (n > 0) {
      p.style.display = "inline-flex";
      p.style.background = flushing ? "#2563eb" : "#d97706";
      p.textContent = (flushing ? "⟳ Synchronisation… " : "● Hors ligne — ") + n + " en attente";
    } else if (!online) {
      p.style.display = "inline-flex";
      p.style.background = "#64748b";
      p.textContent = "● Hors ligne";
    } else {
      p.style.display = "none";
    }
  }

  function notify(msg) {
    var p = ensurePill();
    if (!p) return;
    if (getQueue().length) { refreshIndicator(); return; }
    p.style.display = "inline-flex";
    p.style.background = "#16a34a";
    p.textContent = "✓ " + msg;
    clearTimeout(pillTimer);
    pillTimer = setTimeout(refreshIndicator, 2600);
  }

  // ---- Déclencheurs de synchro -------------------------------------------
  window.addEventListener("online", function () { setOnline(true); scheduleFlush(0); });
  window.addEventListener("offline", function () { setOnline(false); refreshIndicator(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && getQueue().length) scheduleFlush(0); });
  setInterval(function () { if (getQueue().length && !flushing) flush().catch(function () {}); }, 20000);

  // ---- Enregistrement du service worker (PWA, partagé par les 2 pages) ----
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  }

  document.addEventListener("DOMContentLoaded", refreshIndicator);

  window.BarStock = { api: api, upload: upload, flush: flush, pendingCount: pendingCount };
})();
