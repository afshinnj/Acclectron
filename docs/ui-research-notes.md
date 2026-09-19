# UI research notes

## Sources
- Fluent 2 principles: https://fluent2.microsoft.design/design-principles
- Windows design overview: https://learn.microsoft.com/en-us/windows/apps/design/
- Fluent layout: https://fluent2.microsoft.design/layout
- Windows navigation: https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics
- Windows color: https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/color
- Windows geometry: https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry
- Windows typography: https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography
- Accessible text: https://learn.microsoft.com/en-us/windows/apps/design/accessibility/accessible-text-requirements

## Project audit
- renderer.js: 3768 lines
- styles.css: 1023 lines
- main.js: 576 lines
- preload.js: 159 lines
- index.html: 7 lines; large runtime markup is generated in renderer.js
- UI counts: 207 button tags/references, 169 input tags/references, 22 forms, 10 aria-labels, 13 title attributes
- CSS contains many direct hex colors and multiple radii; dominant radii include 4, 5, 6, 7, 8, 9, 10, 11, 12, and 18px.
- Existing UI has activity bar + sidebar + RTL content, dark/light theme variables, dashboard cards, tables, forms, modal overlays, and custom responsive rules.
- Existing UI uses Segoe/Tahoma fallback and many text sizes at 9-12px.

## Key findings
1. Windows 11 resemblance is feasible without rewriting Electron or the data layer.
2. The existing navigation model is compatible with Windows left navigation, but it should be simplified and grouped.
3. A Fluent-like token layer is needed before component restyling; direct colors and component-specific values currently make consistency difficult.
4. Typography and RTL font fallback need explicit treatment; default body text should be around 14px, captions 12px, titles 20-28px, with 4.5:1 contrast as baseline.
5. The current app can adopt 4px control radii and 8px overlay/container radii, rather than using many unrelated radii.
6. Accessibility needs a dedicated pass: labels/roles, visible focus, keyboard order, minimum hit areas, scalable text, and non-color-only status indicators.
7. The implementation should be phased: tokens and shell, navigation and page headings, controls/tables/modals, accessibility, then visual verification at light/dark and common Windows scaling factors.
