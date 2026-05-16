# TEF LMS Implementation Plan

**Site:** learn.theemployeefactory.com  
**Current state:** OpenMAIC fork live, free/open access, 3 classrooms.  
**Goal:** Paid LMS shell on top of OpenMAIC course-creation engine. Indian market, ₹499/mo subscription.  
**Stack:** Next.js 16 App Router · React 19 · TS · Tailwind 4 · SQLite · Razorpay.

---

## Phase 0 — Source backup (½ day, do first)

- Create private GitHub repo `tef-openmaic-fork`.
- Initial push of `/home/learn.theemployeefactory.com/openmaic_src` (strip `.env*`, `node_modules`, `.next`).
- Add `.gitignore` for `.env.local`, `.env`, `server-providers.yml`, `data/`, `node_modules/`.
- No CI yet — just a remote.

**Done when:** `git push origin main` works from the VPS and the repo shows the source tree.

---

## Phase 1 — Auth foundation (1–2 weeks)

**DB:** SQLite at `data/auth.db`, mounted into the container.
- `users` (id, email, password_hash, role, created_at, email_verified_at)
- `sessions` (id, user_id, jwt_id, expires_at, revoked_at)
- `password_resets` (token_hash, user_id, expires_at)

**Code:**
- `lib/auth/` — `hash.ts` (argon2id), `jwt.ts` (sign/verify HS256, 7-day refresh + 15-min access), `db.ts` (better-sqlite3).
- `app/api/auth/[signup|login|logout|refresh|reset]/route.ts` — REST endpoints.
- `middleware.ts` — protect `/app/*`, `/api/classroom`, `/api/generate/*`; redirect to `/login`.
- `app/(auth)/[login|signup|forgot|reset]/page.tsx` — minimal UI.

**Done when:** new user can sign up → email-less verification → log in → reach `/app` (which is now the OpenMAIC root); anonymous user is bounced to `/login`.

---

## Phase 2 — Razorpay subscriptions (1–2 weeks, depends on Phase 1)

**Razorpay setup:**
- Create plan `tef-monthly-499` (₹499 INR, monthly, no trial).
- Webhook endpoint configured for `subscription.charged`, `subscription.cancelled`, `subscription.halted`, `payment.failed`.

**DB:**
- `subscriptions` (id, user_id, razorpay_sub_id, status, current_period_end, plan_id).
- `payments` (id, user_id, razorpay_payment_id, amount, status, created_at).

**Code:**
- `app/(marketing)/pricing/page.tsx` → checkout button hits `POST /api/billing/subscribe` which creates a Razorpay subscription and returns `subscription_id`; client launches Razorpay Checkout JS.
- `app/api/billing/webhook/route.ts` — verifies `X-Razorpay-Signature` HMAC, updates `subscriptions` table.
- `lib/billing/paywall.ts` — `requireActiveSub(userId)`; called from `app/api/generate/*` and `/app` layout.
- `app/(app)/billing/page.tsx` — user can see plan status, next renewal, cancel.

**Done when:** test card completes a subscription, webhook flips `status=active`, paywall lets the user generate; cancel from `/billing` flips `status=cancelled`.

---

## Phase 3 — Admin dashboard (1 week, depends on Phase 2)

**Route:** `/admin` (protected by `role='admin'` check).

**Views:**
- `/admin/users` — paginated list (email, status, MRR contribution, signup date, last seen, # classrooms).
- `/admin/revenue` — MRR, ARR, churn %, new signups (last 30/90 d), simple Chart.js or Recharts.
- `/admin/courses` — all classrooms across all users (search by topic, owner, date).

**Code:**
- `app/admin/layout.tsx` — admin-only guard.
- `app/api/admin/[users|revenue|courses]/route.ts` — read-only aggregations from SQLite.

**Done when:** Ashish can log in as admin and see live numbers without SSH.

---

## Phase 4 — CRO landing (1 week, can run parallel to Phase 3)

Replace current open homepage (`/`) with marketing landing. Move OpenMAIC app to `/app`.

**Sections (1-2-3 flow):**
1. **Hero:** "Build a complete interactive classroom in 5 minutes." CTA: Start free → /signup.
2. **How it works:** 3 cards — Pick a topic · AI builds slides + roundtable · Teach or sell.
3. **Demo embed:** GIF or short Loom of one of the 3 existing classrooms running.
4. **Pricing:** Single tier ₹499/mo, 7-day free trial.
5. **FAQ + footer.**

**Code:**
- `app/(marketing)/page.tsx` — new landing.
- Move existing OpenMAIC root to `app/(app)/page.tsx`.
- Reuse Tailwind 4 + existing TEF logo assets.

**Done when:** unauthenticated visitor sees marketing page; "Start free" → signup → `/app`.

---

## Cross-cutting

- **Migrations:** simple `lib/db/migrations/NNN_*.sql` runner at container start.
- **Backups:** existing nightly tar already covers `/var/lib/docker/volumes/openmaic_src_openmaic-data` — extend to include the new `auth.db` mount.
- **Secrets:** Razorpay keys, JWT secret, admin seed credentials go in `.env.local` (already gitignored). Document in `CLAUDE.md`.
- **Test card:** Razorpay sandbox `4111 1111 1111 1111` — verify Phase 2 end-to-end on test mode before flipping to live keys.

## Sequencing

```
Phase 0  ────►  Phase 1  ────►  Phase 2  ────►  Phase 3
                                       └────►   Phase 4 (parallel)
```

Total critical path: ~4–6 weeks at one engineer, faster with two.

## Out of scope (do not build yet)

- Multi-tier pricing (annual, team plans) — single tier ships first.
- Email verification (use unverified accounts initially; add later via Resend or AWS SES).
- Course marketplace / public sharing — current per-user classrooms are private.
- Mobile app — web-only MVP.
