// Ways to find a protein among millions: collections built from live UniProt queries, creatures, and Surprise me.
import { UNIPROT } from './data.js';
import { FEATURED } from './proteins.js';

const LIST_FIELDS = 'accession,protein_name,organism_name,length';
const SIZE_OK = 'length:[40 TO 1600]';

export const CREATURES = [
  { name: 'Dog', sci: 'Canis lupus familiaris' },
  { name: 'Cat', sci: 'Felis catus' },
  { name: 'Octopus', sci: 'Octopus bimaculoides' },
  { name: 'Honeybee', sci: 'Apis mellifera' },
  { name: 'Axolotl', sci: 'Ambystoma mexicanum' },
  { name: 'Naked mole-rat', sci: 'Heterocephalus glaber' },
  { name: 'Platypus', sci: 'Ornithorhynchus anatinus' },
  { name: 'Tardigrade', sci: 'Ramazzottius varieornatus' },
  { name: 'Giant panda', sci: 'Ailuropoda melanoleuca' },
  { name: 'Chicken', sci: 'Gallus gallus' },
  { name: 'Zebrafish', sci: 'Danio rerio' },
  { name: 'Fruit fly', sci: 'Drosophila melanogaster' },
  { name: 'Tomato', sci: 'Solanum lycopersicum' },
  { name: 'Coffee', sci: 'Coffea arabica' },
];

export const COLLECTIONS = [
  { id: 'famous', title: 'Famous proteins', blurb: 'The ones with stories: Nobel Prizes, medicines, glowing jellyfish.', famous: true },
  { id: 'body', title: 'Inside your body', blurb: 'Human proteins that carry oxygen, send signals and fight germs.', query: 'organism_id:9606 AND (keyword:KW-0561 OR keyword:KW-0372 OR keyword:KW-0391 OR keyword:KW-0514 OR keyword:KW-0202)' },
  { id: 'senses', title: 'Your senses', blurb: 'How you see, smell, taste and hear.', query: 'organism_id:9606 AND (keyword:KW-0844 OR keyword:KW-0552 OR keyword:KW-0919 OR keyword:KW-1009)' },
  { id: 'venom', title: 'Venoms and toxins', blurb: 'From snakes, spiders, scorpions and cone snails.', query: 'keyword:KW-0800' },
  { id: 'glow', title: 'Glow in the dark', blurb: 'Proteins that make light, from fireflies to deep-sea creatures.', query: 'keyword:KW-0455' },
  { id: 'cold', title: 'Antifreeze', blurb: 'How some fish, insects and plants survive being frozen.', query: 'keyword:KW-0047' },
  { id: 'sun', title: 'Powered by sunlight', blurb: 'Photosynthesis, the proteins that feed almost all life.', query: 'keyword:KW-0602' },
  { id: 'germs', title: 'Germ fighters', blurb: 'Natural antibiotics made by animals, plants and microbes.', query: 'keyword:KW-0929' },
  { id: 'allergy', title: 'Allergens', blurb: 'Behind peanut, pollen, dust and cat allergies.', query: 'keyword:KW-0020' },
  { id: 'clock', title: 'Body clocks', blurb: 'Proteins that keep time and tell you when to sleep.', query: 'keyword:KW-0090' },
  { id: 'creatures', title: 'Pick a creature', blurb: 'Choose an animal or plant and hold one of its proteins.', creatures: true },
  { id: 'unknown', title: 'Never studied', blurb: 'Proteins no one has looked at yet. AlphaFold is the first to show their shape.', unknown: true },
];

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function toItem(r) {
  const pd = r.proteinDescription || {};
  const name = pd.recommendedName?.fullName?.value || pd.submissionNames?.[0]?.fullName?.value || r.primaryAccession;
  const org = r.organism?.commonName || r.organism?.scientificName || '';
  return { acc: r.primaryAccession, name, organism: org, length: r.sequence?.length || 0 };
}

async function search(query, size = 80) {
  const url = `${UNIPROT}/search?query=${encodeURIComponent(query)}&fields=${LIST_FIELDS}&format=json&size=${size}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`uniprot ${res.status}`);
  const j = await res.json();
  return (j.results || []).map(toItem);
}

// A random length window gives a different slice of a big collection every time.
function windowed(base) {
  const a = 40 + Math.floor(Math.random() * 700);
  return `(${base}) AND length:[${a} TO ${a + 160}]`;
}

async function searchVaried(base, size) {
  let items = [];
  try { items = await search(windowed(base), size); } catch { items = []; }
  if (items.length < 6) items = await search(`(${base}) AND ${SIZE_OK}`, size);
  return items;
}

export async function collectionItems(col, { creature } = {}) {
  if (col.famous) {
    return FEATURED.map((f) => ({ acc: f.id, name: f.title, organism: f.organism.replace(/\s*\(.*\)/, '') }));
  }
  if (col.creatures) {
    const c = creature || CREATURES[0];
    let items = await searchVaried(`organism_name:"${c.sci}" AND reviewed:true`, 60);
    if (items.length < 4) items = await searchVaried(`organism_name:"${c.sci}"`, 60);
    return shuffle(items).slice(0, 10).map((i) => ({ ...i, organism: c.name }));
  }
  if (col.unknown) {
    const c = pick(CREATURES);
    let items = await searchVaried(`organism_name:"${c.sci}" AND protein_name:"uncharacterized protein" AND reviewed:false`, 60);
    if (!items.length) items = await searchVaried('protein_name:"uncharacterized protein" AND reviewed:false', 60);
    return shuffle(items).slice(0, 10);
  }
  const items = await searchVaried(`${col.query} AND reviewed:true`, 80);
  return shuffle(items).slice(0, 10);
}

// Surprise me: candidates from a random collection or creature. The caller tries them in turn,
// because a few UniProt entries have no AlphaFold model.
export async function surpriseCandidates() {
  const roll = Math.random();
  try {
    if (roll < 0.22) {
      return { label: 'a famous protein', items: shuffle(await collectionItems(COLLECTIONS[0])).slice(0, 3) };
    }
    if (roll < 0.72) {
      const col = pick(COLLECTIONS.filter((c) => c.query));
      return { label: col.title.toLowerCase(), items: (await collectionItems(col)).slice(0, 4) };
    }
    if (roll < 0.92) {
      const c = pick(CREATURES);
      return { label: c.name.toLowerCase(), items: (await collectionItems(COLLECTIONS.find((x) => x.creatures), { creature: c })).slice(0, 4) };
    }
    return { label: 'a protein no one has studied', items: (await collectionItems(COLLECTIONS.find((x) => x.unknown))).slice(0, 4) };
  } catch {
    // UniProt is unreachable: fall back to the famous list, which needs only AlphaFold.
    return { label: 'a famous protein', items: shuffle(await collectionItems(COLLECTIONS[0])).slice(0, 3) };
  }
}

/* ------------------------------------------------------------------ */
/* Proteins you've held (this browser only)                            */
/* ------------------------------------------------------------------ */

const KEY = 'native-state.held';

export function heldList() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function recordHeld(item) {
  try {
    const list = heldList().filter((h) => h.acc !== item.acc);
    list.unshift({ ...item, t: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
    return list.length;
  } catch {
    return 0;
  }
}
