# ManeFlow Premium UI System

Status: Approved customer-facing design direction  
Reference: current Memphis Card Company live-site visual language and the supplied mobile ManeFlow reference screen  
Scope: public ManeFlow web, PWA, mobile app, desktop app, Shopify entry points, and private ManeBrain owner surfaces

## Design objective

ManeFlow must look and feel like a premium, category-defining financial and collecting product—not a developer dashboard, demo, or generic SaaS template.

The supplied reference establishes the correct direction:

- deep midnight/navy foundation;
- premium gold accents;
- restrained electric-blue highlights;
- large confident typography;
- soft glass-and-metal depth;
- prominent upload-first hierarchy;
- polished mobile bottom navigation;
- visual continuity with Memphis Card Company.

The final system should be cleaner, calmer, more precise, and more luxurious than the reference while preserving accessibility and speed.

## Core visual language

### Color tokens

```css
:root {
  --mf-bg-0: #020814;
  --mf-bg-1: #061224;
  --mf-bg-2: #0a1a31;
  --mf-panel: rgba(8, 22, 43, 0.82);
  --mf-panel-strong: rgba(10, 28, 53, 0.96);
  --mf-border: rgba(119, 168, 227, 0.18);
  --mf-border-strong: rgba(137, 187, 244, 0.34);
  --mf-blue: #4fa4ff;
  --mf-blue-soft: #89c8ff;
  --mf-gold: #d7b267;
  --mf-gold-bright: #f2d48d;
  --mf-gold-muted: #94723f;
  --mf-text: #f7fbff;
  --mf-text-soft: #c4d2e5;
  --mf-text-muted: #8193aa;
  --mf-success: #56d39a;
  --mf-warning: #efc66d;
  --mf-danger: #ff7c86;
  --mf-shadow: 0 28px 70px rgba(0, 0, 0, 0.42);
}
```

Gold is reserved for brand, primary actions, confirmed/verified states, and premium highlights. Blue is used for active navigation, processing, evidence, and interactive focus. Red is used only for destructive or critical states.

### Typography

- Display: premium condensed or geometric serif/sans with strong uppercase capability.
- Interface: highly legible modern sans.
- Numeric values: tabular numerals.
- Avoid generic browser-default typography.
- Maintain readable line lengths and hierarchy on mobile.

Recommended pairing:

- Display: `Sora`, `Manrope`, `DM Sans`, or a licensed Memphis Card Company display face.
- Interface: `Manrope` or `DM Sans`.

Do not ship remote font dependencies unless their performance, privacy, and license are approved. Prefer self-hosted or system-fallback stacks.

## Surface system

### Background

Use a layered midnight gradient with subtle radial blue and gold illumination. Avoid noisy textures, excessive glow, and saturated gradients.

```css
background:
  radial-gradient(circle at 85% 0%, rgba(79, 164, 255, .15), transparent 38%),
  radial-gradient(circle at 10% 8%, rgba(215, 178, 103, .08), transparent 32%),
  linear-gradient(180deg, var(--mf-bg-1), var(--mf-bg-0));
```

### Panels

- 18–28px radius depending on hierarchy.
- Semi-transparent midnight surface.
- Thin cool-blue border.
- Soft internal highlight.
- Reserved shadow depth.
- No excessive glass blur on low-power mobile devices.

### Buttons

Primary:

- gold surface;
- black/navy text;
- high contrast;
- subtle pressed state;
- 48–56px mobile height.

Secondary:

- dark glass surface;
- cool-blue border;
- white text.

Danger:

- outlined red by default;
- solid only for final destructive confirmation.

## Information hierarchy

### Mobile home/scan screen

1. Memphis Card Company eyebrow and ManeFlow wordmark.
2. Simple promise: `Upload. Identify. Value. Collect.`
3. Compact collection/value summary cards.
4. Dominant `Upload Cards` surface.
5. Live processing/progress state.
6. Draft results.
7. Automatic-pricing explanation.
8. Persistent bottom navigation.

### Upload surface

The primary control label is exactly:

```text
Upload Cards
```

Supporting copy may say:

```text
Camera, photos, files, or folders
```

