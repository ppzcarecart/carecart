# carecart

Multi-vendor e-commerce on NestJS + PostgreSQL with admin/manager/vendor/customer roles, optional points-based pricing, Stripe PayNow checkout, and a pluggable payment provider for a future second gateway. Designed to deploy on Railway with a Postgres add-on and a mounted volume for uploads.

## Features

### Roles
- **admin** — full control. Can manage users, categories, all products, all orders.
- **manager** — same as admin except cannot delete users.
- **vendor** — can create/edit/delete only their own products and variants, view their own sales summary and orders.
- **customer** — can browse, buy, and view own orders.

### Catalog
- Categories (admin/manager only).
- Products with **mandatory price** and **optional points price**.
- Variants per product (e.g. size/color), each with optional price/points overrides and own stock.
- Multiple images per product (URLs or uploads).
- Vendor ownership enforced server-side: a vendor cannot edit another vendor's product.

### Commerce
- Cart, with per-line `pricingMode` of `price` or `points`.
- Checkout creates an order, decrements stock, and starts payment.
- Stripe **PayNow** (SGD) PaymentIntent — returns `client_secret` for the QR confirmation flow.
- Generic `manual` provider stub for the second payment gateway you'll integrate later.
- Order statuses: `pending` → `awaiting_payment` → `paid` → `fulfilled`, plus `cancelled` and `refunded`.

### Points (external system)
- A `PointsClient` stub talks to the integrator's API once `POINTS_API_BASE_URL` and `POINTS_API_KEY` are set.
- Until then, points-purchases still go through; the redemption is recorded locally and marked `pending` so it can be reconciled later.

### Bulk import
- Admin/Manager can upload a CSV at `/admin/import` to register customers in bulk. Headers: `Name, Email, Address, Contact, Password`. Existing emails are skipped; per-row errors returned.

### Uploads
- POST `/api/uploads` (admin/manager/vendor) saves a file to the configured `UPLOAD_DIR` (point this at your Railway volume mount, e.g. `/data`).
- GET `/uploads/:filename` serves the file.

## Getting started locally

```bash
cp .env.example .env       # then fill DATABASE_URL, STRIPE_SECRET_KEY, etc.
npm install
npm run start:dev
```

Open http://localhost:3000.

A bootstrap admin is created on first boot from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`. You can also run `npm run seed` to seed an admin, a vendor, a category, and a sample product.

## API summary

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/categories                    (public)
POST   /api/categories                    (admin/manager)
PATCH  /api/categories/:id                (admin/manager)
DELETE /api/categories/:id                (admin/manager)

GET    /api/products                      (public, active only)
GET    /api/products/all                  (admin/manager)
GET    /api/products/mine                 (vendor)
POST   /api/products                      (vendor/admin/manager)
PATCH  /api/products/:id                  (owner-vendor / admin / manager)
DELETE /api/products/:id                  (owner-vendor / admin / manager)
POST   /api/products/:id/variants         (owner-vendor / admin / manager)
DELETE /api/products/:id/variants/:vid    (owner-vendor / admin / manager)
PATCH  /api/products/:id/stock            (owner-vendor / admin / manager)

GET    /api/cart
POST   /api/cart/items
PATCH  /api/cart/items/:id
DELETE /api/cart/items/:id
DELETE /api/cart

POST   /api/checkout                       (creates order from cart and starts payment)
POST   /api/payments/:orderId/start
POST   /api/payments/webhook/stripe        (Stripe webhook; raw body verified)
POST   /api/payments/webhook/manual        (placeholder for second gateway)

GET    /api/orders/mine
GET    /api/orders/vendor                  (vendor)
GET    /api/orders/vendor/sales            (vendor sales summary)
GET    /api/orders                         (admin/manager)
GET    /api/orders/:id
PATCH  /api/orders/:id/status              (admin/manager)

GET    /api/users                          (admin/manager)
POST   /api/users                          (admin/manager)
PATCH  /api/users/:id                      (admin/manager)
DELETE /api/users/:id                      (admin)
POST   /api/users/bulk-import              (multipart CSV; admin/manager)

GET    /api/points/balance                 (proxies external points API)

POST   /api/uploads                        (multipart; admin/manager/vendor)
GET    /uploads/:filename                  (public)
```

## PPZ Ecom API integration

