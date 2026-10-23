# SurgiLog — design and brand guide

Version 0.7 (published palette) · Updated 23 October 2026 · Working brand for the app

This is the shared reference for the app, presentations, documents and future brand assets. It records the **current implementation** and gives **reuse guidance** for new work. Dylan leads development; Leo provides clinical/product direction. This is a working identity, not a completed institutional brand programme.

Use this guide instead of the earlier proposed palette in planning documents. Values marked **current** come from the repository. Guidance for external materials does not imply that every existing screen already follows it.

## Brand at a glance

| Item | Direction |
| --- | --- |
| Product name | **SurgiLog** — one word, with capital S and L |
| Product description | Surgical backlog and theatre tracking for South African hospital teams |
| Primary audience | Doctors, scrub sisters, clerks, scheduling teams and hospital managers |
| Current tagline | **The trusted clinical register** — embedded in the supplied logo artwork |
| Current headline | **Every patient. Every theatre. Every day.** |
| Supporting line | **Built for South African hospital teams** |
| Personality | Calm, clear, practical, trustworthy and human |
| Visual direction | Deep navy and turquoise, white and pale-aqua surfaces; gold reserved for existing clinical/reporting distinctions |
| Core idea | Help teams see waiting patients, organise theatre time and understand recorded treatment activity |

Keep the product name intact in hospital-specific materials: “SurgiLog · [Hospital name]”. Place hospital identity alongside it with a clear separator. Hospital names and departments are workspace context, not different product brands.

## Colour palette

