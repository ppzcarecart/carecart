// Tiny client-side helpers used by the EJS views.

// Register the service worker so the app installs as a PWA on mobile.
// The registration is fire-and-forget — if it fails (older browsers,
// http://, etc.) the rest of the JS still works.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

window.ppz = (function () {
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      credentials: 'same-origin',
      ...options,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ---- Edit-page helpers (image upload + variant CRUD + save) ----
  // These read state from `ppz._editPage` which is set inline by the
  // product-edit.ejs page just before invoking ppz.bindImageUpload().

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/uploads', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  function isNewPage() { return !!ppz._newPage; }

  // Money helpers: forms show SGD with two decimals, server stores integer cents.
  function dollarsToCents(v) {
    if (v === '' || v == null) return undefined;
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.round(n * 100);
  }
  function intOrUndef(v) {
    if (v === '' || v == null) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  }

  async function uploadAndAttachOne(file) {
    const productId = ppz._editPage.productId;
    const { url } = await uploadFile(file);
    return api('/api/products/' + productId + '/images', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  // New-page mode: upload to /api/uploads, buffer the URL client-side,
  // and attach it to the product on the final create call.
  async function uploadAndStoreOne(file) {
    const { url } = await uploadFile(file);
    ppz._newPage.imageUrls.push(url);
    return { url, _new: true };
  }

  function appendImageTile(image) {
    const grid = document.getElementById('imageGrid');
    if (!grid) return;
    const tile = document.createElement('div');
    tile.className = 'image-tile';
    if (image.id) tile.dataset.imageId = image.id;
    if (image._new) tile.dataset.imageUrl = image.url;
    tile.innerHTML = `
      <img src="${image.url}" alt="">
      <button type="button" class="image-remove" title="Remove">×</button>
    `;
    tile.querySelector('button').addEventListener('click', () => {
      if (image._new) removeNewImage(image.url);
      else removeProductImage(image.id);
    });
    grid.appendChild(tile);
    updateImgCount(+1);
  }

  function updateImgCount(delta) {
    const el = document.getElementById('imgCount');
    if (!el) return;
    el.textContent = Math.max(0, parseInt(el.textContent || '0', 10) + delta);
  }

  async function removeProductImage(imageId) {
    if (!confirm('Remove this image?')) return;
    const productId = ppz._editPage.productId;
    try {
      await api(`/api/products/${productId}/images/${imageId}`, { method: 'DELETE' });
      const tile = document.querySelector(`.image-tile[data-image-id="${imageId}"]`);
      if (tile) tile.remove();
      updateImgCount(-1);
    } catch (e) { alert(e.message); }
  }

  function removeNewImage(url) {
    ppz._newPage.imageUrls = ppz._newPage.imageUrls.filter((u) => u !== url);
    const tile = document.querySelector(`.image-tile[data-image-url="${CSS.escape(url)}"]`);
    if (tile) tile.remove();
    updateImgCount(-1);
  }

  async function handleFiles(fileList) {
    const remaining = 8 - parseInt(document.getElementById('imgCount').textContent || '0', 10);
    if (remaining <= 0) {
      alert('Maximum 8 images per product reached.');
      return;
    }
    const files = Array.from(fileList).slice(0, remaining);
    if (files.length < fileList.length) {
      alert(`Only ${remaining} more image(s) can be added.`);
    }
    for (const f of files) {
      try {
        const img = isNewPage() ? await uploadAndStoreOne(f) : await uploadAndAttachOne(f);
        appendImageTile(img);
      } catch (e) { alert(`Upload failed for ${f.name}: ${e.message}`); }
    }
  }

  function bindImageUpload() {
    const input = document.getElementById('imageInput');
    const zone = document.getElementById('imageDropZone');
    if (!input || !zone) return;
    input.addEventListener('change', () => {
      if (input.files && input.files.length) handleFiles(input.files);
      input.value = '';
    });
    ['dragover','dragenter'].forEach((ev) => {
      zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('dragging'); });
    });
    ['dragleave','drop'].forEach((ev) => {
      zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('dragging'); });
    });
    zone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
  }

  // Variants
  function addVariantRow() {
    const body = document.getElementById('variantBody');
    const empty = document.getElementById('noVariants');
    const table = document.getElementById('variantTable');
    if (empty) empty.hidden = true;
    if (table) table.hidden = false;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" name="name" placeholder="Size: M / Color: Black"></td>
      <td><input type="text" name="sku" placeholder="Optional SKU"></td>
      <td class="num"><input type="number" step="0.01" min="0" name="priceOverride" placeholder="—"></td>
      <td class="num"><input type="number" step="0.01" min="0" name="ppzPriceOverride" placeholder="—"></td>
      <td class="num"><input type="number" min="0" step="1" name="pointsPriceOverride" placeholder="—"></td>
      <td class="num"><input type="number" min="0" step="1" name="stock" value="0"></td>
      <td class="actions">
        <button class="cc-btn cc-btn-outline" style="padding:4px 10px; font-size:.78rem;" type="button">Save</button>
        <button class="cc-btn cc-btn-ghost" style="padding:4px 10px; font-size:.78rem;" type="button">Delete</button>
      </td>
    `;
    const [saveBtn, delBtn] = tr.querySelectorAll('.actions button');
    saveBtn.addEventListener('click', () => saveVariantRow(saveBtn));
    delBtn.addEventListener('click', () => deleteVariantRow(delBtn));
    body.appendChild(tr);
  }

  function readVariantRow(tr) {
    const getInput = (n) => tr.querySelector(`input[name="${n}"]`);
    const get = (n) => {
      const el = getInput(n);
      return el ? el.value.trim() : '';
    };
    return {
      id: tr.dataset.variantId || undefined,
      name: get('name'),
      sku: get('sku') || undefined,
      priceCentsOverride: dollarsToCents(get('priceOverride')),
      ppzPriceCentsOverride: dollarsToCents(get('ppzPriceOverride')),
      pointsPriceOverride: intOrUndef(get('pointsPriceOverride')),
      stock: intOrUndef(get('stock')) ?? 0,
    };
  }

  async function saveVariantRow(btn) {
    const tr = btn.closest('tr');
    const dto = readVariantRow(tr);
    if (!dto.name) { alert('Variant name is required'); return; }
    // New-page: variants are buffered in DOM only, persisted on createProduct().
    if (isNewPage()) {
      btn.textContent = 'Ready ✓';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
      return;
    }
    const productId = ppz._editPage.productId;
    try {
      const saved = await api(`/api/products/${productId}/variants`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      tr.dataset.variantId = saved.id;
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    } catch (e) { alert(e.message); }
  }

  async function deleteVariantRow(btn) {
    const tr = btn.closest('tr');
    const id = tr.dataset.variantId;
    if (!isNewPage() && id) {
      if (!confirm('Delete this variant?')) return;
      const productId = ppz._editPage.productId;
      try {
        await api(`/api/products/${productId}/variants/${id}`, { method: 'DELETE' });
      } catch (e) { alert(e.message); return; }
    }
    tr.remove();
    if (!document.querySelectorAll('#variantBody tr').length) {
      const empty = document.getElementById('noVariants');
      const table = document.getElementById('variantTable');
      if (empty) empty.hidden = false;
      if (table) table.hidden = true;
    }
  }

  async function saveProduct() {
    const productId = ppz._editPage.productId;
    const form = document.getElementById('productForm');
    const fd = new FormData(form);
    const allowPts = !!form.querySelector('input[name="allowPointsRedemption"]')?.checked;
    const body = {
      name: fd.get('name'),
      description: fd.get('description') || undefined,
      priceCents: dollarsToCents(fd.get('price')),
      ppzPriceCents: dollarsToCents(fd.get('ppzPrice')),
      // When auto-redemption is on, server computes points from the rate;
      // null wipes any manual value.
      pointsPrice: allowPts ? null : intOrUndef(fd.get('pointsPrice')),
      allowPointsRedemption: allowPts,
      deliveryFeeCentsOverride: dollarsToCents(fd.get('deliveryFee')) ?? null,
      stock: intOrUndef(fd.get('stock')) ?? 0,
      categoryId: fd.get('categoryId') || null,
      active: fd.get('active') === 'true',
    };
    try {
      await api('/api/products/' + productId, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const status = document.createElement('div');
      status.textContent = 'Saved ✓';
      status.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--brand);color:#fff;padding:10px 18px;border-radius:10px;z-index:100;box-shadow:var(--shadow-md);';
      document.body.appendChild(status);
      setTimeout(() => status.remove(), 1800);
    } catch (e) { alert(e.message); }
  }

  async function deleteFromEdit(returnTo) {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    const productId = ppz._editPage.productId;
    try {
      await api('/api/products/' + productId, { method: 'DELETE' });
      location.href = returnTo;
    } catch (e) { alert(e.message); }
  }

  // Submit the New product form: collect details, buffered images,
  // and any added variant rows, then POST /api/products in one shot.
  async function createProduct() {
    const form = document.getElementById('productForm');
    const fd = new FormData(form);

    if (!fd.get('name')) { alert('Product name is required'); return; }
    if (fd.get('price') === '' || fd.get('price') == null) {
      alert('Price is required'); return;
    }
    if (ppz._newPage.isAdmin && !fd.get('vendorId')) {
      alert('Please select a fulfilment vendor'); return;
    }

    const variants = Array.from(document.querySelectorAll('#variantBody tr'))
      .map((tr) => {
        const dto = readVariantRow(tr);
        delete dto.id;
        return dto;
      })
      .filter((v) => v.name);

    const allowPts = !!form.querySelector('input[name="allowPointsRedemption"]')?.checked;
    const body = {
      name: fd.get('name'),
      description: fd.get('description') || undefined,
      priceCents: dollarsToCents(fd.get('price')),
      ppzPriceCents: dollarsToCents(fd.get('ppzPrice')),
      pointsPrice: allowPts ? undefined : intOrUndef(fd.get('pointsPrice')),
      allowPointsRedemption: allowPts,
      deliveryFeeCentsOverride: dollarsToCents(fd.get('deliveryFee')),
      stock: intOrUndef(fd.get('stock')) ?? 0,
      categoryId: fd.get('categoryId') || undefined,
      active: fd.get('active') === 'true',
      imageUrls: ppz._newPage.imageUrls.slice(),
      variants,
    };
    if (ppz._newPage.isAdmin) {
      body.vendorId = fd.get('vendorId') || undefined;
    }

    try {
      await api('/api/products', { method: 'POST', body: JSON.stringify(body) });
      location.href = ppz._newPage.returnTo;
    } catch (e) { alert(e.message); }
  }

  async function refreshPoints(btn) {
    if (!btn) return;
    btn.classList.add('is-loading');
    try {
      const data = await api('/api/points/balance');
      if (data && typeof data.balance === 'number') {
        const v = btn.querySelector('.cc-points-value');
        if (v) v.textContent = Number(data.balance).toLocaleString();
        btn.classList.add('is-flash');
        setTimeout(() => btn.classList.remove('is-flash'), 600);
      }
    } catch (e) {
      // Silent failure — keep cached value visible.
    } finally {
      btn.classList.remove('is-loading');
    }
  }

  // Sync the full profile (balance + lifetime + team + name + contact)
  // from the partner app and update the displayed values in place.
  async function syncProfile(btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      const r = await api('/api/points/sync-profile', { method: 'POST' });
      if (r.notLinked) {
        alert('This account is not linked to the partner app.');
        return;
      }
      if (r.notConfigured) {
        alert('Partner API is not configured on this deploy.');
        return;
      }
      const u = r.user || {};
      const set = (id, v) => {
        const el = document.getElementById(id);
        if (el && v != null) el.textContent = String(v);
      };
      set('pf-name', u.name);
      set('pf-email', u.email);
      set('pf-contact', u.contact || '—');
      set('pf-team', u.team ?? '—');
      if (u.ppzCurrency != null) {
        set('pf-ppzCurrency', Number(u.ppzCurrency).toLocaleString());
      }
      if (u.lifetimePpzCurrency != null) {
        set('pf-lifetime', Number(u.lifetimePpzCurrency).toLocaleString());
      }
      // Refresh the address card with the partner-app value.
      const addrBody = document.getElementById('pf-address-body');
      if (addrBody && u.address) {
        const a = u.address;
        const parts = [a.city, a.state, a.postalCode].filter(Boolean).join(' ');
        addrBody.innerHTML =
          '<div class="profile-address">' +
            '<span class="tag tag-active mb-2">Default</span>' +
            '<div>' + escapeHtml(a.line1 || '') + '</div>' +
            (a.line2 ? '<div>' + escapeHtml(a.line2) + '</div>' : '') +
            (parts ? '<div class="text-muted">' + escapeHtml(parts) + '</div>' : '') +
            '<div class="text-muted">' + escapeHtml(a.country || '') + '</div>' +
          '</div>';
      }
      // Reflect new balance in the navbar pill, if visible.
      const navPill = document.querySelector('.cc-points-pill .cc-points-value');
      if (navPill && u.ppzCurrency != null) {
        navPill.textContent = Number(u.ppzCurrency).toLocaleString();
      }
      btn.textContent = 'Synced ✓';
      setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
      return;
    } catch (e) {
      alert('Sync failed: ' + e.message);
    }
    btn.textContent = original;
    btn.disabled = false;
  }

  async function changePassword(form) {
    const fd = new FormData(form);
    const newPassword = fd.get('newPassword');
    const confirm = fd.get('confirmPassword');
    const cur = fd.get('currentPassword');
    const status = document.getElementById('pwdStatus');
    if (status) { status.textContent = ''; status.style.color = ''; }

    const PWD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\d\W])[\s\S]{8,}$/;
    if (!PWD_RE.test(newPassword)) {
      if (status) {
        status.style.color = '#b91c1c';
        status.textContent = 'At least 8 characters with upper, lower, and a digit or symbol.';
      }
      return;
    }
    if (newPassword !== confirm) {
      if (status) {
        status.style.color = '#b91c1c';
        status.textContent = 'Passwords do not match.';
      }
      return;
    }

    const body = { newPassword };
    if (cur) body.currentPassword = cur;
    try {
      await api('/api/auth/password', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (status) {
        status.style.color = 'var(--brand)';
        status.textContent = 'Password saved ✓';
      }
      // Reload so the card switches from "Set password" → "Change password"
      // (it reads profile.hasSetPassword which just flipped server-side).
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      if (status) {
        status.style.color = '#b91c1c';
        status.textContent = e.message || 'Failed to update password';
      }
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // ---- Auto-points toggle on product create/edit ----
  // Reads pointsPerDollar from ppz._editPage / ppz._newPage (injected by
  // the EJS page) and updates the preview live as the price changes.
  function pointsRate() {
    return (ppz._editPage && ppz._editPage.pointsPerDollar)
      || (ppz._newPage && ppz._newPage.pointsPerDollar)
      || 50;
  }

  function computeAutoPointsCents(priceCents) {
    const dollars = Math.ceil((priceCents || 0) / 100);
    return dollars * pointsRate();
  }

  function bindAllowPointsToggle() {
    const toggle = document.getElementById('allowPointsRedemption');
    const priceEl = document.querySelector('input[name="price"]');
    const ppzPriceEl = document.querySelector('input[name="ppzPrice"]');
    const pointsInput = document.getElementById('pointsPriceInput');
    const preview = document.getElementById('pointsPreview');
    if (!toggle || !preview) return;

    function refresh() {
      const on = toggle.checked;
      // Use the smaller of normal/PPZ price for the preview, since members
      // would see the PPZ price.
      const normalCents = dollarsToCents(priceEl?.value) ?? 0;
      const ppzCents = dollarsToCents(ppzPriceEl?.value);
      const cashCents = (ppzCents != null && ppzCents > 0) ? ppzCents : normalCents;
      const pts = computeAutoPointsCents(cashCents);
      if (on) {
        preview.textContent = pts > 0 ? `${pts.toLocaleString()} pts (auto)` : 'set a price first';
        if (pointsInput) {
          pointsInput.value = '';
          pointsInput.disabled = true;
          pointsInput.placeholder = 'Auto-calculated';
        }
      } else {
        preview.textContent = `would be ${pts.toLocaleString()} pts at $1 = ${pointsRate()} pts`;
        if (pointsInput) {
          pointsInput.disabled = false;
          pointsInput.placeholder = 'Blank to disable';
        }
      }
    }

    toggle.addEventListener('change', refresh);
    if (priceEl) priceEl.addEventListener('input', refresh);
    if (ppzPriceEl) ppzPriceEl.addEventListener('input', refresh);
    refresh();
  }

  async function patchSettingsBulk(payload, statusEl) {
    if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
    try {
      await api('/api/settings', { method: 'PATCH', body: JSON.stringify(payload) });
      if (statusEl) {
        statusEl.style.color = 'var(--brand)';
        statusEl.textContent = 'Saved ✓';
      }
    } catch (e) {
      if (statusEl) {
        statusEl.style.color = '#b91c1c';
        statusEl.textContent = e.message || 'Failed to save';
      }
    }
  }

  async function saveCollectionPoint(form) {
    const fd = new FormData(form);
    await patchSettingsBulk({
      'collection.line1': fd.get('collection.line1') || '',
      'collection.line2': fd.get('collection.line2') || '',
      'collection.postalCode': fd.get('collection.postalCode') || '',
      'collection.contact': fd.get('collection.contact') || '',
      'collection.hours': fd.get('collection.hours') || '',
    }, document.getElementById('collectionStatus'));
  }

  async function savePartnerSettings(form) {
    const fd = new FormData(form);
    await patchSettingsBulk({
      'partner.closeUrl': (fd.get('partner.closeUrl') || '').toString().trim(),
    }, document.getElementById('partnerStatus'));
    // Refresh the in-page value so a follow-up Home tap uses the new URL
    // without requiring a reload.
    window.ppzPartnerCloseUrl = (fd.get('partner.closeUrl') || '').toString().trim();
  }

  async function saveDeliverySettings(form) {
    const fd = new FormData(form);
    const enabled = !!form.querySelector('input[name="delivery.enabled"]')?.checked;
    const fee = dollarsToCents(fd.get('delivery.fee')) ?? 0;
    await patchSettingsBulk({
      'delivery.enabled': enabled ? 'true' : 'false',
      'delivery.feeCents': String(fee),
    }, document.getElementById('deliveryStatus'));
  }

  async function patchSelf(payload, statusEl) {
    if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
    try {
      await api('/api/users/me', { method: 'PATCH', body: JSON.stringify(payload) });
      if (statusEl) {
        statusEl.style.color = 'var(--brand)';
        statusEl.textContent = 'Saved ✓';
      }
    } catch (e) {
      if (statusEl) {
        statusEl.style.color = '#b91c1c';
        statusEl.textContent = e.message || 'Failed to save';
      }
    }
  }

  async function saveVendorCollection(form) {
    const fd = new FormData(form);
    await patchSelf({
      useOwnCollectionLocation: !!form.querySelector('input[name="useOwnCollectionLocation"]')?.checked,
      collectionLine1: fd.get('collectionLine1') || null,
      collectionLine2: fd.get('collectionLine2') || null,
      collectionPostalCode: fd.get('collectionPostalCode') || null,
      collectionContact: fd.get('collectionContact') || null,
      collectionHours: fd.get('collectionHours') || null,
    }, document.getElementById('vCollectionStatus'));
  }

  // Cart fulfilment-method picker. Posts to /cart?method=collection so the
  // server-rendered summary updates (delivery fee, collection points list).
  function pickFulfilment(method) {
    const m = method === 'collection' ? 'collection' : 'delivery';
    const url = new URL(location.href);
    url.searchParams.set('method', m);
    location.href = url.pathname + '?' + url.searchParams.toString();
  }

  function setShippingAddress(form) {
    const fd = new FormData(form);
    const addr = {
      line1: fd.get('line1') || '',
      postalCode: fd.get('postalCode') || '',
      country: 'SG',
    };
    if (!addr.line1 || !addr.postalCode) {
      alert('Please enter address line and postal code');
      return false;
    }
    window.ppz._cart = window.ppz._cart || {};
    window.ppz._cart.fulfilmentMethod = 'delivery';
    window.ppz._cart.shippingAddress = addr;
    return true;
  }

  async function saveVendorDelivery(form) {
    const fd = new FormData(form);
    const fee = dollarsToCents(fd.get('vendorDeliveryFee'));
    await patchSelf({
      useOwnDeliveryFee: !!form.querySelector('input[name="useOwnDeliveryFee"]')?.checked,
      vendorDeliveryFeeCents: fee == null ? null : fee,
    }, document.getElementById('vDeliveryStatus'));
  }

  async function savePointsRate(form) {
    const fd = new FormData(form);
    const status = document.getElementById('rateStatus');
    if (status) { status.textContent = ''; status.style.color = ''; }
    try {
      await api('/api/settings/points-per-dollar', {
        method: 'PATCH',
        body: JSON.stringify({ value: parseInt(fd.get('value'), 10) }),
      });
      if (status) {
        status.style.color = 'var(--brand)';
        status.textContent = 'Saved ✓';
      }
    } catch (e) {
      if (status) {
        status.style.color = '#b91c1c';
        status.textContent = e.message || 'Failed to save';
      }
    }
  }

  function imgFallback(img) {
    if (img.dataset.ppzFallback === '1') return;
    img.dataset.ppzFallback = '1';
    const bg = img.dataset.fallbackBg || '#cbd5e1';
    const init = (img.dataset.fallbackInitial || '?').replace(/[<>&"]/g, '');
    const div = document.createElement('div');
    div.className = 'cc-placeholder';
    div.style.cssText = `background:${bg};height:100%;width:100%;`;
    div.innerHTML = `<span>${init}</span>`;
    img.replaceWith(div);
  }

  /**
   * Try to close the in-app webview and hand control back to the
   * partner app. We try multiple bridges in order of preference so the
   * partner team can wire any one of them and we'll pick it up:
   *
   *   1. iOS WKWebView script message handler "closeWebView"
   *      Set up via:
   *        webView.configuration.userContentController.add(self, name: "closeWebView")
   *
   *   2. Android JavascriptInterface "Android.closeWebView()"
   *      Set up via:
   *        webView.addJavascriptInterface(JsBridge(), "Android")
   *
   *   3. Custom URL scheme — the partner app intercepts navigation
   *      to "papazao://close" and closes the webview.
   *
   *   4. Final fallback: history.back(), which in many in-app
   *      browsers maps to closing the chrome.
   */
  function exitToApp() {
    try {
      if (
        window.webkit &&
        window.webkit.messageHandlers &&
        window.webkit.messageHandlers.closeWebView
      ) {
        window.webkit.messageHandlers.closeWebView.postMessage(null);
        return;
      }
    } catch (e) {}

    try {
      if (window.Android && typeof window.Android.closeWebView === 'function') {
        window.Android.closeWebView();
        return;
      }
    } catch (e) {}

    // Configurable URL scheme — admin sets it in /admin/settings →
    // Partner integration. Empty string disables this attempt and
    // falls straight through to history.back().
    const closeUrl = (window.ppzPartnerCloseUrl || '').trim();
    if (closeUrl) {
      try {
        window.location.href = closeUrl;
        // Some partner apps need a moment to handle the scheme. If
        // history.back fires too soon it can navigate before close.
        setTimeout(() => {
          try { history.back(); } catch (e) {}
        }, 250);
        return;
      } catch (e) {}
    }

    try { history.back(); } catch (e) {}
  }

  // ---- Collection scanner ----
  // Used by /admin/collection and /vendor/collection. Wraps html5-qrcode
  // (loaded via CDN on those pages only) and the /api/collection
  // endpoints. Renders the scan result inline and lets staff confirm
  // "Mark as collected" — duplicates and unauthorized scans short-circuit
  // and surface a warning.
  const collection = (() => {
    let scanner = null;
    let busy = false;
    let modalOpen = false;
    const lastValue = { v: null, at: 0 };

    function el(id) { return document.getElementById(id); }
    function setStatus(s) { const n = el('scannerStatus'); if (n) n.textContent = s; }

    function escapeHtml(str) {
      return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    }

    // Map a scan result to {tone, title}. tone drives the modal border:
    //   success → green, duplicate → red, everything else → grey.
    function toneFor(result) {
      if (result === 'success') return 'success';
      if (result === 'duplicate') return 'danger';
      return 'warning';
    }
    function titleFor(result) {
      return ({
        success: 'Ready to collect',
        duplicate: 'Duplicate collection',
        unauthorized_vendor: 'Not your vendor',
        not_found: 'Invalid code',
        invalid_state: 'Cannot collect',
      }[result]) || 'Scan result';
    }

    function buildBody(outcome) {
      const o = outcome.order;
      let html = '';
      html += `<p class="lede">${escapeHtml(outcome.message)}</p>`;
      if (!o) return html;

      html += `<dl class="profile-dl">`;
      html += `<dt>Order</dt><dd><strong>${escapeHtml(o.number)}</strong></dd>`;
      html += `<dt>Status</dt><dd><span class="badge-status ${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></dd>`;
      if (o.customerName) {
        html += `<dt>Customer</dt><dd>${escapeHtml(o.customerName)}</dd>`;
      }
      if (o.customerEmail) {
        html += `<dt>Email</dt><dd>${escapeHtml(o.customerEmail)}</dd>`;
      }
      if (o.customerContact) {
        html += `<dt>Contact</dt><dd>${escapeHtml(o.customerContact)}</dd>`;
      }
      if (o.customerPpzId) {
        html += `<dt>PPZ ID</dt><dd>${escapeHtml(o.customerPpzId)}</dd>`;
      }
      html += `<dt>Total</dt><dd>$${(o.totalCents/100).toFixed(2)}${o.pointsTotal > 0 ? ' + ' + Number(o.pointsTotal).toLocaleString() + ' pts' : ''}</dd>`;
      if (o.collectedAt) {
        html += `<dt>Collected</dt><dd>${new Date(o.collectedAt).toLocaleString()}${o.collectedByName ? ' by ' + escapeHtml(o.collectedByName) : ''}</dd>`;
      }
      html += `</dl>`;

      if (o.items && o.items.length) {
        html += `<ul class="scan-items">`;
        html += o.items.map((it) =>
          `<li>${escapeHtml(it.productName)} ×${it.quantity}${it.vendorName ? ' <span class="text-muted">(' + escapeHtml(it.vendorName) + ')</span>' : ''}</li>`
        ).join('');
        html += `</ul>`;
      }
      return html;
    }

    function buildActions(outcome) {
      if (outcome.result === 'success' && outcome.order) {
        return (
          `<button type="button" class="cc-btn cc-btn-ghost" onclick="ppz.collection.dismiss()">Cancel</button>` +
          `<button type="button" class="cc-btn cc-btn-primary" onclick="ppz.collection.markCollected('${escapeHtml(outcome.order.number)}')">Mark as collected</button>`
        );
      }
      return `<button type="button" class="cc-btn cc-btn-primary" onclick="ppz.collection.dismiss()">OK</button>`;
    }

    async function pauseScanner() {
      if (!scanner) return;
      try {
        // html5-qrcode exposes pause(true) to keep the camera stream
        // alive but stop firing the decode callback while the modal is up.
        if (typeof scanner.pause === 'function') scanner.pause(true);
      } catch (_) {}
    }
    function resumeScanner() {
      if (!scanner) return;
      try {
        if (typeof scanner.resume === 'function') scanner.resume();
      } catch (_) {}
    }

    function openModal() {
      const m = el('scanModal');
      if (!m) return;
      m.classList.add('is-open');
      m.setAttribute('aria-hidden', 'false');
      modalOpen = true;
      pauseScanner();
      try { if (navigator.vibrate) navigator.vibrate(40); } catch (_) {}
    }
    function closeModal() {
      const m = el('scanModal');
      if (!m) return;
      m.classList.remove('is-open');
      m.setAttribute('aria-hidden', 'true');
      modalOpen = false;
      // Reset debounce so the next scan of the same QR re-opens the
      // dialog (e.g. staff scans, dismisses, then re-scans the same QR).
      lastValue.v = null;
      resumeScanner();
    }

    function renderResult(outcome) {
      const dialog = el('scanDialog');
      const title = el('scanTitle');
      const body = el('scanBody');
      const actions = el('scanActions');
      if (!dialog || !title || !body || !actions) return;

      dialog.classList.remove('tone-success', 'tone-warning', 'tone-danger');
      dialog.classList.add('tone-' + toneFor(outcome.result));
      title.textContent = titleFor(outcome.result);
      body.innerHTML = buildBody(outcome);
      actions.innerHTML = buildActions(outcome);
      openModal();
    }

    async function lookup(value) {
      const v = (value || '').trim();
      if (!v || busy || modalOpen) return;
      // Debounce: same value within 1.5s is ignored (the camera scans
      // the same QR multiple times per second otherwise).
      const now = Date.now();
      if (lastValue.v === v && now - lastValue.at < 1500) return;
      lastValue.v = v;
      lastValue.at = now;
      busy = true;
      setStatus('Looking up ' + v + '…');
      try {
        const outcome = await api('/api/collection/scan', {
          method: 'POST',
          body: JSON.stringify({ value: v }),
        });
        renderResult(outcome);
        setStatus(outcome.result === 'success' ? 'Found — confirm to collect' : 'Idle');
      } catch (e) {
        setStatus('Error: ' + e.message);
      } finally {
        busy = false;
      }
    }

    async function markCollected(value) {
      busy = true;
      setStatus('Marking as collected…');
      try {
        const outcome = await api('/api/collection/mark', {
          method: 'POST',
          body: JSON.stringify({ value }),
        });
        // Close the confirm dialog and re-render the new outcome so
        // the success flash is visible briefly before the reload.
        closeModal();
        renderResult(outcome);
        setStatus('Collected — refreshing logs…');
        setTimeout(() => location.reload(), 900);
      } catch (e) {
        setStatus('Error: ' + e.message);
      } finally {
        busy = false;
      }
    }

    function dismiss() {
      closeModal();
      setStatus('Idle');
    }

    function errToString(e) {
      if (!e) return 'unknown error';
      if (typeof e === 'string') return e;
      if (e.message) return e.message;
      if (e.name) return e.name;
      try { return JSON.stringify(e); } catch (_) { return String(e); }
    }

    function isPermissionDenied(e) {
      if (!e) return false;
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') return true;
      const m = errToString(e);
      return /NotAllowed|Permission|denied|blocked/i.test(m);
    }

    function showPermissionHelp() {
      const ua = navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
      const isAndroid = /Android/.test(ua);
      // Android WebView marker — Chrome adds "; wv)" inside the device
      // parens when the page is rendered inside an Android WebView
      // (i.e. embedded in a native app), as opposed to standalone
      // Chrome. Reliable enough to branch on.
      const isAndroidWebView = isAndroid && /;\s*wv\)/.test(ua);
      const inApp = /FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|Snapchat/.test(ua);

      let steps = '';
      if (isAndroidWebView) {
        // The page can't fix this on its own — the host (partner) app
        // has to grant the camera permission to its WebView. Tell the
        // user exactly what to ask for so they don't get stuck.
        steps =
          'You\'re inside the partner app\'s Android WebView, which is blocking camera access.\n\n' +
          'The partner app needs:\n' +
          '1. CAMERA permission in AndroidManifest.xml\n' +
          '2. The user (you) to grant camera permission to the partner app — Settings → Apps → [partner app] → Permissions → Camera → Allow\n' +
          '3. The partner app must grant the WebView\'s camera request (Android WebView denies by default — implement WebChromeClient.onPermissionRequest, or in Flutter: setOnPlatformPermissionRequest)\n\n' +
          'Until the partner app is updated, open this page in Chrome on the same phone and the scanner will work there.';
      } else if (inApp) {
        steps =
          'You\'re in an in-app browser (Facebook, Instagram, etc.) which usually blocks camera access.\n\n' +
          'Open this page in your real browser instead:\n' +
          '• Tap the ⋯ or share icon\n' +
          '• Choose "Open in Safari" / "Open in Chrome"';
      } else if (isIOS) {
        steps =
          'iOS Safari needs camera permission for this site:\n\n' +
          '1. Tap the "aA" icon in Safari\'s address bar\n' +
          '2. Choose "Website Settings"\n' +
          '3. Set Camera to "Allow"\n' +
          '4. Reload this page and tap Start camera again\n\n' +
          'If that option isn\'t there, go to: Settings → Safari → Camera → Allow.';
      } else if (isAndroid) {
        steps =
          'Android Chrome needs camera permission for this site:\n\n' +
          '1. Tap the 🔒 lock icon next to the URL\n' +
          '2. Tap "Permissions"\n' +
          '3. Set Camera to "Allow"\n' +
          '4. Reload this page and tap Start camera again';
      } else {
        steps =
          'Allow camera permission for this site:\n\n' +
          '1. Click the 🔒 lock icon in the address bar\n' +
          '2. Set Camera to "Allow"\n' +
          '3. Reload this page and click Start camera again';
      }

      setStatus('Camera blocked — see permission help');
      alert('Camera permission was blocked.\n\n' + steps);
    }

    async function tryStartWith(source) {
      const s = new Html5Qrcode('reader');
      await s.start(
        source,
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => lookup(decoded),
        () => {},
      );
      return s;
    }

    function onStarted() {
      el('startBtn').disabled = true;
      el('stopBtn').disabled = false;
      setStatus('Camera ready · point at QR');
    }

    async function start() {
      if (typeof Html5Qrcode === 'undefined') {
        alert('Scanner library failed to load. Check your network and reload.');
        return;
      }
      if (
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        alert(
          'Camera not available in this browser.\n\n' +
          'Make sure the page is loaded over HTTPS (not HTTP). On iOS, open this page in Safari (in-app browsers like Facebook/Instagram block camera access).',
        );
        return;
      }
      if (scanner) return;

      setStatus('Requesting camera permission…');

      // Try 1 — facingMode environment. This is a single, well-understood
      // permission prompt on iOS Safari and most Chrome builds. We try
      // this first so the user only sees one prompt.
      try {
        scanner = await tryStartWith({ facingMode: { ideal: 'environment' } });
        onStarted();
        return;
      } catch (e1) {
        if (isPermissionDenied(e1)) {
          scanner = null;
          showPermissionHelp();
          return;
        }
        // Other errors (OverconstrainedError on some Android, etc.) —
        // fall through to explicit camera enumeration.
      }

      // Try 2 — enumerate, then start with a specific device id. Useful
      // on Android phones where facingMode rejects with a generic
      // OverconstrainedError.
      try {
        const cams = await Html5Qrcode.getCameras();
        if (!cams || !cams.length) {
          setStatus('No cameras detected');
          alert('No cameras were detected on this device.');
          return;
        }
        const back = cams.find((c) => /back|rear|environment/i.test(c.label || ''));
        const pick = back || cams[cams.length - 1];
        scanner = await tryStartWith(pick.id);
        onStarted();
      } catch (e2) {
        scanner = null;
        if (isPermissionDenied(e2)) {
          showPermissionHelp();
          return;
        }
        const msg = errToString(e2);
        setStatus('Camera failed: ' + msg);
        alert(
          'Could not start camera: ' + msg +
          '\n\nCommon fixes:\n' +
          '• The page must be loaded over HTTPS\n' +
          '• Close other apps that may be using the camera\n' +
          '• On iOS, open this page in Safari (not Chrome / in-app browsers)',
        );
      }
    }

    async function stop() {
      if (!scanner) return;
      try { await scanner.stop(); await scanner.clear(); } catch (e) {}
      scanner = null;
      el('startBtn').disabled = false;
      el('stopBtn').disabled = true;
      setStatus('Stopped');
    }

    function manual() {
      const inp = el('manualInput');
      const v = inp ? inp.value.trim() : '';
      if (!v) { inp && inp.focus(); return; }
      lookup(v);
    }

    // ESC closes the modal. Bound once at module load — no-op if the
    // page doesn't actually have a #scanModal in the DOM.
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && modalOpen) dismiss();
    });

    return { start, stop, manual, markCollected, dismiss };
  })();

  return {
    imgFallback,
    exitToApp,
    collection,
    refreshPoints,
    syncProfile,
    changePassword,
    bindAllowPointsToggle,
    savePointsRate,
    saveCollectionPoint,
    saveDeliverySettings,
    savePartnerSettings,
    saveVendorCollection,
    saveVendorDelivery,
    pickFulfilment,
    setShippingAddress,
    bindImageUpload,
    addVariantRow,
    saveVariantRow,
    deleteVariantRow,
    saveProduct,
    createProduct,
    deleteFromEdit,
    removeProductImage,
    removeNewImage,
    async logout() {
      await api('/api/auth/logout', { method: 'POST' });
      location.href = '/';
    },

    async addToCart(productId, mode) {
      const variantSel = document.getElementById('variantId');
      const qtyEl = document.getElementById('qty');
      const variantId = variantSel ? variantSel.value || undefined : undefined;
      const quantity = qtyEl ? parseInt(qtyEl.value, 10) : 1;
      try {
        await api('/api/cart/items', {
          method: 'POST',
          body: JSON.stringify({ productId, variantId, quantity, pricingMode: mode }),
        });
        location.href = '/cart';
      } catch (e) { alert(e.message); }
    },

    async updateCart(itemId, qty) {
      try { await api('/api/cart/items/' + itemId, { method: 'PATCH', body: JSON.stringify({ quantity: parseInt(qty,10) }) }); location.reload(); }
      catch (e) { alert(e.message); }
    },

    async removeCart(itemId) {
      await api('/api/cart/items/' + itemId, { method: 'DELETE' });
      location.reload();
    },

    async checkout() {
      try {
        const cart = (window.ppz && window.ppz._cart) || {};
        const r = await api('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({
            provider: 'stripe',
            fulfilmentMethod: cart.fulfilmentMethod || 'delivery',
            shippingAddress: cart.shippingAddress || undefined,
          }),
        });
        if (r.payment.checkoutUrl) location.href = r.payment.checkoutUrl;
        else if (r.payment.clientSecret) {
          // PayNow QR confirmation should be handled with Stripe.js. For demo we just show the intent.
          alert('Order ' + r.order.number + ' awaiting PayNow QR. clientSecret: ' + r.payment.clientSecret);
          location.href = '/orders';
        } else if (r.payment.status === 'succeeded') {
          alert('Order paid with points: ' + r.order.number);
          location.href = '/orders';
        } else {
          location.href = '/orders';
        }
      } catch (e) { alert(e.message); }
    },

    async deleteProduct(id) {
      if (!confirm('Delete product?')) return;
      await api('/api/products/' + id, { method: 'DELETE' });
      location.reload();
    },
    async deleteCategory(id) {
      if (!confirm('Delete category?')) return;
      await api('/api/categories/' + id, { method: 'DELETE' });
      location.reload();
    },
    async setOrderStatus(id, status) {
      await api('/api/orders/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
    },
    async syncAllPpzUsers(btn) {
      if (!confirm('Refresh balance and lifetime for every PPZ-linked user? This calls the partner app once per user and may take a few seconds.')) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Syncing…';
      try {
        const r = await api('/api/points/sync-all', { method: 'POST' });
        btn.textContent = `Synced ${r.synced} of ${r.total} (skipped ${r.skipped}, failed ${r.failed})`;
        setTimeout(() => location.reload(), 900);
        return;
      } catch (e) {
        alert(e.message);
      }
      btn.textContent = original;
      btn.disabled = false;
    },
    async syncUserFromPpz(btn, userId) {
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Syncing…';
      try {
        const r = await api('/api/points/users/' + userId + '/sync', { method: 'POST' });
        if (r.notLinked) { alert('This user is not linked to a PPZ ID.'); return; }
        if (r.notConfigured) { alert('Partner API is not configured on this deploy.'); return; }
        const u = r.user || {};
        const cur = document.getElementById('td-ppzCurrency');
        const life = document.getElementById('td-lifetime');
        if (cur && u.ppzCurrency != null) cur.textContent = Number(u.ppzCurrency).toLocaleString();
        if (life && u.lifetimePpzCurrency != null) life.textContent = Number(u.lifetimePpzCurrency).toLocaleString();
        btn.textContent = 'Synced ✓';
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
        return;
      } catch (e) {
        alert('Sync failed: ' + e.message);
      }
      btn.textContent = original;
      btn.disabled = false;
    },
    async addPointsToUser(form, userId) {
      const fd = new FormData(form);
      const amount = parseInt(fd.get('amount'), 10);
      const reason = (fd.get('reason') || '').toString().trim();
      const errEl = document.getElementById('addPointsError');
      if (errEl) errEl.textContent = '';
      if (!Number.isFinite(amount) || amount <= 0) {
        if (errEl) errEl.textContent = 'Amount must be a positive whole number.';
        return;
      }
      if (!reason) {
        if (errEl) errEl.textContent = 'Please enter a reason.';
        return;
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Adding…'; }
      try {
        const r = await api('/api/points/users/' + userId + '/add', {
          method: 'POST',
          body: JSON.stringify({ amount, reason }),
        });
        // Update displayed balance + lifetime in place, then dismiss modal.
        const cur = document.getElementById('td-ppzCurrency');
        const life = document.getElementById('td-lifetime');
        if (cur && r.newPpzCurrency != null) cur.textContent = Number(r.newPpzCurrency).toLocaleString();
        if (life && r.newLifetimePpzCurrency != null) life.textContent = Number(r.newLifetimePpzCurrency).toLocaleString();
        // Reset form, close modal via Bootstrap.
        form.reset();
        const modal = document.getElementById('addPointsModal');
        if (modal && window.bootstrap?.Modal) {
          const inst = window.bootstrap.Modal.getInstance(modal);
          if (inst) inst.hide();
        }
      } catch (e) {
        if (errEl) errEl.textContent = e.message || 'Add points failed';
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Confirm add'; }
      }
    },
    async submitRefund(form, id) {
      const fd = new FormData(form);
      const reason = (fd.get('reason') || '').toString().trim();
      const errEl = document.getElementById('refundError');
      if (errEl) errEl.textContent = '';
      if (!reason) {
        if (errEl) errEl.textContent = 'Please enter a refund reason.';
        return;
      }
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Refunding…'; }
      try {
        await api('/api/orders/' + id + '/refund', {
          method: 'POST',
          body: JSON.stringify({ reason }),
        });
        location.reload();
      } catch (e) {
        if (errEl) errEl.textContent = e.message || 'Refund failed';
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Confirm refund'; }
      }
    },
    async setFeatured(id, featured, checkbox) {
      try {
        await api('/api/products/' + id + '/featured', {
          method: 'PATCH',
          body: JSON.stringify({ featured }),
        });
      } catch (e) {
        // revert the toggle if the server rejected (e.g. 8-cap)
        if (checkbox) checkbox.checked = !featured;
        alert(e.message);
      }
    },
    async updateUser(id, patch) {
      await api('/api/users/' + id, { method: 'PATCH', body: JSON.stringify(patch) });
    },
    async toggleUser(id, active) {
      await api('/api/users/' + id, { method: 'PATCH', body: JSON.stringify({ active }) });
      location.reload();
    },
    async updateStock(productId, variantId, stock) {
      await api('/api/products/' + productId + '/stock', {
        method: 'PATCH',
        body: JSON.stringify({ stock: parseInt(stock, 10), variantId: variantId || undefined }),
      });
    },
    async addVariantPrompt(productId) {
      const name = prompt('Variant name (e.g. Size: M)');
      if (!name) return;
      const stock = parseInt(prompt('Initial stock?', '0') || '0', 10);
      await api('/api/products/' + productId + '/variants', {
        method: 'POST',
        body: JSON.stringify({ name, stock }),
      });
      location.reload();
    },
    async deleteVariant(productId, variantId) {
      if (!confirm('Delete variant?')) return;
      await api('/api/products/' + productId + '/variants/' + variantId, { method: 'DELETE' });
      location.reload();
    },
  };
})();
