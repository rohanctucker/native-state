# Native State

Hold real AlphaFold protein structures in your hands. Pick one up with a pinch on camera, or drag it with your finger, and every time you grab it a new fact pops up. Pull it apart to see it lay out as its own sequence of letters, and let go to watch it fold back.

**Live site:** https://rohanctucker.github.io/native-state/

## What's in it

- **Three looks.** *Ribbon* is how scientists draw proteins (spirals are helices, arrows are strands). *Atoms* shows every atom at its real size with studio lighting. *Glow* traces the backbone as a line of light.
- **Color is AlphaFold's confidence.** Blue parts are probably right. Yellow and orange parts are guesses, so they look hazy and drift.
- **A fact every time you grab it.** What it does, where it works in the body, diseases it's linked to, medicines that act on it, how many times scientists have measured it, how big it is, and who makes it. Every fact names its source.
- **Labels on the model** for the parts that matter: active sites, metal and heme binding spots, membrane crossings, address tags, plus hand-written labels for the featured proteins.
- **Finding proteins among 200 million:** *Surprise me*, *Explore* (Inside your body, Your senses, Venoms and toxins, Glow in the dark, Antifreeze, Powered by sunlight, Germ fighters, Allergens, Body clocks, Pick a creature, Never studied), search by name or gene, and a list of every protein you've held.
- **Camera:** off, front (mirrored, like a selfie) or back (your room behind it). Hand tracking works with either.
- **See it in your room** on phones: opens AR Quick Look on iPhone or WebXR on Android, about 30 cm across.
- **Share links** to any protein, like `#P42212`.

No build step and no API keys. It's plain HTML, CSS and JavaScript modules, so GitHub Pages serves it as is.

## Where the facts come from

| What | Source |
| --- | --- |
| 3D structures and confidence | [AlphaFold DB API](https://alphafold.ebi.ac.uk/api-docs) |
| Function, location, diseases, binding sites, lab structures | [UniProt REST API](https://rest.uniprot.org) (expert-curated for reviewed entries) |
| Medicines and compounds | DrugBank cross-references inside UniProt |
| Plain-English summaries | Wikipedia, found through Wikidata's UniProt links |
| Size, amino acid counts | Measured from the structure in the browser |

All of these are free, need no keys and allow requests straight from the browser. The short stories for the 11 featured proteins in `js/proteins.js` were written for the site.

### Why there's no Gemini or Claude key

A key in a GitHub Pages site is public: anyone can open the page source, copy it and run up your bill. And a language model can invent facts about obscure proteins, while UniProt is curated by scientists. If you later want an "explain it simply" button, put the key in a small serverless function (for example a Cloudflare Worker) and have the model only rewrite the UniProt and Wikipedia text it's given.

## Run it on your computer

ES modules need a local server (opening `index.html` straight from the folder won't work):

```bash
cd native-state
python3 -m http.server 8000
```

Then open http://localhost:8000. The camera works on `localhost` and on the `https://` GitHub Pages site.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page structure, drawers and dialogs |
| `styles.css` | Layout and type; design tokens at the top |
| `js/main.js` | Rendering loop, the three looks, gestures, labels, facts, explore, search, camera, AR |
| `js/data.js` | AlphaFold, UniProt and Wikipedia fetching; turns annotations into plain-language facts and labels |
| `js/geometry.js` | Secondary structure from the backbone, cartoon ribbons, space-filling atoms, baked ambient occlusion |
| `js/explore.js` | Collections built from live UniProt queries, Surprise me, the held list |
| `js/hands.js` | Front/back camera and MediaPipe hand tracking |
| `js/ar.js` | Exports the ribbon as a GLB for `<model-viewer>` AR |
| `js/proteins.js` | The featured proteins. Add your own here |
| `design/DESIGN.md` | Palette, type, layout and principles |

## Adding a featured protein

```js
{
  id: 'P69905',                 // UniProt accession
  short: 'Hemoglobin α',        // short name for status messages
  title: 'Hemoglobin, alpha chain',
  organism: 'Human',
  fact: 'One or two sentences in plain language.',
  marks: [{ from: 88, to: 88, text: 'What this residue does' }],  // UniProt numbering
}
```

## Credits

Structures from [AlphaFold DB](https://alphafold.ebi.ac.uk/) (EMBL-EBI and Google DeepMind), CC BY 4.0: Jumper et al., *Nature* 2021; Varadi et al., *Nucleic Acids Research* 2024. Annotations from UniProt (CC BY 4.0). Summaries from Wikipedia (CC BY-SA 4.0). Hand tracking by Google MediaPipe. 3D by three.js; AR by Google model-viewer. Fonts: Sofia Sans and Atkinson Hyperlegible (SIL Open Font License).

The unfold animation blends between the predicted shape and a straight chain. It is not a folding simulation. Secondary structure in the Ribbon look is estimated from the backbone geometry.
