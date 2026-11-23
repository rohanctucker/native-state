# Native State: design notes

## Brief
Real AlphaFold protein structures you can hold, on a phone or laptop. You grab one with your hands on the webcam (or your fingers), feel which parts AlphaFold is sure about, and pull it apart into its sequence.

- Audience: curious people with no biology background. Friends, and portfolio viewers.
- Primary job: hold a real predicted protein and come away knowing what AlphaFold's colors mean, without reading an explainer.

## Tokens

| Name | Hex | Use |
| --- | --- | --- |
| Cyanotype ink | `#0A1F3A` | The field everything floats in |
| Deep ink | `#04101F` | Video shadows, bottom scrim |
| Film | `#E6EDF3` | Text, callout lines, hand skeleton |
| Film dim | `#A9BCD0` | Secondary text |
| AlphaFold very high | `#0053D6` | Confidence 90+ (glows as `#4A8DFF`) |
| AlphaFold confident | `#65CBF3` | Confidence 70–90 |
| AlphaFold low | `#FFDB13` | Confidence 50–70 |
| AlphaFold very low | `#FF7D45` | Confidence under 50 |

The four AlphaFold colors are the official pLDDT palette. They are data and never decoration. In the Ribbon look the very-high blue is lifted to `#2463DB` so it reads under studio lighting.

Atoms use element colors instead, because that is what people recognize as a molecule: carbon `#939CA7`, nitrogen `#4A69E2`, oxygen `#DC4B3B`, sulfur `#EBBE3F`. Confidence still shows as motion: unsure parts wobble.

### Type
- **Sofia Sans Extra Condensed** 600/700: protein names and the wordmark. Protein names are long ("Cellular tumor antigen p53"), so a condensed face lets them run big.
- **Sofia Sans Condensed** 500/600: callout labels on the model and the protein shelf, like the labels on an anatomy plate.
- **Atkinson Hyperlegible Next** 400/600: body text and controls. Built for legibility, which matters on a phone over moving video.
- **Atkinson Hyperlegible Mono** 500: only for the amino acid sequence, because sequence viewers line up letters in columns.

### Layout
```
+--------------------------------------------------------------+
| Native State   How it works            [ Search proteins   ] |
|                                                              |
|      label ------.         glowing chain        .---- label  |
|                   `---.                     .--'             |
|                                                              |
| Green fluorescent protein               How sure AlphaFold is |
| Crystal jelly, 238 amino acids          [=========|==|=]      |
| A jellyfish protein that glows...       swatches + percents  |
| (Use camera)  Unfold ----o---------     GFP  Hemoglobin  ... |
+--------------------------------------------------------------+
```
Left-aligned text. The 3D view is centered in the space between the header and the dock, not the whole screen. On phones the dock stacks and the shelf scrolls sideways.

## Looks
- **Ribbon** (default): cartoon with helices and arrows, studio lighting (room environment map, key and rim lights riding with the camera), baked ambient occlusion from how buried each residue is, depth fog.
- **Atoms**: every heavy atom as an instanced sphere at its van der Waals radius, same lighting, per-atom baked occlusion.
- **Glow**: the X-ray look. Backbone line and soft points with bloom, additive over the ink field or the camera.

With the camera on, Ribbon and Atoms composite over natural video so the protein sits in your room; Glow keeps the dim cyanotype duotone.

## Components
- **Fact card**: pops up next to the protein each time you grab it, cycles through a deck of sourced facts, names its source. Tap it for the next one.
- **Explore drawer**: collections as plain rows (title and one line), expanding to text lists. No thumbnails.
- **About it drawer**: every sourced section, with sources under each.
- **View sheet** on phones: the desktop side panel becomes a bottom sheet.

## Principles
1. The protein is the only light on screen. Everything else is quiet.
2. Color always means confidence.
3. Uncertainty is felt, not read: low-confidence parts are hazy and drift.
4. Unfolding turns the shape into text: the chain lays out as lines of its own sequence.
5. Every hand gesture has a touch and mouse equivalent.
6. Every fact names where it came from.

## Revisions against the generic default
- First instinct was near-black with neon cyan, the stock sci-fi look. Changed to a cyanotype-blue field (X-ray film, blueprints) with AlphaFold's own palette.
- First instinct for featured proteins was a row of thumbnail cards. Changed to a plain text shelf.
- First instinct for on-model labels was small monospace data tags. Changed to condensed callouts with leader lines, like the anatomy labels in the X-ray mirror reel that inspired this.
