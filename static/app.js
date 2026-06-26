  (function() {
    "use strict";

    function ico(id) { return '<svg class="ico"><use href="#i-' + id + '"/></svg>'; }
    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    // ============================================================
    // 1. ÉTAT GLOBAL
    // ============================================================
    let items = [];
    let todos = [];
    let movements = [];       // historique des mouvements de stock
    let archives = [];        // inventaires archivés (snapshots quotidiens)
    let orders = [];          // commandes (serveur)
    let cart = [];            // panier de la commande en cours : {itemId, name, price, qty}
    let todoFilter = 'all';
    let moveItemId = null;     // article ciblé par la modale
    let moveType = 'out';      // type de mouvement en cours

    // Motifs proposés selon le type
    const REASONS = {
      in: ['Réapprovisionnement', 'Livraison', 'Retour', 'Correction inventaire'],
      out: ['Service / Vente', 'Casse', 'Perte', 'Correction inventaire'],
    };

    // ============================================================
    // 2. DOM
    // ============================================================
    const $ = id => document.getElementById(id);

    // Catégories (ordre de groupage fourni par le serveur selon le type d'établissement)
    const CATS = Array.isArray(window.BS_CATS) ? window.BS_CATS : [];
    function catOrderIndex(cat) {
      const i = CATS.findIndex(c => c.toLowerCase() === cat.toLowerCase());
      return i === -1 ? CATS.length + 1 : i;
    }
    function groupByCategory(list) {
      const groups = {};
      list.forEach(it => {
        const c = (it.category || '').trim() || 'Divers';
        (groups[c] = groups[c] || []).push(it);
      });
      return Object.keys(groups).sort((a, b) => {
        if (a === 'Divers') return 1;
        if (b === 'Divers') return -1;
        const ia = catOrderIndex(a), ib = catOrderIndex(b);
        return ia !== ib ? ia - ib : a.localeCompare(b, 'fr');
      }).map(c => ({ cat: c, items: groups[c] }));
    }

    const itemListEl = $('itemList');
    const CASE_SIZE = 12; // 1 casier = 12 unités
    const addTotalHint = $('addTotalHint');
    const addTabs = $('addTabs');
    // Onglet réapprovisionner
    const reapproForm = $('reapproForm');
    const reapproItem = $('reapproItem');
    const reapproCases = $('reapproCases');
    const reapproQty = $('reapproQty');
    // Onglet nouvel article
    const newForm = $('newForm');
    const newName = $('newName');
    const newCategory = $('newCategory');
    const newKind = $('newKind');
    const newPrice = $('newPrice');
    const newImage = $('newImage');
    const newCases = $('newCases');
    const newQty = $('newQty');
    const totalBadge = $('totalBadge');
    const countDisplay = $('countDisplay');
    const storageStatus = $('storageStatus');
    const filterSelect = $('filterSelect');
    const stockSearch = $('stockSearch');
    // Modale prix
    const priceModal = $('priceModal');
    const priceItemName = $('priceItemName');
    const priceInput = $('priceInput');
    const priceConfirm = $('priceConfirm');
    const priceCancel = $('priceCancel');
    const priceClose = $('priceClose');
    let priceItemId = null;
    const totalItems = $('totalItems');
    const kpiArticles = $('kpiArticles');
    const kpiLow = $('kpiLow');
    const kpiOut = $('kpiOut');
    const kpiInToday = $('kpiInToday');
    const kpiOutToday = $('kpiOutToday');
    const resetBtn = $('resetBtn');
    const stockBadge = $('stockBadge');
    const todoBadge = $('todoBadge');
    const histBadge = $('histBadge');
    const toast = $('toast');
    const toastMsg = $('toastMsg');
    const pageTitle = $('pageTitle');

    // Historique
    const historyList = $('historyList');
    const histSearch = $('histSearch');
    const histType = $('histType');
    const histDate = $('histDate');
    const clearHistoryBtn = $('clearHistoryBtn');
    const exportPdfBtn = $('exportPdfBtn');
    const histInToday = $('histInToday');
    const histOutToday = $('histOutToday');
    const histNetToday = $('histNetToday');
    const histTotalMoves = $('histTotalMoves');

    // Modale
    const moveModal = $('moveModal');
    const moveItemName = $('moveItemName');
    const moveSeg = $('moveSeg');
    const moveQty = $('moveQty');
    const moveReason = $('moveReason');
    const moveNote = $('moveNote');
    const movePreview = $('movePreview');
    const moveConfirm = $('moveConfirm');
    const moveCancel = $('moveCancel');
    const moveClose = $('moveClose');

    // Sidebar mobile
    const sidebar = $('sidebar');
    const overlay = $('overlay');
    const menuBtn = $('menuBtn');

    // Todo
    const todoInput = $('todoInput');
    const todoPriority = $('todoPriority');
    const todoAddBtn = $('todoAddBtn');
    const todoList = $('todoList');
    const todoTotal = $('todoTotal');
    const todoCompleted = $('todoCompleted');
    const todoFilterBtns = document.querySelectorAll('.todo-filters button');

    // Navigation
    // Tableau de bord
    const caToday = $('caToday');
    const caTotal = $('caTotal');
    const soldToday = $('soldToday');
    const dashStockValue = $('dashStockValue');
    const salesList = $('salesList');
    const priceTableBody = $('priceTableBody');

    // Statistiques
    const statPeriods = $('statPeriods');
    const statUnits = $('statUnits');
    const statRevenue = $('statRevenue');
    const statCount = $('statCount');
    const statAvg = $('statAvg');
    const statChartSub = $('statChartSub');
    const salesChart = $('salesChart');
    const topDrinks = $('topDrinks');
    let statsPeriod = 'today';

    // Archives
    const archiveBadge = $('archiveBadge');
    const archiveNowBtn = $('archiveNowBtn');
    const archiveList = $('archiveList');
    const archiveModal = $('archiveModal');
    const archiveModalTitle = $('archiveModalTitle');
    const archiveModalBody = $('archiveModalBody');
    const archiveModalClose = $('archiveModalClose');
    const archiveModalOk = $('archiveModalOk');
    const archiveModalDownload = $('archiveModalDownload');

    // Commandes
    const ordersBadge = $('ordersBadge');
    const orderLabel = $('orderLabel');
    const orderItem = $('orderItem');
    const orderQty = $('orderQty');
    const orderAddLine = $('orderAddLine');
    const cartList = $('cartList');
    const cartTotal = $('cartTotal');
    const orderValidate = $('orderValidate');
    const ordersList = $('ordersList');

    const navTabs = document.querySelectorAll('.nav-tab');
    const pages = {
      dashboard: $('page-dashboard'),
      caisse: $('page-caisse'),
      orders: $('page-orders'),
      stock: $('page-stock'),
      stats: $('page-stats'),
      history: $('page-history'),
      todo: $('page-todo'),
      archives: $('page-archives'),
      qrcodes: $('page-qrcodes'),
    };
    const pageMeta = {
      dashboard: { title: 'Tableau de bord', sub: 'Prix & ventes (XAF)', icon: 'grid' },
      caisse: { title: 'Caisse', sub: 'Prise de commande (POS)', icon: 'cart' },
      orders: { title: 'Commandes', sub: 'Prise de commande & ventes', icon: 'orders' },
      stock: { title: 'Gestion du stock', sub: 'Inventaire du bar', icon: 'box' },
      stats: { title: 'Statistiques', sub: 'Périodes & meilleures ventes', icon: 'trending' },
      history: { title: 'Historique', sub: 'Mouvements de stock', icon: 'history' },
      todo: { title: 'Gestion des tâches', sub: 'À faire & suivi', icon: 'tasks' },
      archives: { title: 'Archives', sub: 'Inventaires téléchargeables', icon: 'archive' },
      qrcodes: { title: 'QR codes', sub: 'Menu à scanner sur les tables', icon: 'grid' },
    };

    // ============================================================
    // 3. API (backend Django)
    // ============================================================
    const API = '/api';

    // Passe par la couche hors ligne (cache + file d'attente + synchro auto).
    function apiCall(method, path, payload) {
      return window.BarStock.api(method, path, payload);
    }

    // Remplace l'état local par celui renvoyé par le serveur, puis redessine
    function applyState(state) {
      items = state.items || [];
      movements = state.movements || [];
      todos = state.todos || [];
      archives = state.archives || [];
      orders = state.orders || [];
      updateUI();
      storageStatus.textContent = 'synchronisé';
    }

    // Charge l'état initial depuis le serveur
    function loadState() {
      return apiCall('GET', '/state/').then(applyState);
    }

    // ============================================================
    // 4. TOAST
    // ============================================================
    let toastTimer = null;
    function showToast(message, duration = 2000) {
      toastMsg.textContent = message;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
    }

    // ============================================================
    // 5. UTILITAIRES DATE
    // ============================================================
    function dayKey(ts) {
      const d = new Date(ts);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    function dayLabel(ts) {
      return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    function timeLabel(ts) {
      return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    function todayKey() { return dayKey(Date.now()); }

    // ============================================================
    // 7. FORMAT & ESCAPE
    // ============================================================
    function fmtPrice(n) {
      return Math.round(Number(n) || 0).toLocaleString('fr-FR') + ' XAF';
    }

    function escapeHtml(unsafe) {
      return String(unsafe).replace(/[&<>"]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
      });
    }

    // ============================================================
    // 8. MOUVEMENTS (historique) — créés côté serveur
    // ============================================================
    function lastMoveFor(itemId) {
      for (let i = movements.length - 1; i >= 0; i--) {
        if (movements[i].itemId === itemId) return movements[i];
      }
      return null;
    }

    // ============================================================
    // 9. STOCK - FILTRES & RENDU
    // ============================================================
    function getFilteredItems() {
      const filter = filterSelect.value;
      const q = (stockSearch.value || '').trim().toLowerCase();
      return items.filter(item => {
        if (q && (item.name || '').toLowerCase().indexOf(q) === -1) return false;
        const qty = item.quantity || 0;
        if (filter === 'low') return qty > 0 && qty <= 3;
        if (filter === 'out') return qty === 0;
        if (filter === 'high') return qty >= 10;
        return true; // 'all'
      });
    }

    function renderItems() {
      const filtered = getFilteredItems();

      if (filtered.length === 0) {
        const msg = items.length === 0 ? 'Aucun article en stock' : 'Aucun article ne correspond au filtre';
        itemListEl.innerHTML = `
          <div class="empty-state">
            ${ico('inbox')}
            ${msg}<br>
            <small>${items.length === 0 ? 'Ajoutez vos premiers articles !' : 'Modifiez vos filtres'}</small>
          </div>`;
        return;
      }

      let html = '';
      groupByCategory(filtered).forEach((group) => {
        html += `<div class="cat-head">${ico('layers')} <span>${escapeHtml(group.cat)}</span><b>${group.items.length}</b></div>`;
        group.items.forEach((item) => {
        const name = escapeHtml(item.name || 'Sans nom');
        const qty = (item.quantity != null ? item.quantity : 0);
        const isLow = qty > 0 && qty <= 3;
        const isOut = qty === 0;
        const cardClass = isOut ? 'out-of-stock' : (isLow ? 'low-stock' : '');
        const qtyClass = isOut ? 'out' : (isLow ? 'low' : '');

        const last = lastMoveFor(item.id);
        let meta = 'Aucun mouvement';
        if (last) {
          const sameDay = dayKey(last.ts) === todayKey();
          meta = (sameDay ? 'maj ' + timeLabel(last.ts) : 'maj ' + new Date(last.ts).toLocaleDateString('fr-FR'));
        }

        const price = item.price || 0;
        const lineValue = price * qty;
        const thumb = item.image
          ? `<span class="item-thumb" style="background-image:url('${encodeURI(item.image)}')"></span>`
          : `<span class="item-thumb ph">${escapeHtml((item.name || '?').charAt(0).toUpperCase())}</span>`;

        const catLabel = (item.category || '').trim() || 'Sans catégorie';
        html += `
          <div class="item-card ${cardClass}" data-id="${item.id}">
            <div class="item-info">
              ${thumb}
              <div class="item-main">
                <span class="item-name">${name}</span>
                <div class="item-tags">
                  <button class="item-cat" data-cat-id="${item.id}" title="Changer la catégorie">${ico('layers')} ${escapeHtml(catLabel)}</button>
                  <button class="item-kind ${item.kind === 'food' ? 'food' : 'drink'}" data-kind-id="${item.id}" title="Boisson / Nourriture (menu client)">${ico(item.kind === 'food' ? 'utensils' : 'martini')} ${item.kind === 'food' ? 'Nourriture' : 'Boisson'}</button>
                </div>
                <span class="item-meta">${ico('clock')} ${meta}</span>
              </div>
              <span class="item-qty ${qtyClass}">${qty}</span>
              <button class="item-price edit-price-btn" data-id="${item.id}" title="Modifier le prix unitaire">${ico('edit')} ${fmtPrice(price)}</button>
              <span class="item-value" title="Valeur en stock">${fmtPrice(lineValue)}</span>
            </div>
            <div class="item-actions">
              <button class="move-btn" data-id="${item.id}" aria-label="Mouvement" title="Entrée / Sortie">${ico('swap')}</button>
              <button class="decrement-btn" data-id="${item.id}" aria-label="Sortie -1">${ico('minus')}</button>
              <button class="increment-btn" data-id="${item.id}" aria-label="Entrée +1">${ico('plus')}</button>
              <button class="delete-btn" data-id="${item.id}" aria-label="Supprimer">${ico('x')}</button>
            </div>
          </div>`;
        });
      });

      itemListEl.innerHTML = html;

      itemListEl.querySelectorAll('.item-cat').forEach(btn => {
        btn.addEventListener('click', function(e) { e.stopPropagation(); editCategory(this.getAttribute('data-cat-id')); });
      });

      itemListEl.querySelectorAll('.item-kind').forEach(btn => {
        btn.addEventListener('click', function(e) { e.stopPropagation(); toggleKind(this.getAttribute('data-kind-id')); });
      });

      itemListEl.querySelectorAll('button[data-id]').forEach(btn => {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          const id = this.getAttribute('data-id');
          if (!id) return;
          if (this.classList.contains('increment-btn')) quickMove(id, 'in');
          else if (this.classList.contains('decrement-btn')) quickMove(id, 'out');
          else if (this.classList.contains('delete-btn')) deleteItem(id);
          else if (this.classList.contains('move-btn')) openMoveModal(id);
          else if (this.classList.contains('edit-price-btn')) editPrice(id);
        });
      });
    }

    // ============================================================
    // 10. STOCK - ACTIONS
    // ============================================================
    function fail(e) { showToast(e.message || 'Erreur', 2200); }

    // Changer la catégorie d'un article
    function editCategory(id) {
      const item = items.find(it => it.id === id);
      if (!item) return;
      const v = prompt('Catégorie de « ' + item.name + ' » :', item.category || '');
      if (v === null) return;
      apiCall('POST', '/items/' + id + '/category/', { category: v.trim() })
        .then(function (state) { applyState(state); showToast('Catégorie mise à jour'); })
        .catch(fail);
    }

    // Basculer le type d'un article : boisson <-> nourriture (côté menu client)
    function toggleKind(id) {
      const item = items.find(it => it.id === id);
      if (!item) return;
      const next = item.kind === 'food' ? 'drink' : 'food';
      apiCall('POST', '/items/' + id + '/kind/', { kind: next })
        .then(function (state) { applyState(state); showToast(next === 'food' ? 'Classé en Nourriture' : 'Classé en Boisson'); })
        .catch(fail);
    }

    // Mouvement rapide +1 / -1 via les boutons
    function quickMove(id, type) {
      const item = items.find(it => it.id === id);
      if (!item) return;
      if (type === 'out' && (item.quantity || 0) <= 0) { showToast('Stock déjà à zéro'); return; }
      apiCall('POST', '/items/' + id + '/move/', { type: type, qty: 1, note: 'Ajustement rapide' })
        .then(function (state) {
          applyState(state);
          const it = items.find(x => x.id === id);
          showToast(item.name + ' : ' + (type === 'in' ? '+1' : '-1') + (it ? ' → ' + it.quantity : ''));
        })
        .catch(fail);
    }

    // Mouvement détaillé via la modale -> Promise<bool> (true = succès)
    function applyMovement(id, type, qty, reason, note) {
      qty = parseInt(qty, 10);
      if (isNaN(qty) || qty < 1) { showToast('Quantité invalide', 1200); return Promise.resolve(false); }
      const fullNote = note ? reason + ' — ' + note : reason;
      return apiCall('POST', '/items/' + id + '/move/', { type: type, qty: qty, note: fullNote })
        .then(function (state) {
          applyState(state);
          const it = items.find(x => x.id === id);
          showToast((it ? it.name : 'Article') + ' : ' + (type === 'in' ? '+' : '-') + qty + (it ? ' → ' + it.quantity : ''));
          return true;
        })
        .catch(function (e) { fail(e); return false; });
    }

    function deleteItem(id) {
      const item = items.find(it => it.id === id);
      const name = item ? item.name : 'Article';
      apiCall('DELETE', '/items/' + id + '/')
        .then(function (state) { applyState(state); showToast(name + ' supprimé'); })
        .catch(fail);
    }

    function addItem(name, quantity, price) {
      const trimmedName = (name || '').trim();
      if (!trimmedName) return;
      apiCall('POST', '/items/', { name: trimmedName, quantity: quantity, price: price })
        .then(function (state) { applyState(state); showToast(trimmedName + ' enregistré'); })
        .catch(fail);
    }

    // Ouvre la modale de modification du prix
    function editPrice(id) {
      const item = items.find(it => it.id === id);
      if (!item) return;
      priceItemId = id;
      priceItemName.textContent = item.name;
      priceInput.value = item.price || 0;
      priceModal.classList.add('show');
      setTimeout(function () { priceInput.focus(); priceInput.select(); }, 50);
    }

    function closePriceModal() { priceModal.classList.remove('show'); priceItemId = null; }

    function savePrice() {
      if (!priceItemId) return;
      const price = parseFloat(String(priceInput.value).replace(/\s/g, '').replace(',', '.'));
      if (isNaN(price) || price < 0) { showToast('Prix invalide', 1200); return; }
      const id = priceItemId;
      const item = items.find(it => it.id === id);
      apiCall('POST', '/items/' + id + '/price/', { price: price })
        .then(function (state) { applyState(state); showToast('Prix de ' + (item ? item.name : 'article') + ' : ' + fmtPrice(price)); })
        .catch(fail);
      closePriceModal();
    }

    function resetStock() {
      if (items.length === 0) { showToast('Le stock est déjà vide'); return; }
      if (confirm('Réinitialiser tout le stock ? Cette action est définitive.')) {
        apiCall('POST', '/reset/')
          .then(function (state) { applyState(state); showToast('Stock réinitialisé'); })
          .catch(fail);
      }
    }

    // ============================================================
    // 11. MODALE MOUVEMENT
    // ============================================================
    function setReasons(type) {
      moveReason.innerHTML = REASONS[type].map(r => `<option value="${r}">${r}</option>`).join('');
    }

    function updateMovePreview() {
      const item = items.find(it => it.id === moveItemId);
      if (!item) { movePreview.textContent = '—'; return; }
      let qty = parseInt(moveQty.value, 10);
      if (isNaN(qty) || qty < 1) qty = 0;
      const before = item.quantity || 0;
      const after = moveType === 'in' ? before + qty : before - qty;
      const montant = qty * (item.price || 0);
      movePreview.textContent = before + ' → ' + (after < 0 ? '⛔' : after) + (montant > 0 ? '  (' + fmtPrice(montant) + ')' : '');
      movePreview.style.color = after < 0 ? 'var(--red)' : 'var(--navy)';
    }

    function setMoveType(type) {
      moveType = type;
      moveSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
      setReasons(type);
      updateMovePreview();
    }

    function openMoveModal(id) {
      const item = items.find(it => it.id === id);
      if (!item) return;
      moveItemId = id;
      moveItemName.textContent = item.name;
      moveQty.value = '1';
      moveNote.value = '';
      setMoveType('out');
      moveModal.classList.add('show');
      setTimeout(() => moveQty.focus(), 50);
    }

    function closeMoveModal() {
      moveModal.classList.remove('show');
      moveItemId = null;
    }

    moveSeg.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => setMoveType(b.dataset.type));
    });
    moveQty.addEventListener('input', updateMovePreview);
    moveConfirm.addEventListener('click', () => {
      applyMovement(moveItemId, moveType, moveQty.value, moveReason.value, moveNote.value.trim())
        .then(function (ok) { if (ok) closeMoveModal(); });
    });
    moveCancel.addEventListener('click', closeMoveModal);
    moveClose.addEventListener('click', closeMoveModal);
    moveModal.addEventListener('click', e => { if (e.target === moveModal) closeMoveModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && moveModal.classList.contains('show')) closeMoveModal();
    });

    // ============================================================
    // 12. HISTORIQUE - RENDU
    // ============================================================
    const TYPE_META = {
      in:     { cls: 'in', label: 'Entrée', icon: 'in', sign: '+' },
      create: { cls: 'in', label: 'Création', icon: 'plus', sign: '+' },
      out:    { cls: 'out', label: 'Sortie', icon: 'out', sign: '-' },
      delete: { cls: 'neutral', label: 'Suppression', icon: 'trash', sign: '' },
      reset:  { cls: 'neutral', label: 'Réinitialisation', icon: 'refresh', sign: '' },
    };

    function isIn(t) { return t === 'in' || t === 'create'; }
    function isOut(t) { return t === 'out'; }

    function refreshHistDateOptions() {
      const keys = [];
      const seen = {};
      for (let i = movements.length - 1; i >= 0; i--) {
        const k = dayKey(movements[i].ts);
        if (!seen[k]) { seen[k] = true; keys.push({ k, ts: movements[i].ts }); }
      }
      const current = histDate.value;
      let html = '<option value="all">Toutes les dates</option>';
      keys.forEach(o => {
        const lbl = o.k === todayKey() ? "Aujourd'hui" : dayLabel(o.ts);
        html += `<option value="${o.k}">${lbl.charAt(0).toUpperCase() + lbl.slice(1)}</option>`;
      });
      histDate.innerHTML = html;
      if (keys.some(o => o.k === current) || current === 'all') histDate.value = current;
    }

    // Mouvements filtrés (selon type / date / recherche), du plus récent au plus ancien
    function getFilteredMovements() {
      const typeF = histType.value;
      const dateF = histDate.value;
      const q = histSearch.value.trim().toLowerCase();
      return movements.slice().reverse().filter(m => {
        if (typeF === 'in' && !isIn(m.type)) return false;
        if (typeF === 'out' && !isOut(m.type)) return false;
        if (typeF === 'other' && (isIn(m.type) || isOut(m.type))) return false;
        if (dateF !== 'all' && dayKey(m.ts) !== dateF) return false;
        if (q && !(m.itemName || '').toLowerCase().includes(q)) return false;
        return true;
      });
    }

    // Export PDF de l'historique (respecte les filtres date / type / recherche)
    function exportHistoryPDF() {
      const list = getFilteredMovements();
      if (list.length === 0) { showToast('Aucun mouvement à exporter'); return; }

      const dateF = histDate.value;
      let periodLabel = 'Toutes les dates';
      if (dateF !== 'all') {
        const d = new Date(dateF + 'T00:00:00');
        periodLabel = (dateF === todayKey() ? "Aujourd'hui — " : '') + dayLabel(d.getTime());
      }
      const typeLabels = { all: 'Tous', in: 'Entrées', out: 'Sorties', other: 'Autres' };
      const typeLabel = typeLabels[histType.value] || 'Tous';
      const searchLabel = histSearch.value.trim();

      let tIn = 0, tOut = 0, tOutVal = 0;
      list.forEach(m => {
        if (isIn(m.type)) tIn += m.qty;
        else if (isOut(m.type)) { tOut += m.qty; tOutVal += (m.value || 0); }
      });

      const groups = [];
      const gidx = {};
      list.forEach(m => {
        const k = dayKey(m.ts);
        if (gidx[k] === undefined) { gidx[k] = groups.length; groups.push({ key: k, ts: m.ts, rows: [] }); }
        groups[gidx[k]].rows.push(m);
      });

      const typeFr = { in: 'Entrée', create: 'Création', out: 'Sortie', delete: 'Suppression', reset: 'Réinit.' };

      let bodyHtml = '';
      groups.forEach(g => {
        let gin = 0, gout = 0, gval = 0;
        g.rows.forEach(m => {
          if (isIn(m.type)) gin += m.qty;
          else if (isOut(m.type)) { gout += m.qty; gval += (m.value || 0); }
        });
        const lbl = g.key === todayKey() ? "Aujourd'hui" : dayLabel(g.ts);

        let rows = '';
        g.rows.forEach(m => {
          const sign = isIn(m.type) ? '+' : (isOut(m.type) ? '-' : '');
          const after = (m.type === 'delete' || m.type === 'reset') ? '—' : m.after;
          const val = (m.value > 0 && (isIn(m.type) || isOut(m.type))) ? fmtPrice(m.value) : '';
          rows += '<tr>' +
            '<td>' + timeLabel(m.ts) + '</td>' +
            '<td class="nm">' + escapeHtml(m.itemName || '—') + '</td>' +
            '<td>' + (typeFr[m.type] || m.type) + '</td>' +
            '<td>' + escapeHtml(m.note || '') + '</td>' +
            '<td class="r ' + (isOut(m.type) ? 'neg' : 'pos') + '">' + sign + m.qty + '</td>' +
            '<td class="r">' + after + '</td>' +
            '<td class="r">' + val + '</td></tr>';
        });

        bodyHtml += '<h2>' + escapeHtml(lbl) +
          '<span class="dsum">+' + gin + ' entrees &nbsp;&middot;&nbsp; -' + gout + ' sorties &nbsp;&middot;&nbsp; ' + fmtPrice(gval) + '</span></h2>' +
          '<table><thead><tr>' +
          '<th>Heure</th><th>Article</th><th>Type</th><th>Motif</th>' +
          '<th class="r">Qte</th><th class="r">Stock</th><th class="r">Montant</th>' +
          '</tr></thead><tbody>' + rows + '</tbody></table>';
      });

      const now = new Date();
      const genStr = now.toLocaleDateString('fr-FR') + ' a ' + timeLabel(now.getTime());
      const fileTitle = 'Historique BarStock' + (dateF !== 'all' ? ' - ' + dateF : '');

      const css =
        '*{box-sizing:border-box;}' +
        "body{font-family:'Segoe UI',Arial,sans-serif;color:#1c3e55;margin:28px;}" +
        '.head{border-bottom:3px solid #ffd700;padding-bottom:14px;margin-bottom:18px;}' +
        '.head h1{margin:0 0 4px 0;font-size:20px;}' +
        '.brand{color:#b8920a;font-weight:700;letter-spacing:1px;font-size:11px;}' +
        '.filters{font-size:12px;color:#5a6b7e;margin-top:8px;line-height:1.6;}' +
        '.filters b{color:#1c3e55;}' +
        '.totals{display:flex;gap:10px;margin:16px 0;flex-wrap:wrap;}' +
        '.totals div{border:1px solid #e0e6ee;border-radius:8px;padding:8px 14px;font-size:12px;}' +
        '.totals b{display:block;font-size:16px;margin-top:2px;}' +
        '.totals .in b{color:#2f855a;}.totals .out b{color:#c53030;}.totals .val b{color:#b8920a;}' +
        'h2{font-size:13px;margin:18px 0 6px 0;padding:6px 0;border-bottom:2px solid #e8edf5;display:flex;justify-content:space-between;align-items:baseline;}' +
        'h2 .dsum{font-size:10px;font-weight:600;color:#5a6b7e;}' +
        'table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px;}' +
        'th{text-align:left;background:#f4f7fb;color:#5a6b7e;text-transform:uppercase;font-size:9px;letter-spacing:.4px;padding:6px 8px;border-bottom:1px solid #dce3ec;}' +
        'td{padding:5px 8px;border-bottom:1px solid #eef2f7;}' +
        'td.nm{font-weight:700;}td.r,th.r{text-align:right;}' +
        'td.pos{color:#2f855a;font-weight:700;}td.neg{color:#c53030;font-weight:700;}' +
        '.foot{margin-top:22px;font-size:10px;color:#9aa7b6;border-top:1px solid #e8edf5;padding-top:8px;}' +
        '@media print{body{margin:14px;}h2{break-after:avoid;}tr{break-inside:avoid;}}';

      const doc = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>' +
        escapeHtml(fileTitle) + '</title><style>' + css + '</style></head><body>' +
        '<div class="head"><div class="brand">BARSTOCK PRO</div>' +
        '<h1>Historique des mouvements de stock</h1>' +
        '<div class="filters"><span>Periode : <b>' + escapeHtml(periodLabel) + '</b></span> &nbsp;|&nbsp; ' +
        '<span>Type : <b>' + escapeHtml(typeLabel) + '</b></span>' +
        (searchLabel ? ' &nbsp;|&nbsp; <span>Article : <b>' + escapeHtml(searchLabel) + '</b></span>' : '') +
        '<br>Edite le ' + escapeHtml(genStr) + ' &middot; ' + list.length + ' mouvement(s)</div></div>' +
        '<div class="totals"><div class="in">Entrees<b>+' + tIn + '</b></div>' +
        '<div class="out">Sorties<b>-' + tOut + '</b></div>' +
        '<div class="val">Valeur des sorties<b>' + fmtPrice(tOutVal) + '</b></div></div>' +
        bodyHtml +
        '<div class="foot">Document genere automatiquement par BarStock Pro - ' + escapeHtml(genStr) + '</div>' +
        '</body></html>';

      const w = window.open('', '_blank');
      if (!w) { showToast('Autorisez les fenêtres pop-up pour exporter'); return; }
      w.document.open();
      w.document.write(doc);
      w.document.close();
      w.focus();
      const triggerPrint = function() { try { w.print(); } catch (e) {} };
      if (w.document.readyState === 'complete') triggerPrint();
      else w.onload = triggerPrint;
      setTimeout(triggerPrint, 600);
      showToast('Export PDF prêt — choisissez « Enregistrer au format PDF »', 2600);
    }

    function renderHistory() {
      // KPI du jour
      const tk = todayKey();
      let inToday = 0, outToday = 0, outValToday = 0;
      movements.forEach(m => {
        if (dayKey(m.ts) !== tk) return;
        if (isIn(m.type)) inToday += m.qty;
        else if (isOut(m.type)) { outToday += m.qty; outValToday += (m.value || 0); }
      });
      histInToday.textContent = inToday;
      histOutToday.textContent = outToday;
      histNetToday.textContent = fmtPrice(outValToday);
      histTotalMoves.textContent = movements.length;
      kpiInToday.textContent = inToday;
      kpiOutToday.textContent = outToday;
      histBadge.textContent = movements.filter(m => dayKey(m.ts) === tk).length;

      const list = getFilteredMovements();

      if (list.length === 0) {
        historyList.innerHTML = `
          <div class="empty-state">
            ${ico('history')}
            Aucun mouvement<br>
            <small>Les entrées et sorties de stock apparaîtront ici</small>
          </div>`;
        return;
      }

      // Regroupement par jour
      const groups = [];
      const idx = {};
      list.forEach(m => {
        const k = dayKey(m.ts);
        if (idx[k] === undefined) { idx[k] = groups.length; groups.push({ key: k, ts: m.ts, rows: [] }); }
        groups[idx[k]].rows.push(m);
      });

      let html = '';
      groups.forEach(g => {
        let gin = 0, gout = 0, goutVal = 0;
        g.rows.forEach(m => {
          if (isIn(m.type)) gin += m.qty;
          else if (isOut(m.type)) { gout += m.qty; goutVal += (m.value || 0); }
        });
        const lbl = g.key === tk ? "Aujourd'hui" : dayLabel(g.ts);

        html += `<div class="hist-day">
          <div class="hist-day-head">
            <span class="date">${ico('calendar')} ${escapeHtml(lbl)}</span>
            <span class="sum">
              <span class="s-in">+${gin} entrées</span>
              <span class="s-out">-${gout} sorties</span>
              <span class="s-val">${fmtPrice(goutVal)} sorties</span>
            </span>
          </div>`;

        g.rows.forEach(m => {
          const meta = TYPE_META[m.type] || TYPE_META.out;
          const deltaTxt = meta.sign ? meta.sign + m.qty : m.qty;
          const afterTxt = (m.type === 'delete' || m.type === 'reset') ? '' : `<span class="hist-after">→ ${m.after}</span>`;
          const valTxt = (m.value > 0 && (isIn(m.type) || isOut(m.type))) ? ' · ' + fmtPrice(m.value) : '';
          html += `
            <div class="hist-row">
              <span class="hist-ico ${meta.cls}">${ico(meta.icon)}</span>
              <div class="hist-main">
                <div class="nm">${escapeHtml(m.itemName || '—')}</div>
                <div class="meta">${meta.label}${m.note ? ' · ' + escapeHtml(m.note) : ''}${valTxt}</div>
              </div>
              <span class="hist-delta ${meta.cls}">${deltaTxt}</span>
              ${afterTxt}
              <span class="hist-time">${timeLabel(m.ts)}</span>
            </div>`;
        });

        html += '</div>';
      });

      historyList.innerHTML = html;
    }

    function clearHistory() {
      if (movements.length === 0) { showToast('Historique déjà vide'); return; }
      if (confirm("Vider tout l'historique des mouvements ?")) {
        apiCall('POST', '/history/clear/')
          .then(function (state) { applyState(state); showToast('Historique vidé'); })
          .catch(fail);
      }
    }

    // ============================================================
    // 12bis. TABLEAU DE BORD (prix & ventes)
    // ============================================================
    // Une sortie de stock ('out') = une vente.
    function renderDashboard() {
      const tk = todayKey();
      const sales = movements.filter(m => isOut(m.type));

      let caTotalVal = 0, caTodayVal = 0, soldTodayQty = 0;
      sales.forEach(m => {
        caTotalVal += (m.value || 0);
        if (dayKey(m.ts) === tk) { caTodayVal += (m.value || 0); soldTodayQty += m.qty; }
      });
      const stockValue = items.reduce((acc, it) => acc + (it.quantity || 0) * (it.price || 0), 0);

      caToday.textContent = fmtPrice(caTodayVal);
      caTotal.textContent = fmtPrice(caTotalVal);
      soldToday.textContent = soldTodayQty;
      dashStockValue.textContent = fmtPrice(stockValue);

      // --- Ventes récentes ---
      const recent = sales.slice().reverse().slice(0, 12);
      if (recent.length === 0) {
        salesList.innerHTML = `
          <div class="empty-state">
            ${ico('cart')}
            Aucune vente enregistrée<br>
            <small>Réduisez le stock d'un article (−) pour enregistrer une vente</small>
          </div>`;
      } else {
        let html = '';
        recent.forEach(m => {
          const sameDay = dayKey(m.ts) === tk;
          const when = sameDay ? timeLabel(m.ts) : new Date(m.ts).toLocaleDateString('fr-FR') + ' ' + timeLabel(m.ts);
          html += `
            <div class="hist-row">
              <span class="hist-ico out">${ico('cart')}</span>
              <div class="hist-main">
                <div class="nm">${escapeHtml(m.itemName || '—')}</div>
                <div class="meta">${m.qty} × ${fmtPrice((m.value || 0) / (m.qty || 1))} · ${escapeHtml(m.note || 'Vente')}</div>
              </div>
              <span class="hist-delta out">${fmtPrice(m.value)}</span>
              <span class="hist-time">${when}</span>
            </div>`;
        });
        salesList.innerHTML = html;
      }

      // --- Récap par article (prix, stock, vendus, CA) ---
      const soldByItem = {};
      sales.forEach(m => {
        if (!m.itemId) return;
        if (!soldByItem[m.itemId]) soldByItem[m.itemId] = { qty: 0, val: 0 };
        soldByItem[m.itemId].qty += m.qty;
        soldByItem[m.itemId].val += (m.value || 0);
      });

      if (items.length === 0) {
        priceTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:24px;">Aucun article</td></tr>`;
      } else {
        const rows = items.slice().sort((a, b) => (b.quantity * b.price) - (a.quantity * a.price));
        let html = '';
        rows.forEach(it => {
          const sold = soldByItem[it.id] || { qty: 0, val: 0 };
          html += `
            <tr>
              <td class="name">${escapeHtml(it.name)}</td>
              <td class="num">${fmtPrice(it.price)}</td>
              <td class="num">${it.quantity}</td>
              <td class="num">${fmtPrice((it.quantity || 0) * (it.price || 0))}</td>
              <td class="num">${sold.qty}</td>
              <td class="num rev">${fmtPrice(sold.val)}</td>
            </tr>`;
        });
        priceTableBody.innerHTML = html;
      }
    }

    // ============================================================
    // 12ter. STATISTIQUES (périodes & meilleures ventes)
    // ============================================================
    function shortMoney(n) {
      n = Math.round(Number(n) || 0);
      if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 ? 1 : 0).replace('.', ',') + 'M';
      if (n >= 1000) return Math.round(n / 1000) + 'k';
      return '' + n;
    }

    function periodStart(p) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (p === 'today') return d.getTime();
      if (p === '7d') return d.getTime() - 6 * 86400000;
      if (p === '30d') return d.getTime() - 29 * 86400000;
      return 0; // tout
    }

    function renderStats() {
      const start = periodStart(statsPeriod);
      const sales = movements.filter(m => isOut(m.type) && m.ts >= start);

      let units = 0, revenue = 0;
      sales.forEach(m => { units += m.qty; revenue += (m.value || 0); });
      const count = sales.length;
      const avg = count ? revenue / count : 0;

      statUnits.textContent = units;
      statRevenue.textContent = fmtPrice(revenue);
      statCount.textContent = count;
      statAvg.textContent = fmtPrice(avg);

      // --- Graphique : ventes (CA) par jour ---
      let days;
      if (statsPeriod === 'today') days = 1;
      else if (statsPeriod === '7d') days = 7;
      else if (statsPeriod === '30d') days = 30;
      else {
        if (sales.length === 0) days = 1;
        else {
          const first = Math.min.apply(null, sales.map(m => m.ts));
          const f0 = new Date(first); f0.setHours(0, 0, 0, 0);
          const t0 = new Date(); t0.setHours(0, 0, 0, 0);
          days = Math.round((t0 - f0) / 86400000) + 1;
          days = Math.min(30, Math.max(1, days));
        }
      }

      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const buckets = [];
      for (let i = days - 1; i >= 0; i--) buckets.push({ ts: today0.getTime() - i * 86400000, total: 0 });
      const idx = {};
      buckets.forEach((b, i) => { idx[dayKey(b.ts)] = i; });
      movements.forEach(m => {
        if (!isOut(m.type)) return;
        const k = dayKey(m.ts);
        if (idx[k] !== undefined) buckets[idx[k]].total += (m.value || 0);
      });
      const maxVal = Math.max(1, Math.max.apply(null, buckets.map(b => b.total)));

      statChartSub.textContent = days === 1 ? "(aujourd'hui)" : '(' + days + ' derniers jours)';

      if (revenue === 0) {
        salesChart.innerHTML = `
          <div class="empty-state" style="padding:30px 20px;margin:auto;width:100%;">
            ${ico('trending')}
            Aucune vente sur cette période<br>
            <small>Changez de période ou enregistrez des ventes</small>
          </div>`;
      } else {
        const showDetail = days <= 10;
        let html = '';
        buckets.forEach(b => {
          const h = b.total > 0 ? Math.max(4, Math.round(b.total / maxVal * 100)) : 0;
          const d = new Date(b.ts);
          const lblShort = pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
          const wd = d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
          const lbl = showDetail ? wd + '<br>' + lblShort : pad(d.getDate());
          html += `
            <div class="bar-col" title="${escapeHtml(dayLabel(b.ts))} : ${fmtPrice(b.total)}">
              <div class="bar-amount">${b.total > 0 ? shortMoney(b.total) : ''}</div>
              <div class="bar-track"><div class="bar-fill ${b.total > 0 ? '' : 'empty'}" style="height:${h}%"></div></div>
              <div class="bar-label">${lbl}</div>
            </div>`;
        });
        salesChart.innerHTML = html;
      }

      // --- Top boissons les plus vendues (sur la période) ---
      const agg = {};
      sales.forEach(m => {
        if (!m.itemId) return;
        if (!agg[m.itemId]) {
          const it = items.find(x => x.id === m.itemId);
          agg[m.itemId] = { name: it ? it.name : m.itemName, qty: 0, val: 0 };
        }
        agg[m.itemId].qty += m.qty;
        agg[m.itemId].val += (m.value || 0);
      });
      const ranking = Object.keys(agg).map(k => agg[k]).sort((a, b) => b.qty - a.qty).slice(0, 8);

      if (ranking.length === 0) {
        topDrinks.innerHTML = `
          <div class="empty-state" style="padding:30px 20px;">
            ${ico('trophy')}
            Aucune vente sur cette période<br>
            <small>Le classement des articles s'affichera ici</small>
          </div>`;
      } else {
        const maxQ = Math.max(1, ranking[0].qty);
        let html = '';
        ranking.forEach((r, i) => {
          const w = Math.max(6, Math.round(r.qty / maxQ * 100));
          const top3 = i < 3 ? ' top' + (i + 1) : '';
          html += `
            <div class="rank-row">
              <span class="rank-pos${top3}">${i + 1}</span>
              <div class="rank-main">
                <div class="rank-top">
                  <span class="rank-name">${escapeHtml(r.name || '—')}</span>
                  <span class="rank-val"><b>${r.qty}</b> vendus · ${fmtPrice(r.val)}</span>
                </div>
                <div class="rank-track"><div class="rank-fill" style="width:${w}%"></div></div>
              </div>
            </div>`;
        });
        topDrinks.innerHTML = html;
      }
    }

    // ============================================================
    // 13. TODO
    // ============================================================
    function getFilteredTodos() {
      if (todoFilter === 'active') return todos.filter(t => !t.completed);
      if (todoFilter === 'completed') return todos.filter(t => t.completed);
      return todos;
    }

    function renderTodos() {
      const filtered = getFilteredTodos();

      if (filtered.length === 0) {
        todoList.innerHTML = `
          <div class="empty-state">
            ${ico('clipboard')}
            ${todos.length === 0 ? 'Aucune tâche' : 'Aucune tâche ne correspond au filtre'}<br>
            <small>${todos.length === 0 ? 'Ajoutez vos tâches à faire !' : 'Modifiez vos filtres'}</small>
          </div>`;
      } else {
        let html = '';
        filtered.forEach(todo => {
          const text = escapeHtml(todo.text);
          const priorityLabels = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };
          html += `
            <div class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
              <input type="checkbox" class="todo-check" data-id="${todo.id}" ${todo.completed ? 'checked' : ''}>
              <span class="todo-text">${text}</span>
              <span class="todo-priority priority-${todo.priority}"><span class="dot"></span>${priorityLabels[todo.priority] || 'Moyenne'}</span>
              <button class="todo-delete" data-id="${todo.id}" aria-label="Supprimer">${ico('x')}</button>
            </div>`;
        });
        todoList.innerHTML = html;

        todoList.querySelectorAll('.todo-check').forEach(cb => {
          cb.addEventListener('change', function() { toggleTodo(this.getAttribute('data-id')); });
        });
        todoList.querySelectorAll('.todo-delete').forEach(btn => {
          btn.addEventListener('click', function() { deleteTodo(this.getAttribute('data-id')); });
        });
      }

      const total = todos.length;
      const done = todos.filter(t => t.completed).length;
      todoTotal.textContent = `${total} tâche${total > 1 ? 's' : ''}`;
      todoCompleted.textContent = `${done} terminée${done > 1 ? 's' : ''}`;
      todoBadge.textContent = todos.filter(t => !t.completed).length;
    }

    function addTodo(text, priority) {
      const trimmed = (text || '').trim();
      if (!trimmed) { showToast('Veuillez entrer une tâche', 1200); return; }
      apiCall('POST', '/todos/', { text: trimmed, priority: priority || 'medium' })
        .then(function (state) {
          applyState(state);
          todoInput.value = '';
          todoInput.focus();
          showToast('Tâche ajoutée : ' + trimmed);
        })
        .catch(fail);
    }

    function toggleTodo(id) {
      apiCall('POST', '/todos/' + id + '/toggle/')
        .then(function (state) {
          applyState(state);
          const t = todos.find(x => x.id === id);
          showToast(t && t.completed ? 'Tâche terminée' : 'Tâche réouverte');
        })
        .catch(fail);
    }

    function deleteTodo(id) {
      const todo = todos.find(t => t.id === id);
      const name = todo ? todo.text : '';
      apiCall('DELETE', '/todos/' + id + '/')
        .then(function (state) { applyState(state); showToast('"' + name + '" supprimé'); })
        .catch(fail);
    }

    // ============================================================
    // 14. MISE À JOUR UI GLOBALE
    // ============================================================
    function updateUI() {
      const total = items.reduce((acc, it) => acc + (it.quantity || 0), 0);
      const count = items.length;
      const lowItems = items.filter(it => (it.quantity || 0) > 0 && (it.quantity || 0) <= 3).length;
      const outItems = items.filter(it => (it.quantity || 0) === 0).length;
      totalBadge.textContent = `${total} articles`;
      countDisplay.textContent = `${count} articles`;
      totalItems.textContent = total;
      kpiArticles.textContent = count;
      kpiLow.textContent = lowItems;
      kpiOut.textContent = outItems;
      stockBadge.textContent = count;

      renderItems();
      renderReapproOptions();
      refreshHistDateOptions();
      renderHistory();
      renderDashboard();
      renderStats();
      renderTodos();
      renderArchives();
      renderOrderOptions();
      renderOrders();
      renderCart();
    }

    // ============================================================
    // ARCHIVES — rendu
    // ============================================================
    function renderArchives() {
      archiveBadge.textContent = archives.length;
      if (!archives.length) {
        archiveList.innerHTML = `
          <div class="empty-state">
            ${ico('archive')}
            Aucun inventaire archivé<br>
            <small>Les journées passées seront archivées automatiquement</small>
          </div>`;
        return;
      }
      let html = '';
      archives.forEach(a => {
        const d = new Date(a.day + 'T00:00:00');
        const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const lab = label.charAt(0).toUpperCase() + label.slice(1);
        html += `
          <div class="hist-row">
            <span class="hist-ico neutral">${ico('archive')}</span>
            <div class="hist-main">
              <div class="nm">${escapeHtml(lab)}</div>
              <div class="meta">${a.count} mouvement${a.count > 1 ? 's' : ''} · +${a['in']} entrées · -${a.out} sorties · ventes ${fmtPrice(a.sales_value)}</div>
            </div>
            <button class="btn btn-ghost archive-view" data-id="${a.id}" title="Voir sans télécharger">${ico('search')} Voir</button>
            <a class="btn btn-primary" href="${a.pdf_url}" target="_blank" title="Ouvrir / imprimer en PDF">${ico('download')} PDF</a>
            <button class="btn btn-danger-ghost archive-del" data-id="${a.id}" title="Supprimer l'archive">${ico('trash')}</button>
          </div>`;
      });
      archiveList.innerHTML = html;

      archiveList.querySelectorAll('.archive-view').forEach(btn => {
        btn.addEventListener('click', function () { viewArchive(this.getAttribute('data-id')); });
      });
      archiveList.querySelectorAll('.archive-del').forEach(btn => {
        btn.addEventListener('click', function () { deleteArchive(this.getAttribute('data-id')); });
      });
    }

    // Affiche le contenu d'une archive dans un modal (sans téléchargement)
    const ARCH_TYPE = { in: 'Entrée', create: 'Création', out: 'Sortie', delete: 'Suppression', reset: 'Réinit.' };
    function viewArchive(id) {
      apiCall('GET', '/archives/' + id + '/').then(function (a) {
        const d = new Date(a.day + 'T00:00:00');
        let lab = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        lab = lab.charAt(0).toUpperCase() + lab.slice(1);
        archiveModalTitle.textContent = 'Archive — ' + lab;
        archiveModalDownload.setAttribute('href', '/archive/' + a.id + '/pdf/');
        archiveModalDownload.setAttribute('target', '_blank');

        const s = a.summary || {};
        const moves = a.movements || [];
        const stock = a.stock || [];

        let mvRows = moves.map(function (m) {
          const cls = (m.type === 'out') ? 'rev' : '';
          return '<tr><td>' + escapeHtml(m.time || '') + '</td>'
            + '<td class="name">' + escapeHtml(m.item || '—') + '</td>'
            + '<td>' + (ARCH_TYPE[m.type] || m.type) + '</td>'
            + '<td>' + escapeHtml(m.note || '') + '</td>'
            + '<td class="num">' + m.qty + '</td>'
            + '<td class="num">' + m.after + '</td>'
            + '<td class="num">' + (m.value > 0 ? fmtPrice(m.value) : '—') + '</td></tr>';
        }).join('');
        if (!mvRows) mvRows = '<tr><td colspan="7" class="arch-empty">Aucun mouvement ce jour-là</td></tr>';

        let stRows = stock.map(function (it) {
          return '<tr><td class="name">' + escapeHtml(it.name) + '</td>'
            + '<td class="num">' + it.quantity + '</td>'
            + '<td class="num">' + fmtPrice(it.price) + '</td>'
            + '<td class="num">' + fmtPrice(it.value) + '</td></tr>';
        }).join('');
        if (!stRows) stRows = '<tr><td colspan="4" class="arch-empty">Inventaire vide</td></tr>';

        archiveModalBody.innerHTML =
          '<div class="arch-sum">'
          + '<span class="in">+' + (s['in'] || 0) + ' entrées</span>'
          + '<span class="out">-' + (s.out || 0) + ' sorties</span>'
          + '<span class="val">Ventes : ' + fmtPrice(s.sales_value || 0) + '</span>'
          + '<span>' + (s.count || 0) + ' mouvement(s)</span>'
          + '</div>'
          + '<div class="arch-h">' + ico('history') + ' Historique de la journée</div>'
          + '<div class="table-wrap"><table class="dash-table"><thead><tr>'
          + '<th>Heure</th><th>Article</th><th>Type</th><th>Motif</th>'
          + '<th class="num">Qté</th><th class="num">Stock</th><th class="num">Montant</th>'
          + '</tr></thead><tbody>' + mvRows + '</tbody></table></div>'
          + '<div class="arch-h">' + ico('box') + ' Inventaire (au moment de l\'archivage)</div>'
          + '<div class="table-wrap"><table class="dash-table"><thead><tr>'
          + '<th>Article</th><th class="num">En stock</th><th class="num">Prix unit.</th><th class="num">Valeur</th>'
          + '</tr></thead><tbody>' + stRows + '</tbody></table></div>';

        archiveModal.classList.add('show');
      }).catch(fail);
    }

    function closeArchiveModal() { archiveModal.classList.remove('show'); }

    // ============================================================
    // COMMANDES (prise de commande -> ventes)
    // ============================================================
    function renderOrderOptions() {
      const inStock = items.filter(it => (it.quantity || 0) > 0);
      const prev = orderItem.value;
      if (!inStock.length) {
        orderItem.innerHTML = '<option value="">Aucun article en stock</option>';
        return;
      }
      orderItem.innerHTML = inStock.map(it =>
        '<option value="' + it.id + '">' + escapeHtml(it.name) + ' — ' + fmtPrice(it.price) + ' (stock ' + it.quantity + ')</option>'
      ).join('');
      if (inStock.some(it => it.id === prev)) orderItem.value = prev;
    }

    function addCartLine() {
      const id = orderItem.value;
      const item = items.find(it => it.id === id);
      if (!item) { showToast('Choisissez un article'); return; }
      let q = parseInt(orderQty.value, 10);
      if (isNaN(q) || q < 1) q = 1;
      const existing = cart.find(l => l.itemId === id);
      const already = existing ? existing.qty : 0;
      if (already + q > (item.quantity || 0)) {
        showToast('Stock insuffisant : ' + item.quantity + ' en stock', 1800);
        return;
      }
      if (existing) existing.qty += q;
      else cart.push({ itemId: id, name: item.name, price: item.price, qty: q });
      orderQty.value = '1';
      renderCart();
    }

    function removeCartLine(i) {
      cart.splice(i, 1);
      renderCart();
    }

    function renderCart() {
      if (!cart.length) {
        cartList.innerHTML = '<div class="cart-empty">Panier vide — ajoutez des articles ci-dessus</div>';
        cartTotal.textContent = fmtPrice(0);
        return;
      }
      let total = 0, html = '';
      cart.forEach((l, i) => {
        const lt = l.qty * l.price;
        total += lt;
        html += '<div class="cart-line">'
          + '<span class="c-qty">' + l.qty + '</span>'
          + '<span class="c-name">' + escapeHtml(l.name) + '</span>'
          + '<span class="c-pu">' + fmtPrice(l.price) + ' / u</span>'
          + '<span class="c-tot">' + fmtPrice(lt) + '</span>'
          + '<button class="c-del" data-i="' + i + '" title="Retirer">' + ico('x') + '</button>'
          + '</div>';
      });
      cartList.innerHTML = html;
      cartTotal.textContent = fmtPrice(total);
      cartList.querySelectorAll('.c-del').forEach(b => {
        b.addEventListener('click', function () { removeCartLine(parseInt(this.getAttribute('data-i'), 10)); });
      });
    }

    function validateOrder() {
      if (!cart.length) { showToast('Panier vide'); return; }
      const payload = { label: orderLabel.value.trim(), lines: cart.map(l => ({ item_id: l.itemId, qty: l.qty })) };
      apiCall('POST', '/orders/', payload)
        .then(function (state) {
          cart = [];
          orderLabel.value = '';
          applyState(state); // met à jour stock, ventes, historique, commandes (+ panier vidé)
          showToast('Commande validée');
        })
        .catch(fail);
    }

    function renderOrders() {
      ordersBadge.textContent = orders.length;
      if (!orders.length) {
        ordersList.innerHTML = `
          <div class="empty-state">
            ${ico('orders')}
            Aucune commande<br>
            <small>Créez une commande ci-dessus — le stock se met à jour automatiquement</small>
          </div>`;
        return;
      }
      const tk = todayKey();
      let html = '';
      orders.slice(0, 40).forEach(o => {
        const sameDay = dayKey(o.ts) === tk;
        const when = sameDay ? timeLabel(o.ts) : new Date(o.ts).toLocaleDateString('fr-FR') + ' ' + timeLabel(o.ts);
        const itemsTxt = o.lines.map(l => l.qty + '× ' + escapeHtml(l.name)).join(', ');
        const label = o.label ? escapeHtml(o.label) : ('Commande #' + o.id);
        html += '<div class="order-row">'
          + '<span class="o-ico">' + ico('orders') + '</span>'
          + '<div class="o-main"><div class="nm">' + label + '</div><div class="meta">' + itemsTxt + '</div></div>'
          + '<span class="o-tot">' + fmtPrice(o.total) + '</span>'
          + '<span class="o-time">' + when + '</span>'
          + '<button class="o-del" data-id="' + o.id + '" title="Supprimer">' + ico('trash') + '</button>'
          + '</div>';
      });
      ordersList.innerHTML = html;
      ordersList.querySelectorAll('.o-del').forEach(b => {
        b.addEventListener('click', function () { deleteOrder(this.getAttribute('data-id')); });
      });
    }

    function deleteOrder(id) {
      if (!confirm("Supprimer cette commande ? (le stock vendu n'est pas restauré)")) return;
      apiCall('DELETE', '/orders/' + id + '/')
        .then(function (state) { applyState(state); showToast('Commande supprimée'); })
        .catch(fail);
    }

    function archiveNow() {
      apiCall('POST', '/archive/run/')
        .then(function (state) { applyState(state); showToast("Journée archivée"); })
        .catch(fail);
    }

    function deleteArchive(id) {
      if (!confirm("Supprimer cette archive ?")) return;
      apiCall('DELETE', '/archives/' + id + '/')
        .then(function (state) { applyState(state); showToast('Archive supprimée'); })
        .catch(fail);
    }

    // ============================================================
    // 15. NAVIGATION SPA
    // ============================================================
    function navigateTo(page) {
      Object.keys(pages).forEach(key => pages[key].classList.remove('active'));
      if (pages[page]) pages[page].classList.add('active');
      navTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.page === page));

      const meta = pageMeta[page];
      if (meta) pageTitle.innerHTML = ico(meta.icon) + ' ' + meta.title + ' <small>' + meta.sub + '</small>';
      if (page === 'qrcodes') loadQr($('qrN').value || 12);
      if (page === 'caisse') {
        const fr = $('caisseFrame');
        if (fr && !fr.src && fr.dataset.src) fr.src = fr.dataset.src;  // chargement à la 1ère ouverture
      }
      closeSidebar();
    }

    // ============================================================
    // 16. SIDEBAR MOBILE
    // ============================================================
    function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('show'); }
    function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('show'); }
    menuBtn.addEventListener('click', openSidebar);
    overlay.addEventListener('click', closeSidebar);

    // ============================================================
    // 17. ÉVÉNEMENTS
    // ============================================================
    function casesToQty(casesEl, qtyEl) {
      let cases = parseInt(casesEl.value, 10);
      if (isNaN(cases) || cases < 0) cases = 0;
      let units = parseInt(qtyEl.value, 10);
      if (isNaN(units) || units < 0) units = 0;
      return cases * CASE_SIZE + units;
    }

    // Met à jour l'aide « total » selon l'onglet actif
    function updateAddHint() {
      const active = newForm.hasAttribute('hidden') ? 'reappro' : 'new';
      const total = active === 'reappro'
        ? casesToQty(reapproCases, reapproQty)
        : casesToQty(newCases, newQty);
      addTotalHint.textContent = total + (total > 1 ? ' unités' : ' unité');
    }

    // Liste déroulante des boissons existantes (réappro)
    function renderReapproOptions() {
      const prev = reapproItem.value;
      if (!items.length) {
        reapproItem.innerHTML = '<option value="">Aucun article — créez-en un</option>';
        return;
      }
      reapproItem.innerHTML = items.map(it =>
        '<option value="' + it.id + '">' + escapeHtml(it.name) + ' (stock ' + it.quantity + ')</option>'
      ).join('');
      if (items.some(it => it.id === prev)) reapproItem.value = prev;
    }

    // Bascule d'onglet
    function setAddTab(tab) {
      addTabs.querySelectorAll('.seg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      reapproForm.toggleAttribute('hidden', tab !== 'reappro');
      newForm.toggleAttribute('hidden', tab !== 'new');
      updateAddHint();
    }

    // Type (boisson / nourriture) du nouvel article — sélecteur segmenté
    function selectedNewKind() {
      if (!newKind) return 'drink';
      const active = newKind.querySelector('.seg-tab.active');
      return (active && active.dataset.kind === 'food') ? 'food' : 'drink';
    }
    function setNewKind(kind) {
      if (!newKind) return;
      newKind.querySelectorAll('.seg-tab').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    }

    // Réapprovisionner une boisson existante (entrée de stock)
    function handleReappro(e) {
      e.preventDefault();
      const id = reapproItem.value;
      if (!id) { showToast('Choisissez un article', 1400); return; }
      const qty = casesToQty(reapproCases, reapproQty);
      if (qty < 1) { showToast('Indiquez des casiers ou des unités', 1600); return; }
      apiCall('POST', '/items/' + id + '/move/', { type: 'in', qty: qty, note: 'Réapprovisionnement' })
        .then(function (state) {
          applyState(state);
          const it = items.find(x => x.id === id);
          reapproCases.value = '0'; reapproQty.value = '0'; updateAddHint();
          showToast('+' + qty + (it ? ' → ' + it.name + ' (' + it.quantity + ')' : ''));
        })
        .catch(fail);
    }

    // Créer un nouvel article (avec photo) — multipart
    function handleNewDrink(e) {
      e.preventDefault();
      const name = newName.value.trim();
      if (!name) { showToast('Entrez un nom', 1400); newName.focus(); return; }
      let qty = casesToQty(newCases, newQty);
      if (qty < 1) qty = 1;
      let price = parseFloat((newPrice.value || '0').replace(',', '.'));
      if (isNaN(price) || price < 0) price = 0;
      const category = (newCategory.value || '').trim();
      const kind = selectedNewKind();

      const file = (newImage.files && newImage.files[0]) ? newImage.files[0] : null;
      window.BarStock.upload('/items/', { name: name, quantity: qty, price: price, category: category, kind: kind }, file)
        .then(function (state) {
          applyState(state);
          newName.value = ''; newCategory.value = ''; newPrice.value = ''; newImage.value = '';
          newCases.value = '0'; newQty.value = '0'; updateAddHint();
          showToast(name + ' créé');
          setAddTab('reappro');
        })
        .catch(fail);
    }

    navTabs.forEach(tab => {
      tab.addEventListener('click', function() {
        const page = this.dataset.page;
        if (page) navigateTo(page);
      });
    });

    filterSelect.addEventListener('change', renderItems);
    stockSearch.addEventListener('input', renderItems);

    // Modale prix
    priceConfirm.addEventListener('click', savePrice);
    priceCancel.addEventListener('click', closePriceModal);
    priceClose.addEventListener('click', closePriceModal);
    priceModal.addEventListener('click', e => { if (e.target === priceModal) closePriceModal(); });
    priceInput.addEventListener('keydown', e => { if (e.key === 'Enter') savePrice(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && priceModal.classList.contains('show')) closePriceModal(); });
    resetBtn.addEventListener('click', resetStock);

    // Approvisionnement (onglets + formulaires)
    addTabs.querySelectorAll('.seg-tab').forEach(b => {
      b.addEventListener('click', function () { setAddTab(this.dataset.tab); });
    });
    if (newKind) newKind.querySelectorAll('.seg-tab').forEach(b => {
      b.addEventListener('click', function () { setNewKind(this.dataset.kind); });
    });
    reapproForm.addEventListener('submit', handleReappro);
    newForm.addEventListener('submit', handleNewDrink);
    [reapproCases, reapproQty, newCases, newQty].forEach(el => el.addEventListener('input', updateAddHint));

    histSearch.addEventListener('input', renderHistory);
    histType.addEventListener('change', renderHistory);
    histDate.addEventListener('change', renderHistory);
    clearHistoryBtn.addEventListener('click', clearHistory);
    exportPdfBtn.addEventListener('click', exportHistoryPDF);
    archiveNowBtn.addEventListener('click', archiveNow);
    orderAddLine.addEventListener('click', addCartLine);
    orderValidate.addEventListener('click', validateOrder);
    orderQty.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addCartLine(); } });
    archiveModalClose.addEventListener('click', closeArchiveModal);
    archiveModalOk.addEventListener('click', closeArchiveModal);
    archiveModal.addEventListener('click', e => { if (e.target === archiveModal) closeArchiveModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && archiveModal.classList.contains('show')) closeArchiveModal();
    });

    statPeriods.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', function() {
        statPeriods.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        statsPeriod = this.dataset.period;
        renderStats();
      });
    });

    todoAddBtn.addEventListener('click', function() {
      addTodo(todoInput.value, todoPriority.value);
    });
    todoInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') todoAddBtn.click(); });

    todoFilterBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        todoFilterBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        todoFilter = this.dataset.filter;
        renderTodos();
      });
    });

    // ============================================================
    // 18. SYNCHRO MULTI-APPAREILS
    // ============================================================
    // Recharge l'état du serveur quand l'onglet redevient actif
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) loadState().catch(function () {});
    });

    // Resynchronisation en arrière-plan : la couche hors ligne pousse le nouvel état.
    window.addEventListener('barstock:state', function (e) { if (e.detail) applyState(e.detail); });

    // ============================================================
    // 18b. MODALES D'ADMINISTRATION (Réglages / Équipe / QR codes)
    // ============================================================
    const adminModals = { settings: $('settingsModal'), team: $('teamModal') };

    function openAdminModal(name) {
      const m = adminModals[name];
      if (!m) return;
      m.classList.add('show');
      if (name === 'settings') loadSettings();
      else if (name === 'team') loadTeam();
    }
    function closeAdminModal(name) { if (adminModals[name]) adminModals[name].classList.remove('show'); }

    // Requête JSON directe (hors couche file d'attente — actions gérant en ligne)
    function jsonFetch(method, url, payload) {
      const opts = { method: method, headers: {} };
      if (payload !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(payload); }
      return fetch(url, opts).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || ('Erreur (' + r.status + ')'));
          return data;
        });
      });
    }

    // ---- Réglages ----
    function loadSettings() {
      jsonFetch('GET', '/api/settings/').then(function (d) {
        $('settingsName').value = d.name || '';
        const wrap = $('settingsTypes');
        wrap.innerHTML = (d.types || []).map(function (t) {
          const checked = t[0] === d.type ? ' checked' : '';
          return '<label class="type-opt"><input type="radio" name="settingsType" value="' + t[0] + '"' + checked + '><span>' + escapeHtml(t[1]) + '</span></label>';
        }).join('');
      }).catch(fail);
    }
    $('settingsSave').addEventListener('click', function () {
      const name = $('settingsName').value.trim();
      if (!name) { showToast('Entrez un nom', 1400); return; }
      const checked = document.querySelector('input[name="settingsType"]:checked');
      jsonFetch('POST', '/api/settings/', { name: name, type: checked ? checked.value : 'bar' })
        .then(function () { showToast('Réglages enregistrés ✓'); setTimeout(function () { location.reload(); }, 500); })
        .catch(fail);
    });

    // ---- Équipe ----
    function renderTeam(serveurs) {
      const list = $('teamList');
      if (!serveurs || !serveurs.length) { list.innerHTML = '<div class="team-empty">Aucun serveur. Ajoutez-en un ci-dessus.</div>'; return; }
      list.innerHTML = serveurs.map(function (s) {
        return '<div class="team-row"><span class="team-who">' + ico('clipboard') + ' ' + escapeHtml(s.username) + '</span>'
          + '<button class="btn btn-ghost team-del" data-id="' + s.id + '">' + ico('trash') + ' Supprimer</button></div>';
      }).join('');
      list.querySelectorAll('.team-del').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('Supprimer ce serveur ?')) return;
          jsonFetch('DELETE', '/api/team/' + this.getAttribute('data-id') + '/').then(function (d) { renderTeam(d.serveurs); showToast('Serveur supprimé'); }).catch(fail);
        });
      });
    }
    function loadTeam() { jsonFetch('GET', '/api/team/').then(function (d) { renderTeam(d.serveurs); }).catch(fail); }
    $('teamAddForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const u = $('teamUser').value.trim(), p = $('teamPass').value;
      if (!u || !p) { showToast('Identifiant et mot de passe requis', 1600); return; }
      jsonFetch('POST', '/api/team/', { username: u, password: p }).then(function (d) {
        $('teamUser').value = ''; $('teamPass').value = '';
        renderTeam(d.serveurs); showToast('Serveur ajouté ✓');
      }).catch(fail);
    });

    // ---- QR codes ----
    function loadQr(n) {
      const grid = $('qrGrid');
      grid.innerHTML = '<div class="qr-loading">Génération…</div>';
      jsonFetch('GET', '/api/qrcodes/?n=' + encodeURIComponent(n || 12)).then(function (d) {
        $('qrN').value = d.n;
        grid.innerHTML = (d.tables || []).map(function (t) {
          return '<div class="qr-card"><div class="qr-table">Table ' + t.n + '</div>'
            + '<img src="' + t.qr + '" alt="QR Table ' + t.n + '">'
            + '<div class="qr-cta">Scannez pour commander</div></div>';
        }).join('');
      }).catch(function (e) { grid.innerHTML = '<div class="qr-loading">Erreur : ' + escapeHtml(e.message) + '</div>'; });
    }
    $('qrForm').addEventListener('submit', function (e) { e.preventDefault(); loadQr($('qrN').value); });
    $('qrPrint').addEventListener('click', function () {
      document.body.classList.add('printing-qr');
      window.print();
    });
    window.addEventListener('afterprint', function () { document.body.classList.remove('printing-qr'); });

    // Ouverture / fermeture
    document.querySelectorAll('button[data-modal]').forEach(function (b) {
      b.addEventListener('click', function () { openAdminModal(this.getAttribute('data-modal')); });
    });
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeAdminModal(this.getAttribute('data-close')); });
    });
    Object.keys(adminModals).forEach(function (name) {
      const m = adminModals[name];
      if (m) m.addEventListener('click', function (e) { if (e.target === m) closeAdminModal(name); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      Object.keys(adminModals).forEach(function (name) {
        if (adminModals[name] && adminModals[name].classList.contains('show')) closeAdminModal(name);
      });
    });

    // ============================================================
    // 19. INIT
    // ============================================================
    function init() {
      updateAddHint();
      navigateTo('dashboard');
      loadState().catch(function (e) { showToast('Connexion au serveur impossible', 3000); });
    }

    try {
      init();
      console.log('%c[BUUB] Application initialisée ✓', 'color:#38a169;font-weight:700');
    } catch (err) {
      console.error('[BUUB] Échec init :', err);
      throw err; // remonte au logger global pour affichage à l\'écran
    }

  })();
