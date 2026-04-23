---
name: Modern Terminal System
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#b9ccb2'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#84967e'
  outline-variant: '#3b4b37'
  surface-tint: '#00e639'
  primary: '#ebffe2'
  on-primary: '#003907'
  primary-container: '#00ff41'
  on-primary-container: '#007117'
  inverse-primary: '#006e16'
  secondary: '#dcfdff'
  on-secondary: '#00373a'
  secondary-container: '#00f1fd'
  on-secondary-container: '#006a6f'
  tertiary: '#fff8f6'
  on-tertiary: '#611200'
  tertiary-container: '#ffd3c8'
  on-tertiary-container: '#b82a00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#72ff70'
  primary-fixed-dim: '#00e639'
  on-primary-fixed: '#002203'
  on-primary-fixed-variant: '#00530e'
  secondary-fixed: '#6ff6ff'
  secondary-fixed-dim: '#00dce6'
  on-secondary-fixed: '#002022'
  on-secondary-fixed-variant: '#004f53'
  tertiary-fixed: '#ffdad2'
  tertiary-fixed-dim: '#ffb4a2'
  on-tertiary-fixed: '#3c0700'
  on-tertiary-fixed-variant: '#891d00'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0.01em
  body-md:
    fontFamily: Space Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0.01em
  label-mono:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
spacing:
  unit: 4px
  gutter: 16px
  margin: 24px
  container-max: 100%
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style

This design system is built for technical power users, engineers, and data architects who require a high-density, low-latency visual environment. The brand personality is rooted in **precision, transparency, and raw computational power.** It avoids the softness of consumer-grade interfaces in favor of a "Cyber-Minimalist" aesthetic that emphasizes logic over decoration.

The style draws heavily from **High-Contrast Bold** and **Brutalism**, utilizing a "black-box" philosophy. By stripping away organic shapes and decorative shadows, the UI creates an expansive digital workspace where information density is a feature, not a flaw. The emotional response is one of total control and professional competence.

## Colors

The palette is strictly functional, utilizing a high-contrast dark theme to reduce eye strain during extended technical sessions. 

- **Primary (Matrix Green):** Used for primary actions, success states, and active command lines.
- **Secondary (Cyber Cyan):** Used for info-density, data visualization, and secondary navigation elements.
- **Tertiary (Alert Orange):** Reserved strictly for warnings, errors, and critical system interrupts.
- **Surface Palette:** The background is a true pitch black (#000000) to maximize the "glow" effect of the neon accents, while UI containers use a tiered dark grey scale to establish hierarchy without losing the terminal feel.

## Typography

This design system utilizes **Space Grotesk** for all UI elements. While not a true monospace, its geometric construction and technical glyphs provide the necessary "engineered" feel while maintaining superior legibility over standard mono fonts at smaller scales.

To achieve the authentic command-line feel, all labels should be set in uppercase with increased letter-spacing. For actual code blocks or data tables where character alignment is mission-critical, the system should fall back to the user's local system monospace font (e.g., SF Mono, Cascadia Code). Typography should always be rendered with high contrast against the dark background to ensure maximum scannability.

## Layout & Spacing

The layout philosophy is built on an **Expansive Fluid Grid**. Unlike consumer sites that center content in a narrow column, this system utilizes the full width of the viewport to accommodate multi-panel workflows and complex data sets.

A strict 4px baseline grid ensures mathematical precision in element placement. Use 16px gutters for standard component spacing. The layout should feel modular—similar to a tiling window manager—where containers snap to the edges of the screen and each other. Padding within components should be generous enough to prevent visual clutter but tight enough to maintain the high-density information environment.

## Elevation & Depth

In a terminal-inspired environment, shadows are non-existent. Hierarchy is conveyed through **Tonal Layers** and **Bold Borders** rather than Z-axis depth.

- **Level 0 (Base):** Pitch black (#000000). The foundation of the terminal.
- **Level 1 (Surface):** Deep grey (#121212). Used for primary panels and sidebars.
- **Level 2 (Active):** Mid grey (#1E1E1E). Used for cards, modals, and hovered states.
- **Borders:** Instead of shadows, use 1px solid strokes in the Primary or Secondary accent colors to denote focus or selection. A thin, low-opacity grey border (20% white) should be used to separate inactive panels.

## Shapes

The shape language is defined by **Absolute Rectilinearity.** 

All interactive elements, containers, and indicators use a 0px border radius. Sharp corners reinforce the technical, precise nature of the system and mimic the behavior of physical terminal screens and early computing interfaces. This "hard-edge" approach ensures that every pixel is utilized and that the UI feels integrated into the hardware of the screen.

## Components

### Buttons
Buttons are strictly rectangular. The "Primary" button is a solid block of Neon Green with Black text. "Secondary" buttons use a 1px Cyan stroke with Cyan text. The "Ghost" state is text-only with a leading `>` character.

### Input Fields
Inputs should mimic a command-line prompt. Use a solid 1px bottom border rather than a full box. The active state features a "blinking" cursor effect (a vertical bar in Primary Green). Placeholder text should be low-contrast grey and preceded by a `$` or `>` symbol.

### Chips & Tags
Chips are small, outlined rectangles. They should look like metadata tags in a code editor. Use Secondary Cyan for status tags and Tertiary Orange for system alerts.

### Lists & Data Tables
Tables are the heart of this system. Use no vertical borders; only horizontal 1px dividers. Rows should have a subtle green tint on hover. Column headers must be uppercase with high letter spacing.

### Status Indicators
Use "Glitch" or "Scanline" subtle animations for loading states. Progress bars are solid blocks of color that fill the container with no rounding, appearing as a segmented "loading" sequence.

### Cards
Cards are simple containers with a 1px border. They do not have shadows. Each card should feature a small "label" in the top-left or top-right corner to identify the data module, separated by a thin horizontal line.