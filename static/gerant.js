(function () {
  "use strict";

  var API = "/api";
  var items = [];
  var orders = [];
  var cart = []; // {itemId, name, price, qty}
  var searchTerm = "";

  function $(id) { return document.getElementById(id); }
  function ico(id) { return '<svg class="ico"><use href="#i-' + id + '"/></svg>'; }
  function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' XAF'; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  var gMain = $('gMain');
  var navCartBadge = $('navCartBadge');
  var posGrid = $('posGrid');
  var searchInput = $('searchInput');
  var searchClear = $('searchClear');
  var cartList = $('cartList');
  var cartTotal = $('cartTotal');
  var ordersList = $('ordersList');
  var orderLabel = $('orderLabel');
  var toast = $('toast');
  var toastMsg = $('toastMsg');

  var toastTimer = null;
  function showToast(msg, dur) {
    toastMsg.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, dur || 1800);
  }

  // Passe par la couche hors ligne (cache + file d'attente + synchro auto).
  function api(method, path, payload) {
    return window.BarStock.api(method, path, payload);
  }

  function applyState(state) {
    items = state.items || [];
    orders = state.orders || [];
    renderGrid();
    renderCart();
    renderOrders();
  }

  function loadState() {
    return api('GET', '/state/').then(applyState);
  }

  // ---- Grille d'articles ----
  function cartQty(id) {
    for (var i = 0; i < cart.length; i++) { if (cart[i].itemId === id) return cart[i].qty; }
    return 0;
  }

  function renderGrid() {
    if (!items.length) { posGrid.innerHTML = '<div class="g-empty">Aucun article</div>'; return; }
    var q = searchTerm.trim().toLowerCase();
    var list = q ? items.filter(function (it) { return (it.name || '').toLowerCase().indexOf(q) !== -1; }) : items;
    if (!list.length) { posGrid.innerHTML = '<div class="g-empty">Aucun article pour « ' + esc(searchTerm) + ' »</div>'; return; }
    var html = '';
    list.forEach(function (it) {
      var out = (it.quantity || 0) <= 0;
      var inCart = cartQty(it.id);
      var photo = it.image
        ? '<span class="g-card-img" style="background-image:url(\'' + encodeURI(it.image) + '\')"></span>'
        : '<span class="g-card-img g-card-img-ph">' + esc((it.name || '?').charAt(0).toUpperCase()) + '</span>';
      html += '<button class="g-card' + (out ? ' out' : '') + (inCart ? ' active' : '') + '" data-id="' + it.id + '"' + (out ? ' disabled' : '') + '>'
        + (inCart ? '<span class="g-badge">' + inCart + '</span>' : '')
        + photo
        + '<span class="g-card-name">' + esc(it.name) + '</span>'
        + '<span class="g-card-price">' + fmt(it.price) + '</span>'
        + '<span class="g-card-stock">' + (out ? 'rupture' : 'stock ' + it.quantity) + '</span>'
        + '</button>';
    });
    posGrid.innerHTML = html;
    posGrid.querySelectorAll('.g-card').forEach(function (b) {
      b.addEventListener('click', function () { addToCart(this.getAttribute('data-id')); });
    });
  }

  // ---- Panier ----
  function addToCart(id) {
    var item = null;
    for (var i = 0; i < items.length; i++) { if (items[i].id === id) { item = items[i]; break; } }
    if (!item) return;
    var line = null;
    for (var j = 0; j < cart.length; j++) { if (cart[j].itemId === id) { line = cart[j]; break; } }
    var current = line ? line.qty : 0;
    if (current + 1 > (item.quantity || 0)) { showToast('Stock insuffisant (' + item.quantity + ')'); return; }
    if (line) line.qty += 1;
    else cart.push({ itemId: id, name: item.name, price: item.price, qty: 1 });
    renderGrid();
    renderCart();
  }

  function changeQty(id, delta) {
    var item = null;
    for (var i = 0; i < items.length; i++) { if (items[i].id === id) { item = items[i]; break; } }
    for (var j = 0; j < cart.length; j++) {
      if (cart[j].itemId === id) {
        var nv = cart[j].qty + delta;
        if (delta > 0 && item && nv > (item.quantity || 0)) { showToast('Stock insuffisant (' + item.quantity + ')'); return; }
        if (nv <= 0) cart.splice(j, 1);
        else cart[j].qty = nv;
        break;
      }
    }
    renderGrid();
    renderCart();
  }

  function removeLine(id) {
    cart = cart.filter(function (l) { return l.itemId !== id; });
    renderGrid();
    renderCart();
  }

  function updateNavBadge() {
    var n = 0;
    cart.forEach(function (l) { n += l.qty; });
    if (n > 0) { navCartBadge.textContent = n > 99 ? '99+' : n; navCartBadge.removeAttribute('hidden'); }
    else { navCartBadge.setAttribute('hidden', ''); }
  }

  function renderCart() {
    updateNavBadge();
    if (!cart.length) {
      cartList.innerHTML = '<div class="g-cart-empty">Touchez un article pour démarrer</div>';
      cartTotal.textContent = fmt(0);
      return;
    }
    var total = 0, html = '';
    cart.forEach(function (l) {
      var lt = l.qty * l.price;
      total += lt;
      html += '<div class="g-line">'
        + '<div class="g-line-info"><span class="g-line-name">' + esc(l.name) + '</span>'
        + '<span class="g-line-pu">' + fmt(l.price) + ' · ' + fmt(lt) + '</span></div>'
        + '<div class="g-stepper">'
        + '<button class="g-minus" data-id="' + l.itemId + '">' + ico('minus') + '</button>'
        + '<span class="g-qn">' + l.qty + '</span>'
        + '<button class="g-plus" data-id="' + l.itemId + '">' + ico('plus') + '</button>'
        + '</div>'
        + '<button class="g-rm" data-id="' + l.itemId + '">' + ico('x') + '</button>'
        + '</div>';
    });
    cartList.innerHTML = html;
    cartTotal.textContent = fmt(total);
    cartList.querySelectorAll('.g-minus').forEach(function (b) { b.addEventListener('click', function () { changeQty(this.getAttribute('data-id'), -1); }); });
    cartList.querySelectorAll('.g-plus').forEach(function (b) { b.addEventListener('click', function () { changeQty(this.getAttribute('data-id'), 1); }); });
    cartList.querySelectorAll('.g-rm').forEach(function (b) { b.addEventListener('click', function () { removeLine(this.getAttribute('data-id')); }); });
  }

  function clearCart() { cart = []; orderLabel.value = ''; renderGrid(); renderCart(); }

  function validateOrder() {
    if (!cart.length) { showToast('Panier vide'); return; }
    var payload = { label: orderLabel.value.trim(), lines: cart.map(function (l) { return { item_id: l.itemId, qty: l.qty }; }) };
    api('POST', '/orders/', payload).then(function (state) {
      cart = [];
      orderLabel.value = '';
      applyState(state); // stock + ventes mis à jour
      showToast('Commande validée ✓');
    }).catch(function (e) { showToast(e.message, 2600); });
  }

  // ---- Dernières commandes ----
  function timeLabel(ts) { return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

  function renderOrders() {
    if (!orders.length) { ordersList.innerHTML = '<div class="g-cart-empty">Aucune commande</div>'; return; }
    var html = '';
    orders.slice(0, 12).forEach(function (o) {
      var label = o.label ? esc(o.label) : ('Commande #' + o.id);
      var lines = o.lines.map(function (l) { return l.qty + '× ' + esc(l.name); }).join(', ');
      html += '<div class="g-order">'
        + '<div class="g-order-main"><b>' + label + '</b><span>' + lines + '</span></div>'
        + '<div class="g-order-right"><b>' + fmt(o.total) + '</b><span>' + timeLabel(o.ts) + '</span></div>'
        + '</div>';
    });
    ordersList.innerHTML = html;
  }

  // ---- Horloge ----
  function tick() {
    var d = new Date();
    var c = $('gClock');
    if (c) c.textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // ---- Recherche ----
  function applySearch() {
    searchTerm = searchInput.value;
    searchInput.parentNode.classList.toggle('has-value', searchTerm.length > 0);
    renderGrid();
  }
  searchInput.addEventListener('input', applySearch);
  searchClear.addEventListener('click', function () { searchInput.value = ''; searchInput.focus(); applySearch(); });

  // ---- Navigation du bas (vues mobile) ----
  function setView(v) {
    gMain.setAttribute('data-view', v);
    var btns = document.querySelectorAll('.g-nav-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-view') === v);
    }
    window.scrollTo(0, 0);
  }
  (function () {
    var btns = document.querySelectorAll('.g-nav-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { setView(this.getAttribute('data-view')); });
    }
  })();

  // ---- Invitation animée (main) toutes les 2 min d'inactivité ----
  var tapHint = $('tapHint');
  var lastActivity = Date.now();
  var hintHideTimer = null;
  var IDLE_MS = 120000; // 2 minutes

  function showTapHint() {
    if (!tapHint || tapHint.classList.contains('show')) return;
    tapHint.classList.add('show');
    clearTimeout(hintHideTimer);
    hintHideTimer = setTimeout(hideTapHint, 5000); // visible 5 s
  }
  function hideTapHint() {
    if (tapHint) tapHint.classList.remove('show');
  }
  function noteActivity() {
    lastActivity = Date.now();
    if (tapHint && tapHint.classList.contains('show')) hideTapHint();
  }
  ['pointerdown', 'touchstart', 'click', 'keydown', 'wheel'].forEach(function (ev) {
    document.addEventListener(ev, noteActivity, { passive: true });
  });
  // Vérifie l'inactivité toutes les 15 s
  setInterval(function () {
    if (Date.now() - lastActivity >= IDLE_MS) {
      showTapHint();
      lastActivity = Date.now(); // réapparaîtra ~2 min plus tard si toujours inactif
    }
  }, 15000);

  // ---- Init ----
  $('orderValidate').addEventListener('click', validateOrder);
  $('orderClear').addEventListener('click', clearCart);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loadState().catch(function () {}); });
  // Resynchronisation en arrière-plan : la couche hors ligne pousse le nouvel état.
  window.addEventListener('barstock:state', function (e) { if (e.detail) applyState(e.detail); });

  tick();
  setInterval(tick, 30000);
  renderCart();
  loadState().catch(function () { showToast('Connexion au serveur impossible', 3000); });
})();
