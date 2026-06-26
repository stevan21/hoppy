/* ============================================================================
 * BarStock Pro — Menu client (commande par QR code)
 * Page publique autonome : charge le menu, gère un panier, envoie la commande.
 * ==========================================================================*/
(function () {
  "use strict";

  var CFG = window.MENU || {};
  var items = [];
  var cats = [];        // ordre de groupage (catégories du bar)
  var cart = {};        // { itemId: qty }
  var searchTerm = "";
  var activeKind = "all";  // 'all' | 'drink' | 'food'

  function $(id) { return document.getElementById(id); }
  function ico(id) { return '<svg class="ico"><use href="#i-' + id + '"/></svg>'; }
  function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' XAF'; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  var grid = $('grid');
  var searchInput = $('searchInput');
  var searchClear = $('searchClear');
  var kindTabs = $('kindTabs');
  var cartBar = $('cartBar');
  var cartCount = $('cartCount');
  var cartBarTotal = $('cartBarTotal');
  var sheet = $('sheet');
  var sheetLines = $('sheetLines');
  var sheetTotal = $('sheetTotal');
  var sendBtn = $('sendBtn');
  var doneScreen = $('doneScreen');
  var doneStamp = $('doneStamp');
  var toastEl = $('toast');

  var toastTimer = null;
  function toast(msg, ok) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('ok', !!ok);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  // ---- Micro-interactions (dopamine) --------------------------------------
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  // ---- Sons (générés en Web Audio, aucun fichier) -------------------------
  // Toujours actifs. Trois signatures distinctes : boisson, nourriture, commande.
  var audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }
  // Une note. delay = départ différé (s), glide = fréquence d'arrivée (portamento).
  function blip(freq, dur, type, vol, delay, glide) {
    var ctx = ensureAudio(); if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.connect(g); g.connect(ctx.destination);
    var t = ctx.currentTime + (delay || 0);
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + (dur || 0.12));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.08, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.12));
    o.start(t); o.stop(t + (dur || 0.12) + 0.03);
  }
  // 🍸 Boisson : "bulle" brillante qui monte (pétillant, aigu).
  function soundDrink() { blip(660, 0.12, 'sine', 0.06, 0, 990); blip(990, 0.09, 'sine', 0.04, 0.06); }
  // 🍽 Nourriture : note chaude type marimba (grave, ronde, boisée).
  function soundFood() { blip(300, 0.18, 'sine', 0.075, 0, 280); blip(450, 0.13, 'triangle', 0.035); }
  // 🧾 Commande : petit arpège montant joyeux (do-mi-sol-do).
  function soundOrder() {
    [523, 659, 784, 1046].forEach(function (f, i) { blip(f, 0.17, 'sine', 0.06, i * 0.095); });
  }

  function bumpCart() {
    if (!cartBar || cartBar.hidden) return;
    cartBar.classList.remove('pulse');
    void cartBar.offsetWidth;            // relance l'animation
    cartBar.classList.add('pulse');
  }

  // Un petit visuel "vole" de la carte vers la barre panier.
  function flyToCart(srcRect, imgCss) {
    if (reduceMotion || !srcRect) return;
    var tRect = (cartBar && !cartBar.hidden) ? cartBar.getBoundingClientRect() : null;
    var tx = tRect ? tRect.left + tRect.width / 2 : window.innerWidth / 2;
    var ty = tRect ? tRect.top + tRect.height / 2 : window.innerHeight - 46;
    var fly = document.createElement('div');
    fly.className = 'm-fly';
    if (imgCss) fly.style.backgroundImage = imgCss;
    fly.style.left = srcRect.left + 'px';
    fly.style.top = srcRect.top + 'px';
    fly.style.width = srcRect.width + 'px';
    fly.style.height = srcRect.height + 'px';
    document.body.appendChild(fly);
    fly.getBoundingClientRect();         // force un reflow avant la transition
    var dx = tx - (srcRect.left + srcRect.width / 2);
    var dy = ty - (srcRect.top + srcRect.height / 2);
    fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.18)';
    fly.style.opacity = '.25';
    var cleaned = false;
    function cleanup() { if (cleaned) return; cleaned = true; if (fly.parentNode) fly.remove(); bumpCart(); }
    fly.addEventListener('transitionend', cleanup);
    setTimeout(cleanup, 720);
  }

  // Petit feu d'artifice de confettis à l'envoi de la commande.
  function burstConfetti(host) {
    if (reduceMotion || !host) return;
    var colors = ['#c75f1c', '#e2913a', '#2f8f4e', '#e0b34a', '#d98c5f', '#9c6b3f'];
    for (var i = 0; i < 28; i++) {
      var c = document.createElement('i');
      c.className = 'm-confetti';
      c.style.left = (50 + (Math.random() * 44 - 22)) + '%';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--dx', (Math.random() * 260 - 130).toFixed(0) + 'px');
      c.style.setProperty('--dy', (170 + Math.random() * 230).toFixed(0) + 'px');
      c.style.setProperty('--rot', (Math.random() * 760 - 380).toFixed(0) + 'deg');
      c.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
      host.appendChild(c);
      (function (el) { setTimeout(function () { if (el.parentNode) el.remove(); }, 1700); })(c);
    }
  }

  function renderSkeleton() {
    var card = '<div class="m-card m-skel"><span class="m-card-img m-skel-img"></span>'
      + '<span class="m-card-body"><span class="m-skel-line"></span><span class="m-skel-line short"></span></span></div>';
    grid.innerHTML = new Array(7).join(card);
  }

  function itemById(id) {
    for (var i = 0; i < items.length; i++) { if (items[i].id === id) return items[i]; }
    return null;
  }

  // ---- Chargement du menu --------------------------------------------------
  function loadMenu() {
    renderSkeleton();
    fetch(CFG.stateUrl)
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
      .then(function (data) { items = data.items || []; cats = data.categories || []; setupTabs(); renderGrid(true); })
      .catch(function () { grid.innerHTML = '<div class="m-empty">Menu indisponible. Réessayez plus tard.</div>'; });
  }

  // ---- Onglets Boissons / Nourriture --------------------------------------
  function itemKind(it) { return it.kind === 'food' ? 'food' : 'drink'; }
  // Thème vert/blanc quand on est sur la Nourriture, doré sinon.
  function applyKindTheme() { document.body.classList.toggle('food-theme', activeKind === 'food'); }
  function setupTabs() {
    if (!kindTabs) return;
    var hasDrink = false, hasFood = false;
    items.forEach(function (it) { if (itemKind(it) === 'food') hasFood = true; else hasDrink = true; });
    // On n'affiche les onglets que si les deux familles sont présentes.
    if (hasDrink && hasFood) {
      kindTabs.hidden = false;
    } else {
      kindTabs.hidden = true;
      activeKind = 'all';
    }
    applyKindTheme();
  }
  function setActiveKind(kind) {
    activeKind = kind;
    if (kindTabs) {
      kindTabs.querySelectorAll('.m-tab').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-kind') === kind);
      });
    }
    applyKindTheme();
    renderGrid(true);
  }

  // ---- Groupage par catégorie ----------------------------------------------
  function catOrderIndex(cat) {
    for (var i = 0; i < cats.length; i++) { if (cats[i].toLowerCase() === cat.toLowerCase()) return i; }
    return cats.length + 1;
  }
  function groupByCategory(list) {
    var groups = {};
    list.forEach(function (it) {
      var c = (it.category || '').trim() || 'Divers';
      (groups[c] = groups[c] || []).push(it);
    });
    return Object.keys(groups).sort(function (a, b) {
      if (a === 'Divers') return 1; if (b === 'Divers') return -1;
      var ia = catOrderIndex(a), ib = catOrderIndex(b);
      return ia !== ib ? ia - ib : a.localeCompare(b, 'fr');
    }).map(function (c) { return { cat: c, items: groups[c] }; });
  }

  function cardHtml(it) {
    var inCart = cart[it.id] || 0;
    var img = it.image
      ? '<span class="m-card-img" style="background-image:url(\'' + encodeURI(it.image) + '\')"></span>'
      : '<span class="m-card-img m-card-img-ph">' + esc((it.name || '?').charAt(0).toUpperCase()) + '</span>';
    return '<button class="m-card' + (inCart ? ' active' : '') + '" data-id="' + esc(it.id) + '">'
      + (inCart ? '<span class="m-badge">' + inCart + '</span>' : '')
      + img
      + '<span class="m-card-body">'
      + '<span class="m-card-name">' + esc(it.name) + '</span>'
      + '<span class="m-card-price">' + fmt(it.price) + '</span>'
      + '<span class="m-card-stock">' + (it.quantity > 0 ? 'disponible' : 'rupture') + '</span>'
      + '</span></button>';
  }

  // ---- Rendu de la grille --------------------------------------------------
  function renderGrid(animate) {
    grid.classList.toggle('reveal', !!animate);
    if (!items.length) { grid.innerHTML = '<div class="m-empty">Aucun article disponible pour le moment.</div>'; return; }
    var base = activeKind === 'all' ? items : items.filter(function (it) { return itemKind(it) === activeKind; });
    var q = searchTerm.trim().toLowerCase();
    var list = q ? base.filter(function (it) { return (it.name || '').toLowerCase().indexOf(q) !== -1; }) : base;
    if (!list.length) { grid.innerHTML = '<div class="m-empty">Aucun résultat pour « ' + esc(searchTerm) + ' ».</div>'; return; }
    var html = '';
    if (q) {
      list.forEach(function (it) { html += cardHtml(it); });
    } else {
      groupByCategory(list).forEach(function (group) {
        html += '<div class="m-cat-head">' + esc(group.cat) + '</div>';
        group.items.forEach(function (it) { html += cardHtml(it); });
      });
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.m-card').forEach(function (b, i) {
      if (animate) b.style.setProperty('--i', Math.min(i, 12));   // cascade plafonnée
      b.addEventListener('click', function () { addToCart(this.getAttribute('data-id'), this); });
    });
  }

  // ---- Panier --------------------------------------------------------------
  function totalQty() { var n = 0; for (var k in cart) n += cart[k]; return n; }
  function totalPrice() {
    var t = 0;
    for (var id in cart) { var it = itemById(id); if (it) t += cart[id] * it.price; }
    return t;
  }

  function addToCart(id, srcEl) {
    var it = itemById(id);
    if (!it) return;
    var cur = cart[id] || 0;
    if (cur + 1 > (it.quantity || 0)) { toast('Stock limité (' + it.quantity + ')'); vibrate(40); return; }
    if (cur + 1 > 99) return;
    // On capture la position de l'image AVANT le re-rendu (qui remplace la carte).
    var rect = null, imgCss = '';
    if (srcEl) {
      var imgEl = srcEl.querySelector('.m-card-img');
      if (imgEl) {
        rect = imgEl.getBoundingClientRect();
        if (imgEl.style.backgroundImage && imgEl.style.backgroundImage !== 'none') imgCss = imgEl.style.backgroundImage;
      }
    }
    cart[id] = cur + 1;
    renderGrid();
    renderCartBar();
    if (!sheet.hidden) renderSheet();
    vibrate(12);
    if (itemKind(it) === 'food') soundFood(); else soundDrink();
    flyToCart(rect, imgCss);
  }

  function changeQty(id, delta) {
    var it = itemById(id);
    var nv = (cart[id] || 0) + delta;
    if (delta > 0 && it && nv > (it.quantity || 0)) { toast('Stock limité (' + it.quantity + ')'); return; }
    if (nv <= 0) delete cart[id];
    else cart[id] = nv;
    renderGrid();
    renderCartBar();
    renderSheet();
    if (!totalQty()) closeSheet();
  }

  function renderCartBar() {
    var n = totalQty();
    if (n > 0) {
      var wasHidden = cartBar.hidden;
      cartBar.hidden = false;
      cartCount.textContent = n;
      cartBarTotal.textContent = fmt(totalPrice());
      if (!reduceMotion) { cartCount.classList.remove('pop'); void cartCount.offsetWidth; cartCount.classList.add('pop'); }
      if (wasHidden && !reduceMotion) {
        cartBar.classList.add('in');
        setTimeout(function () { cartBar.classList.remove('in'); }, 450);
      }
    } else {
      cartBar.hidden = true;
      cartBar.classList.remove('in', 'pulse');
    }
  }

  function renderSheet() {
    var ids = Object.keys(cart);
    if (!ids.length) { sheetLines.innerHTML = '<div class="m-empty">Panier vide</div>'; sheetTotal.textContent = fmt(0); return; }
    var html = '';
    ids.forEach(function (id) {
      var it = itemById(id);
      if (!it) return;
      var qn = cart[id];
      html += '<div class="m-line">'
        + '<div class="m-line-info"><span class="m-line-name">' + esc(it.name) + '</span>'
        + '<span class="m-line-sub">' + fmt(it.price) + ' · ' + fmt(qn * it.price) + '</span></div>'
        + '<div class="m-step">'
        + '<button data-act="minus" data-id="' + esc(id) + '">' + ico('minus') + '</button>'
        + '<span class="qn">' + qn + '</span>'
        + '<button data-act="plus" data-id="' + esc(id) + '">' + ico('plus') + '</button>'
        + '</div></div>';
    });
    sheetLines.innerHTML = html;
    sheetTotal.textContent = fmt(totalPrice());
    sheetLines.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        changeQty(this.getAttribute('data-id'), this.getAttribute('data-act') === 'plus' ? 1 : -1);
      });
    });
  }

  function openSheet() { if (!totalQty()) return; renderSheet(); sheet.hidden = false; }
  function closeSheet() { sheet.hidden = true; }

  // ---- Envoi de la commande ------------------------------------------------
  var sending = false;
  function send() {
    if (sending || !totalQty()) return;
    sending = true;
    sendBtn.disabled = true;
    sendBtn.classList.add('loading');
    var lines = Object.keys(cart).map(function (id) { return { item_id: id, qty: cart[id] }; });
    fetch(CFG.orderUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: CFG.table || '', lines: lines })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.ok) throw new Error(res.d.error || 'Échec de l\'envoi');
        cart = {};
        closeSheet();
        renderGrid();
        renderCartBar();
        doneScreen.hidden = false;
        if (doneStamp) { doneStamp.classList.remove('go'); void doneStamp.offsetWidth; doneStamp.classList.add('go'); }
        vibrate([12, 50, 90]);
        soundOrder();
        burstConfetti(doneScreen.querySelector('.m-done-card'));
      })
      .catch(function (e) { toast(e.message || 'Connexion impossible'); vibrate(60); })
      .then(function () { sending = false; sendBtn.disabled = false; sendBtn.classList.remove('loading'); });
  }

  // ---- Événements ----------------------------------------------------------
  searchInput.addEventListener('input', function () {
    searchTerm = this.value;
    if (searchClear) searchClear.hidden = !this.value;
    renderGrid();
  });
  if (searchClear) searchClear.addEventListener('click', function () {
    searchInput.value = ''; searchTerm = ''; searchClear.hidden = true; renderGrid(); searchInput.focus();
  });
  if (kindTabs) kindTabs.querySelectorAll('.m-tab').forEach(function (b) {
    b.addEventListener('click', function () { setActiveKind(this.getAttribute('data-kind')); });
  });
  cartBar.addEventListener('click', openSheet);
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetBackdrop').addEventListener('click', closeSheet);
  sendBtn.addEventListener('click', send);
  $('againBtn').addEventListener('click', function () { doneScreen.hidden = true; loadMenu(); });

  loadMenu();
})();
