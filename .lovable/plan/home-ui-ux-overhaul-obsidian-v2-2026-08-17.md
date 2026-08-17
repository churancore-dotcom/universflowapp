# Home UI/UX Overhaul: "Obsidian V2"

The user finds the current Home UI "ugly." We will pivot to a more refined, minimalist "Obsidian" aesthetic that emphasizes content over aggressive geometry.

## Visual Changes

- **Geometry**: Reduce aggressive rounding. Change 40px/32px corners to a more standard 16px/24px range for a "premium" feel.
- **Typography**: Refine section headers. Move away from heavy all-caps for everything; use title case for shelves to reduce visual noise.
- **Color**: Use the primary Rose color (#FF2D55) as a surgical accent (play buttons, active indicators) rather than a global branding brush.
- **Hero**: Reduce hero height from 52vh to ~40vh for better content density. Switch from a full-bleed rounded-bottom to a contained, elegant card.
- **Rails**: Standardize shelf layouts. Remove the background containers/auras around every shelf to let the background breathe.

## Technical Details

- Update `src/styles.css` theme tokens for radii.
- Modify `src/pages/Home.tsx` layout structure.
- Adjust `RailHeader` and component styles for consistency.
