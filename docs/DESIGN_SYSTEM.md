# Fairway Weather — Design System

Mobile-first design tokens and component guidelines for the rebuild experience at `/dev/`. Updated for the **Premium mobile visual pass** (warm sage app background, deep Fairway green brand, gold accent sparingly, native-like controls).

---

## Design Principles

1. **Premium, calm, sophisticated** — light airy surfaces; colour for verdict labels, rain, and accents — not dashboard fills
2. **Golf-focused** — answer "Should I play?" within ~3 seconds
3. **Mobile-first** — touch targets ≥ 44px; forecast column max **680px** on desktop
4. **Accessible** — supporting text ≥ 14px; `prefers-reduced-motion` respected
5. **Subtle motion** — transitions 150–220ms ease; press states over hover on mobile

---

## Colour Tokens

### Brand & Neutrals

| Token | Hex | Use |
|-------|-----|-----|
| `--app-bg` | `#F4F7F2` | App background (warm sage) |
| `--surface` | `#FFFFFF` | Cards, hero |
| `--surface-soft` | `#EEF3ED` | Secondary buttons, panels |
| `--surface-warm` | `#FAFBF8` | Header glass tint |
| `--brand` | `#175C4D` | Primary actions, active nav, good verdict |
| `--brand-deep` | `#0E3A30` | Active tee time text |
| `--brand-soft` | `#E4EFEA` | Selected tee pill, nav icon pill |
| `--accent-premium` | `#B89552` | Best tee, favourites star (sparingly) |
| `--accent-premium-soft` | `#F4EEDF` | — |
| `--text-primary` | `#13211B` | Hero score, headings |
| `--text-secondary` | `#617069` | Body |
| `--text-muted` | `#8B9891` | Hints, category labels |
| `--border-soft` | `#DDE5DF` | Hairlines |
| `--border-card` | `rgba(19,33,27,0.07)` | Large cards |

### Status (verdict label only — not hero score background)

| Token | Hex | Use |
|-------|-----|-----|
| `--status-excellent` / `--status-good` | `#175C4D` / `#1F6F5C` | GOOD / PLAY |
| `--status-playable` | `#7A8F3A` | Playable |
| `--status-risky` | `#B8860B` | RISKY |
| `--status-poor` | `#C76A2A` | Poor |
| `--status-avoid` | `#B8453A` | AVOID |

### Rain (precipitation blues)

| Token | Hex |
|-------|-----|
| `--rain-dry` | `#A7B3AD` |
| `--rain-drizzle` | `#9BC1D8` |
| `--rain-light` | `#6FA6C8` |
| `--rain-moderate` | `#477FA8` |
| `--rain-heavy` | `#315F84` |

Styles live in [`dev/css/tokens.css`](../dev/css/tokens.css), [`dev/css/app.css`](../dev/css/app.css), and [`dev/css/premium.css`](../dev/css/premium.css).

---

## Typography

**Font stack:** `Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`

| Role | Size (mobile) | Weight |
|------|---------------|--------|
| Hero score | 64–72px | 700 |
| Verdict label | 22–26px | 700, uppercase |
| Section category | 13px | 600, uppercase |
| Key info | 18px | 600 |
| Body / support | 15–16px | 400–500 |

Reserve uppercase for small category labels (e.g. "Rain during your round"). Use title case for "Why this score?" and "More weather details".

---

## Spacing & Layout

| Token | Value |
|-------|-------|
| `--app-padding` | 16px (390px benchmark) |
| `--section-gap` | 24px |
| `--card-padding` | 18px |
| `--forecast-max-width` | 680px |
| `--app-max-width` | 1200px (shell) |
| `--touch-min` | 44px |

Rhythm: 4, 8, 12, 16, 24, 32 — prefer 16–24px between forecast sections.

---

## Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-control` | 12px | Buttons, tee pills |
| `--radius-card` | 18px | Cards, day selected |
| `--radius-hero` | 22px | Verdict hero |
| `--radius-sheet` | 24px | Bottom sheets |

Default card border: `1px solid rgba(23, 92, 77, 0.09)` or `--border-card`.

---

## Shadows

```css
--shadow-soft: 0 1px 2px rgba(18,42,33,.03), 0 8px 24px rgba(18,42,33,.045);
--shadow-elevated: 0 2px 4px rgba(18,42,33,.04), 0 12px 32px rgba(18,42,33,.07);
--shadow-hero: 0 10px 35px rgba(23, 92, 77, 0.06);
```

Most forecast sections use no shadow or `--shadow-soft` only.

---

## Motion

```css
--duration-fast: 180ms;
--duration-normal: 220ms;
--ease-out: cubic-bezier(0.33, 1, 0.68, 1);
```

---

## Components (Forecast hierarchy)

1. Course header (glass, minimal)
2. Five-day strip (soft chips; selected = white + hairline + light shadow)
3. **Verdict hero** — light gradient card; icon → label (status colour) → score (neutral) → message
4. Tee carousel ‹ › + pills; 9/18 segmented control (`#EAF0EC` track)
5. Rain row timeline + mm summary (no per-hour boxes)
6. Shared **impact panel** (Rain / Wind / Feels like)
7. Better tee time (gold accent border, green CTA)
8. More weather details accordion

### Bottom navigation

Glass bar; active tab = brand green text + soft pill behind icon only (not full cell fill).

---

## Implementation

Import order in `dev/index.html`: `tokens.css` → `app.css` → `premium.css`.