**Status — 23 October 2026:** Dylan approved the navy/turquoise palette; [PR #3](https://github.com/DylanGeldenhuys/Surgilog/pull/3) merged on 21 October and the palette is now published on Firebase Hosting (**bc29adb91ebd03d2**). Fonts, logo artwork, layout and clinical priority/status meanings are preserved.


![SurgiLog palette: navy, turquoise, action teal, pale aqua, white, mist, silver and slate.](docs/brand-palette.svg)

### Core colours — current

Use HEX for digital work (sRGB). Navy and turquoise are representative samples of the supplied raster logo, not official master/vector values. The logo itself is unchanged. Action teal is deliberately darker for readable controls.

| Name | HEX | RGB | Role / CSS |
| --- | --- | --- | --- |
| Logo navy | `#08203C` | `8, 32, 60` | Headings and strong numbers; `--ink` |
| Logo turquoise | `#08B0C8` | `8, 176, 200` | Brand reference; use for decoration, not small text on white; `--brand-turquoise` |
| Action teal | `#00788A` | `0, 120, 138` | Buttons, links, focus outline, selected navigation text, browser theme; `--action` (`--blue` alias) |
| Large accent text | `#00899D` | `0, 137, 157` | Login “Every day.” and decorative icons; `--accent-text` |
| Clinical white | `#FFFFFF` | `255, 255, 255` | Cards, controls and button text; `--surface` |
| Mist | `#F4F8F9` | `244, 248, 249` | App canvas/install splash; `--canvas` |
| Pale aqua | `#EEF8FA` | `238, 248, 250` | Login story and information panels; `--wash` |
| Selected aqua | `#E2F4F7` | `226, 244, 247` | Active navigation and selections; `--selected` |
| Silver | `#DBE8EC` | `219, 232, 236` | Borders; `--border` |
| Body ink | `#263E50` | `38, 62, 80` | Default text; `--body-ink` |
| Secondary text | `#405E6D` | `64, 94, 109` | Supporting text; `--secondary` |
| Slate | `#5B7380` | `91, 115, 128` | Muted text; `--muted` |

White and pale surfaces dominate; navy anchors the text and teal indicates actions. Existing gold, green, purple and red retain clinical/workflow/reporting meanings. The sign-in review label now uses teal rather than decorative gold.

### Supporting colours — current

| Use | Value |
| --- | --- |
| Activity chart | `#0898AC` (`--chart`) |
| Soft surface / divider / track | `#F8FBFC` / `#EAF1F3` / `#CEE8ED` |
| Gold metric icon / background (unchanged) | `#BF9A53` / `#FAF4E8` |
| Green metric icon / background (unchanged) | `#50927D` / `#EAF6F1` |
| Error text / background / border (unchanged) | `#A25349` / `#FCF0ED` / `#F3DDD5` |
| Pending-entry badge text / background (unchanged) | `#AE8B47` / `#FAF3E5` |

The original logo contains textured gradients. Preserve the artwork; use these flat interface tokens around it. Turquoise `#08B0C8` on white has only 2.61:1 contrast, so it is not the action/text colour. Key preview text/background contrast pairs were calculated; this does not replace a full accessibility audit. Existing clinical semantic colours are unchanged in this preview.

### Clinical and workflow colours

These are **current implementation values**, not a substitute for readable labels. Colour distinguishes concepts; the text carries the meaning.

| Priority label | Text | Background | Chart fill |
| --- | --- | --- | --- |
| P1 · ≤30 days | `#BE6559` | `#FBEEEA` | `#D4867A` |
| P2 · 31–90 days | `#AA874B` | `#FAF3E4` | `#CBB076` |
| P3 · 91–365 days | `#5C8EA9` | `#EDF5FA` | `#77A9C5` |

Always show the target range alongside the priority label, including on phones. Do not infer urgency from a colour or replace the target with an unlabeled dot. Priority policy is documented separately in [clinical priorities](docs/clinical-priorities.md).

| Workflow status | Current text | Current dot |
| --- | --- | --- |
| Waiting / default | `#82929E` | `#AAB8C1` |
| Scheduled | `#5488A8` | `#74A7C7` |
| In theatre | `#8873AD` | `#A38CC0` |
| Completed | `#508F7D` | `#6CAA94` |
| On hold | `#A68A57` | `#C4A96F` |

Keep clinical priority, case status, readiness and sync state visually separate. For example, a scheduled case can still be P1, and an offline completion can still be waiting to sync. Gold used decoratively is not itself a clinical status.

## Typography

| Role | Typeface | Weights currently bundled | Reuse guidance |
| --- | --- | --- | --- |
| Headings and major numbers | **Manrope** | 600, 800 | Original app typography retained at Dylan’s request; 800 for prominent titles, 600 for supporting headings |
| Body, controls, tables, labels | **DM Sans** | 400, 600 | 400 for reading; 600 for emphasis and controls |
| Fallback | `system-ui, sans-serif` | Platform-dependent | Use when the brand fonts are unavailable |

Font references: [Manrope](https://fonts.google.com/specimen/Manrope), [DM Sans](https://fonts.google.com/specimen/DM+Sans). The application bundles local font files through Fontsource so they remain available offline. The installed packages include their font licence files; carry the relevant notices with redistributed font assets.

### Current type scale

| Element | Desktop size | Notes |
| --- | --- | --- |
| Login hero | 57px | Manrope; 48px/41px at narrower desktop/tablet breakpoints |
| Page heading | 31px | Manrope; 1.25 line-height; typically 25–26px on smaller screens |
| Login form heading | 25px | Manrope; 1.4 line-height |
| Dialog heading | 20px | 19px on small phones |
| General section heading | 18px | Panel titles use 16px |
| Main metric value | 34px | Typically 29–30px in narrower layouts |
| Base body | 14px | DM Sans |
| Buttons and form inputs | 12px | Existing compact application controls |
| Patient names / procedure text | 12px | Clinical labels stay visible on phones |
| Status / priority badge | 11px | Priority badge 10px on phones; target suffix 10px/9px |

The CSS also requests intermediate weights such as 650 and 750, while only the four static font weights above are bundled. Use the available 400/600/800 weights in new design files for predictable matching. A future font pass may standardise those CSS requests.

**Guidance for new material:** use sentence case, short headings and generous line spacing. Reserve uppercase and wide tracking for brief labels or the wordmark descriptor. Use 16px body copy for new public-facing web material and a comfortable reading size for print. Existing 8–11px helper text is a compact prototype detail, not the target for new patient-critical information or external documents.

## Logo, wordmark and icons

![Current SurgiLog supplied logo](<public/SurgiLog Clinical Register Logo.png>)

On 19 October 2026 Dylan supplied the new SurgiLog artwork and requested the complete image replace both the old theatre-team symbol and the live-text wordmark. It combines a navy S, a turquoise check/list symbol, navy/turquoise SurgiLog lettering and the tagline **The trusted clinical register**. The artwork determines the logo colours and lettering; the surrounding interface now trials the navy/turquoise palette above. Dylan explicitly chose to retain the original app fonts on 20 October: Manrope (600/800) for headings and prominent numbers, and DM Sans (400/600) for tables, forms and body text. The brief Exo 2 change is superseded. The exact font embedded in the supplied image remains unidentified; do not change the app typography to match it without a new request.

| Asset | Location | Use |
| --- | --- | --- |
| Supplied master/runtime PNG | [SurgiLog Clinical Register Logo.png](<public/SurgiLog Clinical Register Logo.png>) | Original 1677×938 image, preserved unchanged; full logo/name/tagline |
| Install icon, 192px | [public/surgilog-icon-192.png](public/surgilog-icon-192.png) | New S/check symbol; favicon, Apple touch icon and smaller install icon |
| Install icon, 512px | [public/surgilog-icon-512.png](public/surgilog-icon-512.png) | New S/check symbol; larger install icon |
| Logo component | `Brand()` in [apps/web/ui.tsx](apps/web/ui.tsx) | Shared accessible image on sign-in and navigation |
| Historical artwork | `docs/brand/`, `public/logo-lockup.png`, `public/icon-192.png`, `public/icon-512.png` | Earlier Theatre Tracker/theatre-team assets, retained as history |
| Colour swatches | [docs/brand-palette.svg](docs/brand-palette.svg) | Published palette reference, with sampled brand colours and darker action teal |

The shared SVG displays the supplied PNG through viewBox `200 255 1280 425`, removing its outer whitespace at render time without editing the source. The entire symbol, name and tagline remain visible, with the original proportions. Navigation fills the available sidebar width. Sign-in scales from 320–620px with a 34vw preferred width; phones use up to 340px, always constrained by their container. The image aligns with the sign-in content. Multiply compositing blends the source's light background into the pale login surface. Accessible text is “SurgiLog — The trusted clinical register”; there is no duplicate live wordmark.

The square icons are direct browser-rendered crops of the supplied symbol on white, without the name/tagline. Export source window: x=180, y=190, width=height=560. Clip polygon `(190,220) (725,220) (725,330) (690,330) (690,720) (190,720)` isolates the complete S/check from the adjacent lettering; render proportionally at 192/512px. The source is opaque, not a transparent or vector master. Do not claim a vector, monochrome or transparent variant exists. Preserve previous masters and obtain a new approved export before redesigning the artwork.

**Reuse guidance:** use the complete supplied lockup for presentations and other brand placements, and the symbol-only icons for square placements. Preserve proportions, lettering, tagline and colours; do not add a separate SurgiLog wordmark beside the full logo. Keep clear space around the artwork and check the embedded tagline's legibility at the final size. Use white or a light surface.

UI icons come from **Lucide**, using simple outline strokes. Common sizes are 14–20px in controls and 20–24px for stronger emphasis. Pair unfamiliar icons with labels and give icon-only controls accessible names. Continue this outline style in supporting illustrations and presentation diagrams.

## Layout and component styling

The interface uses white cards on a cool pale canvas, thin dividers, modest rounding and very light shadows. Organise information around hospital/department context, a clear page title, the main action, and the relevant records or metrics.

### Current geometry

| Element | Current styling |
| --- | --- |
| Main sidebar | 239px; 208px at widths ≤1150px |
| Main content | Maximum 1650px; typical padding 31px vertically / 35px horizontally |
| Large desktop, ≥1500px | Content padding 40px / 48px |
| Phone content, ≤600px | 22px / 16px |
| Top bar | 70px; 60px at widths ≤850px |
| Panels / metric cards | 11px radius; 1px silver border; `0 3px 4px #344E6D02` shadow |
| Panel padding | 23px desktop; 27px large desktop; 19px phone |
| Buttons | 8px radius; primary blue with white text; 41px minimum height for the standard variant |
| Inputs | 8px radius; 1px `#DBE4EB` border; 42px minimum height; 10px / 12px padding |
| Icon buttons | At least 36px square after the final CSS override |
| Badges | 5px radius; 4px / 7px padding; text plus target/status |
| Dialogs | 15px radius; 470px standard / 710px wide, constrained to the viewport; maximum 90dvh |
| Dialog backdrop | `#112D4366` with 3px blur |
| Dialog shadow | `0 25px 100px #15334B30` |

The prototype uses optical spacing such as 17px, 21px and 23px; it does not yet implement a strict spacing-token scale. For new layouts, start with a **4px rhythm**: 4, 8, 12, 16, 24, 32 and 48px. Preserve the current values when reproducing an existing screen exactly.

### Responsive behaviour — current

The fixed navigation scrolls vertically on short screens and phone landscape so every section and Log out remain reachable.

| Viewport | Behaviour |
| --- | --- |
| ≥1500px | More generous padding and taller chart panels |
| ≤1150px | Narrower sidebar, smaller metric cards, some compact-table columns adapted |
| ≤850px | Sidebar becomes a menu drawer; main content uses the full width |
| ≤600px | Two-column metric grid; other dashboard grids and forms become single-column; login stacks vertically |

In new phone designs, prioritise the patient, procedure, priority target and next action. Keep the active hospital and department easy to identify. The app’s final CSS overrides restore both P1 target suffixes on phones; earlier rules that hide them are superseded.

### Component guidance

- **Actions:** one clear primary action per section. Use an outlined or text action for secondary work. Describe the action with a verb, such as “Add surgical case”.
- **Forms:** visible labels above fields, help below, errors next to the relevant work. Keep required clinical context explicit. Use the same field order across phone and desktop.
- **Tables:** quiet headers, subtle row separators and consistent alignment. Keep key clinical labels readable when the layout contracts.
- **Charts:** flat fills, light gridlines, labelled units and time periods. Distinguish unavailable measurements from zero. Keep a stable colour mapping across reports.
- **Empty states:** explain what is empty and the next useful action. “No pending entries” refers to the current workspace.
- **Saving and sync:** say “Saved on this device” until the server acknowledges the entry. Show actual offline or conflict states. There are no separate device-passphrase prompts, pre-release migration banners or old-workspace recovery screens.
- **Motion:** current button transitions are 160ms, drawer movement 200ms, and the sync spinner 1.3s per revolution. Reduced-motion preferences disable animations/transitions. Keep motion functional and restrained.

## Readability and accessibility

Use at least 4.5:1 contrast for normal text and 3:1 for qualifying large text. These are design targets, not a claim that the whole prototype passes an accessibility audit. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

The following ratios were calculated from the exact opaque sRGB values above against white:

| Pair | Approximate contrast | Reuse decision |
| --- | --- | --- |
| Action teal `#00788A` / white | 5.18:1 | Buttons and links |
| Action teal / selected aqua | 4.57:1 | Selected navigation labels |
| Navy `#08203C` / white | 16.38:1 | Headings and strong numbers |
| Secondary `#405E6D` / white | 6.91:1 | Supporting copy |
| Slate `#5B7380` / pale aqua | 4.62:1 | Muted copy on light surfaces |
| Accent `#00899D` / pale aqua | 3.84:1 | Large hero text; not small text |
| Logo turquoise / white | 2.61:1 | Decoration only |
| Gold `#B69048` / white | 2.97:1 | Existing semantic accent; not normal text target |

Some current small labels and pastel status badges need a contrast/readability pass. Keep their semantic hues, but use a darker text treatment in new designs and check the actual text/background pair. The app has a 3px action-teal focus outline; test its visibility on the final surface. Aim for at least 44px touch areas in new phone controls; the current compact controls are not all that large.

Always combine colour with words, icons or another distinguishable cue. This is especially important for urgency, errors and sync state. [W3C colour guidance](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

## Brand voice, imagery and external materials

Use a visible **Log out** label and logout icon in the account area, rather than an unexplained padlock. Saved activity explains that logout deletes unsynced device entries.

Write in clear South African English: **theatre**, **prioritise**, **organisation** and **colour**. Use “patient”, “case”, “session” and “booking” precisely. State what happened and what the user can do next. Use calm, respectful language rather than alarmist or promotional claims.

| Context | Example |
| --- | --- |
| Product introduction | “A shared view of your surgical backlog, so your team can turn waiting into care.” |
| Navigation | “Surgical backlog”, “Theatre planning”, “Saved activity” |
| Action | “Add surgical case”, “View current case”, “Sync now” |
| Local save | “Saved on this device. Waiting for server acknowledgement.” |
| Empty state | “No pending entries” |

Show South African dates and operating times consistently, such as `04 Oct 2026` and `14:30`; use Africa/Johannesburg for the app. Keep the confirmed P1 ≤30 days, P2 31–90 days and P3 91–365 days ranges intact in diagrams and presentations.

The current app relies on typography, outline icons and data rather than photography. For future photography, favour natural light, hospital teamwork and respectful context. Use authorised imagery and synthetic patient records in mockups. Avoid graphic surgical imagery and decorative photos that compete with operational information.

**Suggested starting layouts for reuse:**

- **Presentation:** white background, navy title, ink body text, a narrow teal rule and the symbol in one consistent corner. Charts use the app’s semantic mappings.
- **Document/report:** a small wordmark, document title, hospital/department and reporting period. Use quiet borders and labelled tables; retain readable contrast in greyscale.
- **Website or announcement:** pale-aqua field, navy Manrope headline, DM Sans body and a single teal primary action.
- **Print:** provide the vector asset and sRGB palette to the designer/printer for conversion with the actual print profile and a proof. No Pantone or CMYK brand standard has been defined.

## Copyable starting tokens

These portable names are aliases for the current core values, suitable for a new project or design-tool variables. They do not rename the application’s existing CSS variables.

```css
:root {
  --tt-blue: #00788a;
  --tt-white: #ffffff;
  --tt-background: #f4f8f9;
  --tt-pale-blue: #eef8fa;
  --tt-selected: #e2f4f7;
  --tt-border: #dbe8ec;
  --tt-ink: #08203c;
  --tt-body: #263e50;
  --tt-secondary-text: #405e6d;
  --tt-muted: #5b7380;
  --tt-gold: #b69048;
  --tt-focus: #00788a;
  --tt-font-body: 'DM Sans', system-ui, sans-serif;
  --tt-font-heading: 'Manrope', system-ui, sans-serif;
  --tt-radius-control: 8px;
  --tt-radius-card: 11px;
  --tt-radius-dialog: 15px;
}
```

## Maintaining consistency

The local Theatre register and Performance extension uses the same white panels, mist background, Ink headings and standard inputs/buttons. Register rows expose Draft/Verified as text; status is never conveyed by colour alone. Dates/times identify SAST and reporting scope. Charts use action teal `#00788a` for counts, green `#50927d` for utilisation, restrained gold `#b69048` for turnaround and navy `#08203c` for first entry. Unknown/future observations stay blank. Tables wrap headings and names; report columns fit their panels instead of inheriting the wide patient-table layout. On phones, charts/breakdowns stack in one column and KPI cards use two columns. The executive print view omits navigation/controls, keeps hospital/department/period/generated time and metric definitions, and contains aggregates only. These patterns add no new brand identity.

Keep this file, the palette SVG and the app styles aligned when a design decision changes. Update current values explicitly; label new proposals until implemented. Link approved new logo variants here when created. Dark mode, vector/monochrome/reversed logo exports, print specifications and a full accessibility pass remain future design work.

Implementation references: [styles](apps/web/styles.css), [shared UI and wordmark](apps/web/ui.tsx), [login copy](apps/web/Login.tsx), [fonts and chart colours](apps/web/main.tsx), [install manifest configuration](vite.config.ts). The original Claude artifact remains a product reference; this guide describes the current application’s visual identity.
