# Fairway Weather — Design System (Milestone 1)

Mobile-first design tokens and component guidelines for the rebuild experience at `/dev/`.

---

## Design Principles

1. **Premium, calm, sophisticated** — neutral backgrounds; colour used strategically for scores, status, and accents
2. **Golf-focused** — answer "Should I play?" within ~3 seconds
3. **Mobile-first** — touch targets ≥ 44px; desktop centered column max 1200px
4. **Accessible** — supporting text ≥ 14px; `prefers-reduced-motion` respected
5. **Subtle motion** — transitions 150–300ms ease

---

## Colour Tokens

### Status (Golf Verdict)

| Token | Hex | Use |
|-------|-----|-----|
| `--status-excellent` | `#0B5D2A` | Score 85–100, PLAY hero |
| `--status-good` | `#1F8A42` | Score 72–84 |
| `--status-risky` | `#B8860B` | Score 48–71, RISKY |
| `--status-poor` | `#D97706` | Score 25–47, DELAY |
| `--status-avoid` | `#C0392B` | Score 0–24, AVOID |

Each status has a light background variant: `--status-{name}-bg` at ~8% opacity.

### Brand & Neutrals

| Token | Hex | Use |
|-------|-----|-----|
| `--brand` | `#1F6F78` | Links, active nav, accents |
| `--brand-dark` | `#155158` | Hover states |
| `--surface` | `#FFFFFF` | Cards |
| `--surface-muted` | `#F4F6F8` | Screen background |
| `--border` | `#E2E8F0` | Dividers, card borders |
| `--text-primary` | `#0F172A` | Headings, scores |
| `--text-secondary` | `#475569` | Body, labels |
| `--text-muted` | `#94A3B8` | Hints, placeholders |

### Rain Intensity (Timeline)

| Category | Token | Colour |
|----------|-------|--------|
| Dry | `--rain-dry` | `#94A3B8` |
| Drizzle | `--rain-drizzle` | `#60A5FA` |
| Light | `--rain-light` | `#3B82F6` |
| Moderate | `--rain-moderate` | `#2563EB` |
| Heavy | `--rain-heavy` | `#1D4ED8` |

---

## Typography

**Font stack:** `Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`

| Role | Size (mobile) | Weight | Token |
|------|---------------|--------|-------|
| Hero score | 72px / 4.5rem | 700 | `--text-hero` |
| Verdict label | 28px / 1.75rem | 600 | `--text-verdict` |
| Key info | 18px / 1.125rem | 600 | `--text-key` |
| Body | 16px / 1rem | 400 | `--text-body` |
| Supporting | 14px / 0.875rem | 400 | `--text-support` |
| Caption | 12px / 0.75rem | 500 | `--text-caption` |

Line heights: hero 1.0, verdict 1.2, body 1.5.

---

## Spacing & Layout

| Token | Value |
|-------|-------|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 32px |
| `--app-max-width` | 1200px |
| `--app-padding` | 16px |
| `--nav-height` | 64px |
| `--header-height` | 56px |
| `--touch-min` | 44px |

### Screen Structure

```
┌─────────────────────────────┐
│  DEV banner (optional)      │
├─────────────────────────────┤
│  Course Header (compact)    │
├─────────────────────────────┤
│                             │
│  Main content (scrollable)  │
│  padding-bottom: nav + safe │
│                             │
├─────────────────────────────┤
│  Bottom Navigation (fixed)  │
└─────────────────────────────┘
```

---

## Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 8px | Chips, inputs |
| `--radius-md` | 12px | Cards |
| `--radius-lg` | 16px | Hero, sheets |
| `--radius-full` | 9999px | Pills, nav items |

---

## Shadows

```css
--shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
--shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
--shadow-lg: 0 8px 24px rgba(15, 23, 42, 0.12);
```

---

## Motion

```css
--duration-fast: 150ms;
--duration-normal: 250ms;
--ease-out: cubic-bezier(0.33, 1, 0.68, 1);
```

Reduced motion: disable transforms and set `--duration-fast: 0ms; --duration-normal: 0ms`.

---

## Components

### AppShell
Fixed bottom nav, scrollable main, safe-area insets.

### BottomNavigation
4 tabs: Home, Courses, Forecast, Rounds. Icon + label. Active: brand colour + subtle bg.

### CourseHeader
Compact: course name, location, change button. Optional favourite star (milestone 2).

### DayForecastStrip
Horizontal scroll. 5 day chips with weekday, date, mini score ring. Active day highlighted.

### GolfVerdictHero
Largest element: numeric score (0–100), status label, one-line guidance. Status-coloured accent bar.

### RoundSelector
Unified: tee time `<select>` + 9/18 toggle. Shows round window `11:00 → 15:00`. Auto-recalculates on change.

### RainTimeline
Hourly bars during round window. Intensity colour. Summary: total mm, wettest period, description.

### WeatherImpactCard
Three cards: Rain, Wind, Temperature. Icon, value, short impact line. No separate Gust card (gust folded into Wind).

### ScoreExplanation
Bottom sheet / modal. "Why 82?" → factor list in plain language.

### BestTeeTimeCard
Shown only when alternative ≥ 12 points better. "Use 10:30" button applies tee time.

---

## Loading & Error States

- **Skeleton:** Pulsing grey blocks matching component layout
- **Error:** Friendly message + retry button; never raw API errors
- **Empty:** Prompt to select a course on Forecast tab

---

## Implementation

CSS tokens live in `dev/css/tokens.css`. Component styles in `dev/css/app.css`. Import order: tokens → app.
