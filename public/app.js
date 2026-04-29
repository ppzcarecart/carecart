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

  return {
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
