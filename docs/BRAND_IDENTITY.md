# FairwayWeather brand identity

The mark is an original geometric monogram. A vertical flagstick, a small pennant, and a sweeping fairway form an abstract F. A thin arc above the fairway is the horizon and the weather, not a cloud, sun, or raindrop.

It is one colour in the master files. Stroke ends are round. There are no gradients, shadows, embedded fonts, or raster images inside the SVGs.

## Mark

Master files live in `dev/assets/brand/`.

| File | Use |
| --- | --- |
| `fairwayweather-mark.svg` | Deep green `#175C4D` on transparent |
| `fairwayweather-mark-light.svg` | Off-white `#F7F9F4` on transparent, for green backgrounds |
| `fairwayweather-mark-dark.svg` | Ink `#13211B` on transparent |

Construction, in one viewBox:

- Flagstick: vertical stroke, round caps
- Flag: a small pennant flying to the right from the top of the stick
- Fairway: a thicker stroke that leaves the stick and rises toward the right
- Horizon: a thinner arc in the upper right, clear of the pennant

Do not redraw these relationships. The fairway is the long gesture. The pennant is shorter than the fairway. The horizon arc stays thin and separate.

## Clear space

Keep clear space of at least one quarter of the mark’s width on every side. Do not let type, rules, or other symbols enter that margin. The wordmark files already include the gap between mark and name. Do not tighten it.

## Colours

| Token | Hex | Role |
| --- | --- | --- |
| `--brand-primary` / `--brand` | `#175C4D` | Master mark, actions |
| `--brand-deep` | `#0E3A30` | Deep green |
| Icon background | `#124C40` | App icon field |
| `--brand-offwhite` | `#F7F9F4` | Symbol on green |
| `--brand-ink` | `#13211B` | Wordmark on light backgrounds, mono mark |
| `--brand-surface` | `#E4EFEA` | Soft green surface |
| `--brand-accent` | `#B89552` | Interface accent only |

The identity is deep green and warm white. Gold is not part of the mark. The pennant already reads as a flag in one colour, and a second colour inside the symbol would break the master.

## Wordmark

The name is **FairwayWeather**, one word. In HTML, Fairway is Inter 700 and Weather is Inter 500. Inter is already loaded by the `/dev/` app.

SVG wordmarks do not rely on a font being installed. The letters are outlines converted from Inter:

| File | Colour |
| --- | --- |
| `fairwayweather-wordmark.svg` | Green mark, ink name, for light backgrounds |
| `fairwayweather-wordmark-light.svg` | Entire lockup in `#F7F9F4` |
| `fairwayweather-lockup.svg` | Mark, name, and the tagline “Know before you tee.” |
| `fairwayweather-social.svg` | Wide lockup with the tagline |

The tagline belongs on the lockup and on the home first-run. It is not part of the header logo.

## Small mark

Below 32px, use `fairwayweather-micro.svg` or `favicon.svg`. Those drop the horizon arc and keep the flagstick, pennant, and fairway at a heavier stroke so the shape survives at 16–24px. Do not shrink the full mark and hope the arc remains visible.

## App icon

`fairwayweather-app-icon.svg` is a square, full-bleed field of `#124C40`. The off-white mark sits at about 65% of the canvas. There is no rounded rectangle, shadow, or gloss in the file. The platform mask supplies the corner radius.

Maskable PNGs (`icon-192-maskable.png`, `icon-512-maskable.png`) use the same artwork with the symbol at about 60% of the full canvas, inside the centre 80% safe zone.

| Raster | Notes |
| --- | --- |
| `icon-192.png`, `icon-512.png`, `icon-1024.png` | Any-purpose, generated from the vector |
| `icon-192-maskable.png`, `icon-512-maskable.png` | Extra padding |
| `favicon.svg`, `favicon-32.png`, `favicon.ico` | Micro mark, referenced only from `/dev/` |

## Approved backgrounds

- Off-white `#F7F9F4` or the app surface `#F4F7F2`: primary green mark
- Deep green `#124C40` or `#175C4D`: off-white mark
- Ink `#13211B`: off-white mark
- White or off-white: ink mono mark, for one-colour print

Do not place the green mark on a mid-green field. Do not place the off-white mark on white.

## Don’ts

- Do not stretch, squash, or rotate the mark
- Do not recolour it outside the palette above
- Do not add shadows, glows, gradients, or outlines
- Do not put it in a circle, badge, or extra container
- Do not add clouds, suns, rain, umbrellas, golf balls, or a golfer
- Do not change the proportion of stick, pennant, fairway, and arc
- Do not substitute a typed letter F
- Do not rebuild it in another typeface
