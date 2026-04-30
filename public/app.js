// Tiny client-side helpers used by the EJS views.
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
      <td class="num"><input type="number" min="0" name="priceCentsOverride" placeholder="—"></td>
      <td class="num"><input type="number" min="0" name="ppzPriceCentsOverride" placeholder="—"></td>
      <td class="num"><input type="number" min="0" name="pointsPriceOverride" placeholder="—"></td>
      <td class="num"><input type="number" min="0" name="stock" value="0"></td>
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
    const num = (v) => v === '' ? undefined : parseInt(v, 10);
    return {
      id: tr.dataset.variantId || undefined,
      name: get('name'),
      sku: get('sku') || undefined,
      priceCentsOverride: num(get('priceCentsOverride')),
      ppzPriceCentsOverride: num(get('ppzPriceCentsOverride')),
      pointsPriceOverride: num(get('pointsPriceOverride')),
      stock: num(get('stock')) ?? 0,
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
    const num = (v) => v === '' || v == null ? undefined : parseInt(v, 10);
    const body = {
      name: fd.get('name'),
      description: fd.get('description') || undefined,
      priceCents: num(fd.get('priceCents')),
      ppzPriceCents: num(fd.get('ppzPriceCents')),
      pointsPrice: num(fd.get('pointsPrice')),
      stock: num(fd.get('stock')) ?? 0,
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
    const num = (v) => v === '' || v == null ? undefined : parseInt(v, 10);

    if (!fd.get('name')) { alert('Product name is required'); return; }
    if (fd.get('priceCents') === '' || fd.get('priceCents') == null) {
      alert('Price is required'); return;
    }
    if (ppz._newPage.isAdmin && !fd.get('vendorId')) {
      alert('Please select a vendor'); return;
    }

    const variants = Array.from(document.querySelectorAll('#variantBody tr'))
      .map((tr) => {
        const dto = readVariantRow(tr);
        delete dto.id;
        return dto;
      })
      .filter((v) => v.name);

    const body = {
      name: fd.get('name'),
      description: fd.get('description') || undefined,
      priceCents: num(fd.get('priceCents')),
      ppzPriceCents: num(fd.get('ppzPriceCents')),
      pointsPrice: num(fd.get('pointsPrice')),
      stock: num(fd.get('stock')) ?? 0,
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
    const body = {
      newPassword: fd.get('newPassword'),
    };
    const cur = fd.get('currentPassword');
    if (cur) body.currentPassword = cur;
    const status = document.getElementById('pwdStatus');
    if (status) { status.textContent = ''; status.style.color = ''; }
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

  return {
    imgFallback,
    refreshPoints,
    syncProfile,
    changePassword,
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
        const r = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ provider: 'stripe' }) });
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