Carecart talks to the partner app's PPZ Ecom API for two things:

1. **H5 single sign-on handoff** — partner app deep-links a user into the
   storefront and we look them up + sign them in.
2. **Points redemption** — when a customer pays with points, we deduct the
   amount from their PPZ balance.

### H5 handoff URL

The partner app's "shop" button should link to:

```
https://<carecart-host>/h5/login?ppzid=<PPZID>&email=<EMAIL>
```

Optional `&redirect=/p/some-product-slug` deep-links to a specific page
(must be a same-origin path, validated server-side).

What carecart does on hit:

1. Calls `GET ecomgetuser?ppzid=<PPZID>` server-side with the `x-api-key` header.
2. Verifies the supplied email matches the API record (case-insensitive).
3. Upserts a local customer row — creates one if new (random password they
   never need), refreshes `ppzId`, `ppzCurrency`, `lifetimePpzCurrency`,
   `team`, `contact` if returning.
4. Issues an HTTP-only JWT cookie and `302`s to the requested page.

Errors redirect to `/login?error=<code>` so the front-end can render a
friendly message:

| code                  | meaning                                |
| --------------------- | -------------------------------------- |
| `ppz_not_configured`  | `PPZ_API_KEY` not set on the deploy   |
| `ppzid_not_found`     | 404 from the partner API              |
| `ppz_auth`            | 401 from the partner API              |
| `email_mismatch`      | email in URL ≠ email on PPZ record    |
| `account_disabled`    | local account marked inactive         |

### Points redemption flow

When `PaymentsService.start` runs for an order with `pointsTotal > 0`,
`PointsService.redeem` `PATCH`es `ecomupdateppz` with `operation: deduct`.
On payment failure (Stripe webhook), `reverse()` `PATCH`es with
`operation: add`. Every call is recorded in `points_transactions` so
it's auditable even if the partner API is offline.

### Env vars

```
PPZ_API_KEY=...                                              # required
PPZ_GET_USER_URL=https://ecomgetuser-grp3nuwoda-uc.a.run.app # default shown
PPZ_UPDATE_PPZ_URL=https://ecomupdateppz-grp3nuwoda-uc.a.run.app
```

Keep `PPZ_API_KEY` server-side only — carecart never sends it to the browser.

## Wiring the second payment gateway later

Implement [`src/payments/providers/manual.provider.ts`](src/payments/providers/manual.provider.ts) (or rename it). It must implement the `PaymentProvider` interface in [`src/payments/providers/payment-provider.interface.ts`](src/payments/providers/payment-provider.interface.ts) — `init` to start a payment, `parseWebhook` to verify and parse callbacks. Add it to the providers map in [`src/payments/payments.service.ts`](src/payments/payments.service.ts).

## Deploying to Railway

1. Create a new Railway project, add the GitHub repo `ppzcarecart/carecart`.
2. Add the **PostgreSQL** plugin. Railway injects `DATABASE_URL` automatically.
3. Add a **Volume** and mount it at e.g. `/data`. Set env var `UPLOAD_DIR=/data`.
4. Set the rest of the env vars (see `.env.example`):
   - `JWT_SECRET`
   - `DATABASE_SSL=true`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY=sgd`
   - `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`
   - `PPZ_API_KEY` (when partner app is ready to integrate)
5. Deploy. The Nixpacks build runs `npm ci && npm run build`; the start command is `node dist/main.js`.
6. In Stripe, register a webhook endpoint pointing to `https://<your-app>.up.railway.app/api/payments/webhook/stripe` and copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

> Note: the app uses TypeORM `synchronize: true` for first-run convenience. For production data safety, generate migrations (`npm run migration:generate -- src/database/migrations/Init`) and switch `synchronize` off in `app.module.ts`.

## Project layout

```
src/
  auth/          JWT + cookie auth, login/register
  users/         User entity, bulk CSV import, role management
  categories/    Categories (admin/manager)
  products/      Products + variants + images, vendor ownership
  cart/          Cart with price/points line modes
  orders/        Orders, vendor sales reporting
  payments/      Stripe PayNow + pluggable provider
  points/        External points API client and audit log
  uploads/       Volume-backed file uploads
  views/         EJS controllers for /, /admin, /vendor, etc.
  common/        Roles, decorators, guards, utils
views/           EJS templates
public/          Static assets (JS/CSS)
```