Desktop supports folder selection and recursive drag-and-drop. Mobile relies on the operating-system chooser for camera, photos, and files. Advanced permissions and training consent should be visually separated from the main action and written in plain language.

### Progress

Progress must represent durable work units, not cosmetic animation.

Display:

- selected;
- uploaded;
- detected;
- identified;
- valued;
- awaiting review;
- deferred;
- failed.

Do not lead with retry counts. Provider details remain hidden unless the user opens troubleshooting.

### Result cards

Each draft result includes:

- source crop;
- evidence tier;
- identity summary;
- accepted fields;
- unresolved fields;
- valuation or unpriced state;
- `Confirm`, `Correct`, and `Unresolved` actions;
- `Add to Collection` after confirmation.

Do not make users edit every field in a raw form by default. Field editing appears in a focused correction sheet.

### Collection

Use a premium vault presentation:

- card image first;
- identity and value hierarchy;
- compact confidence/evidence status;
- searchable, sortable, and filterable;
- list and gallery modes;
- portfolio summary without overwhelming users.

## Navigation

### Mobile bottom navigation

Public customer tabs:

- Scan
- Collection
- Search or Values
- Account

Use 4 items maximum. The current tab receives blue/gold emphasis. Labels remain visible; icons alone are insufficient.

### Desktop

Use a restrained top navigation or narrow left rail. Avoid exposing merchant, staff, Meta, grading, or analytics modules unless the user is authorized and entitled.

### ManeBrain

ManeBrain uses the same design system with a more operational layout:

- channel-specific familiar interaction patterns;
- owner-only access;
- stronger information density;
- clear draft/approval/delivery boundaries;
- no deceptive imitation of Meta-owned product branding.

## Motion

- 140–220ms interface transitions.
- Use motion for continuity, status, and hierarchy only.
- Respect `prefers-reduced-motion`.
- No looping decorative animations around card processing.
- Progress indicators reflect real state.

## Accessibility

Require:

- WCAG-oriented contrast;
- visible focus rings;
- keyboard navigation;
- 44px minimum touch targets;
- semantic headings and regions;
- labeled form controls;
- screen-reader progress announcements;
- reduced-motion support;
- no color-only status distinctions;
- error recovery in plain language;
- no horizontal overflow at 320px width.

## Performance budget

Visual polish must not create latency.

Targets:

- initial critical CSS under 50KB compressed;
- no blocking third-party font requests unless approved;
- image placeholders and progressive loading;
- avoid backdrop blur on every panel;
- virtualize large card result lists;
- defer charts and advanced analytics;
- preserve responsive interaction during uploads.

## Screen-specific requirements

### Sign-in

- brand-led full-height composition;
- clear privacy and beta language;
- one primary sign-in action;
- no fake metrics or product claims;
- direct route back to the intended scan after authentication.

### Scan

- upload-first;
- no unnecessary manual mode selection;
- no manual pricing inputs;
- no separate camera button;
- no technical AI/provider jargon;
- drag-and-drop feedback on desktop;
- resume/recovery state when processing pauses.

### Pricing

- ManeFlow handles pricing automatically;
- show evidence availability, completed-sale count, date range, liquidity, range, and confidence;
- explain why a card remains unpriced;
- no manual comp textarea in the customer flow.

### Feedback

- compact beta feedback sheet;
- attach the relevant scan/job/result automatically when authorized;
- redact private data;
- avoid a full navigation tab in the mature product.

## Forbidden patterns

Do not ship:

- gray generic admin templates;
- dense tables as the default mobile experience;
- fake card images;
- decorative gradients that reduce readability;
- exaggerated 99% confidence badges;
- exposed provider or retry debug strings;
- every feature in one navigation bar;
- destructive actions without confirmation;
- visual inconsistency between website and app.

## Acceptance criteria

The final customer UI passes when:

- it is visually closer to the supplied premium reference than the legacy interface;
- a new user can start a scan within one obvious action;
- the primary flow is usable with one hand on mobile;
- uncertainty and recovery states are understandable;
- the app remains responsive during large uploads;
- desktop and mobile share a coherent design system;
- public and owner-only experiences are unmistakably separated;
- accessibility, performance, and browser tests pass.
