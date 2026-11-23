// Everything that comes from outside: AlphaFold structures, UniProt annotations, Wikipedia summaries.
// All three are free, need no keys and allow requests straight from the browser.

export const AF_API = 'https://alphafold.ebi.ac.uk/api/prediction/';
export const AF_ENTRY = 'https://alphafold.ebi.ac.uk/entry/';
export const UNIPROT = 'https://rest.uniprot.org/uniprotkb';
export const UNIPROT_ENTRY = 'https://www.uniprot.org/uniprotkb/';
export const ACCESSION = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

export class UserError extends Error {}

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/* AlphaFold structure                                                 */
/* ------------------------------------------------------------------ */

// Parse the first chain of a PDB file: every heavy atom, grouped by residue.
export function parsePDB(text) {
  const residues = [];
  let chain = null;
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('ATOM')) continue;
    const alt = line[16];
    if (alt !== ' ' && alt !== 'A') continue;
    const ch = line[21];
    if (chain === null) chain = ch;
    else if (ch !== chain) break;
    const num = parseInt(line.substring(22, 26), 10);
    const key = `${num}${line[26]}`;
    if (!cur || cur.key !== key) {
      cur = { key, num, res: line.substring(17, 20).trim(), ca: null, b: 0, atoms: [] };
      residues.push(cur);
    }
    const name = line.substring(12, 16).trim();
    const x = parseFloat(line.substring(30, 38));
    const y = parseFloat(line.substring(38, 46));
    const z = parseFloat(line.substring(46, 54));
    let el = line.length >= 78 ? line.substring(76, 78).trim().toUpperCase() : '';
    if (!el) el = name.replace(/[^A-Z]/gi, '').charAt(0).toUpperCase();
    if (el === 'H' || el === 'D') continue;
    cur.atoms.push({ el, x, y, z });
    if (name === 'CA') {
      cur.ca = [x, y, z];
      cur.b = parseFloat(line.substring(60, 66));
    }
  }
  return residues.filter((r) => r.ca);
}

const structureCache = new Map();

export async function fetchStructure(acc) {
  if (structureCache.has(acc)) return structureCache.get(acc);
  let list;
  try {
    list = await getJSON(AF_API + encodeURIComponent(acc));
  } catch (err) {
    if (err.status === 404 || err.status === 400 || err.status === 422) {
      throw new UserError(`AlphaFold DB has no structure for ${acc}. Very long proteins and most viruses aren’t included.`);
    }
    throw err;
  }
  const entry = Array.isArray(list) ? list[0] : list;
  if (!entry || !entry.pdbUrl) throw new UserError(`AlphaFold DB has no structure for ${acc}.`);
  const res = await fetch(entry.pdbUrl);
  if (!res.ok) throw new Error(`pdb ${res.status}`);
  const residues = parsePDB(await res.text());
  if (residues.length < 3) throw new UserError('That structure file had no chain to show.');
  const data = { entry, residues };
  structureCache.set(acc, data);
  return data;
}

/* ------------------------------------------------------------------ */
/* UniProt annotations                                                 */
/* ------------------------------------------------------------------ */

const UP_FIELDS = [
  'accession', 'reviewed', 'protein_name', 'gene_primary', 'organism_name', 'organism_id', 'lineage',
  'length', 'mass', 'cc_function', 'cc_subcellular_location', 'cc_tissue_specificity', 'cc_disease',
  'keyword', 'ft_act_site', 'ft_binding', 'ft_domain', 'ft_signal', 'ft_transmem',
  'xref_drugbank', 'xref_pdb', 'annotation_score',
].join(',');

const uniprotCache = new Map();

export async function fetchUniprot(acc) {
  if (uniprotCache.has(acc)) return uniprotCache.get(acc);
  let raw = null;
  try {
    const url = `${UNIPROT}/search?query=${encodeURIComponent(`accession:${acc}`)}&fields=${UP_FIELDS}&format=json&size=1`;
    const j = await getJSON(url);
    raw = (j.results || []).find((r) => r.primaryAccession === acc) || j.results?.[0] || null;
  } catch {
    raw = null;
  }
  if (!raw) {
    // Fall back to the full entry if the field list was ever rejected.
    try { raw = await getJSON(`${UNIPROT}/${encodeURIComponent(acc)}.json`); } catch { raw = null; }
  }
  const info = raw ? normalizeUniprot(raw) : null;
  uniprotCache.set(acc, info);
  return info;
}

// Strip citations and evidence tags from curated text.
export function cleanText(s) {
  if (!s) return '';
  return s
    .replace(/\s*\((?:PubMed|Ref\.|PMID)[^)]*\)/g, '')
    .replace(/\s*\((?:By similarity|Probable|Potential|Microbial infection)\)/gi, '')
    .replace(/\{ECO:[^}]*\}/g, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const pos = (loc, k) => loc?.[k]?.value ?? null;

function normalizeUniprot(raw) {
  const pd = raw.proteinDescription || {};
  const comments = raw.comments || [];
  const features = raw.features || [];
  const xrefs = raw.uniProtKBCrossReferences || [];
  const texts = (type) => comments.filter((c) => c.commentType === type).flatMap((c) => c.texts || []).map((t) => cleanText(t.value)).filter(Boolean);
  const span = (f) => ({ from: pos(f.location, 'start'), to: pos(f.location, 'end') });
  const entryType = raw.entryType || '';
  return {
    acc: raw.primaryAccession,
    reviewed: /reviewed/i.test(entryType) && !/unreviewed/i.test(entryType),
    name: pd.recommendedName?.fullName?.value || pd.submissionNames?.[0]?.fullName?.value || null,
    gene: raw.genes?.[0]?.geneName?.value || null,
    organism: {
      scientific: raw.organism?.scientificName || null,
      common: raw.organism?.commonName || null,
      taxonId: raw.organism?.taxonId || null,
      lineage: raw.organism?.lineage || [],
    },
    length: raw.sequence?.length || null,
    mass: raw.sequence?.molWeight || null,
    functions: texts('FUNCTION'),
    locations: uniq(comments.filter((c) => c.commentType === 'SUBCELLULAR LOCATION')
      .flatMap((c) => c.subcellularLocations || []).map((s) => s.location?.value)),
    tissue: texts('TISSUE SPECIFICITY')[0] || null,
    diseases: uniq(comments.filter((c) => c.commentType === 'DISEASE' && c.disease).map((c) => c.disease.diseaseId)),
    keywords: (raw.keywords || []).map((k) => k.name),
    active: features.filter((f) => f.type === 'Active site').map((f) => ({ ...span(f), text: f.description || '' })),
    binding: features.filter((f) => f.type === 'Binding site').map((f) => ({ ...span(f), ligand: f.ligand?.name || '' })),
    domains: features.filter((f) => f.type === 'Domain').map((f) => ({ ...span(f), name: f.description || '' })),
    signal: features.filter((f) => f.type === 'Signal').map(span)[0] || null,
    transmem: features.filter((f) => f.type === 'Transmembrane').map(span),
    drugs: uniq(xrefs.filter((x) => x.database === 'DrugBank')
      .map((x) => (x.properties || []).find((p) => p.key === 'GenericName')?.value)),
    pdbCount: xrefs.filter((x) => x.database === 'PDB').length,
    annotationScore: raw.annotationScore || 0,
  };
}

/* ------------------------------------------------------------------ */
/* Wikipedia, found through Wikidata's UniProt links                    */
/* ------------------------------------------------------------------ */

const wikiCache = new Map();
const WD = 'https://www.wikidata.org/w/api.php';

export async function fetchWikipedia(acc) {
  if (wikiCache.has(acc)) return wikiCache.get(acc);
  let out = null;
  try {
    const s = await getJSON(`${WD}?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P352=${acc}`)}&srlimit=1&format=json&origin=*`);
    const qid = s.query?.search?.[0]?.title;
    if (qid) {
      const e = await getJSON(`${WD}?action=wbgetentities&ids=${qid}&props=sitelinks|claims&sitefilter=enwiki&format=json&origin=*`);
      const ent = e.entities?.[qid];
      let title = ent?.sitelinks?.enwiki?.title;
      if (!title) {
        // Most articles are attached to the gene item, which "encodes" this protein.
        const gene = ent?.claims?.P702?.[0]?.mainsnak?.datavalue?.value?.id;
        if (gene) {
          const g = await getJSON(`${WD}?action=wbgetentities&ids=${gene}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`);
          title = g.entities?.[gene]?.sitelinks?.enwiki?.title;
        }
      }
      if (title) {
        const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
        if (sum?.extract && sum.type !== 'disambiguation') {
          out = {
            title: sum.title,
            extract: sum.extract,
            url: sum.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
          };
        }
      }
    }
  } catch {
    out = null;
  }
  wikiCache.set(acc, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Plain language                                                       */
/* ------------------------------------------------------------------ */

export function firstSentences(text, count = 2, max = 240) {
  if (!text) return '';
  const parts = text.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [text];
  let out = '';
  for (const p of parts.slice(0, count)) {
    if (out && (out + p).length > max) break;
    out += p;
  }
  out = out.trim() || parts[0].trim();
  if (out.length > max + 40) out = `${out.slice(0, max).replace(/\s+\S*$/, '')}…`;
  return out;
}

const LOCATIONS = [
  [/^secreted|extracellular/i, 'outside the cell, after it’s released'],
  [/cell membrane|plasma membrane/i, 'in the cell’s outer membrane'],
  [/nucleus|nucleolus|chromosome/i, 'in the nucleus, where DNA is kept'],
  [/mitochondri/i, 'in mitochondria, the cell’s power plants'],
  [/chloroplast|plastid|thylakoid/i, 'in chloroplasts, where plants capture sunlight'],
  [/endoplasmic reticulum/i, 'in the endoplasmic reticulum, where many proteins are made'],
  [/golgi/i, 'in the Golgi, the cell’s shipping center'],
  [/lysosome|vacuole/i, 'in the cell’s recycling compartments'],
  [/peroxisome/i, 'in peroxisomes, which break down fats'],
  [/synapse/i, 'at synapses, where nerve cells talk'],
  [/cytoskeleton|microtubule|actin/i, 'along the cell’s internal skeleton'],
  [/cilium|flagellum/i, 'in the hair-like parts that let cells move or sense'],
  [/virion/i, 'inside virus particles'],
  [/cytoplasm|cytosol/i, 'in the fluid inside the cell'],
];

export function plainLocations(locs) {
  const out = [];
  for (const l of locs) {
    const hit = LOCATIONS.find(([re]) => re.test(l));
    const phrase = hit ? hit[1] : `in the ${l.toLowerCase()}`;
    if (!out.includes(phrase)) out.push(phrase);
    if (out.length === 2) break;
  }
  return out;
}

const LIGANDS = {
  'Zn(2+)': 'zinc', 'Ca(2+)': 'calcium', 'Mg(2+)': 'magnesium', 'Fe(2+)': 'iron', 'Fe(3+)': 'iron',
  'Cu(2+)': 'copper', 'Cu cation': 'copper', 'Mn(2+)': 'manganese', 'Na(+)': 'sodium', 'K(+)': 'potassium',
  'heme b': 'heme, an iron-carrying ring', heme: 'heme, an iron-carrying ring', 'Co(2+)': 'cobalt', 'Ni(2+)': 'nickel',
  'chloride': 'chloride',
};
export const plainLigand = (name) => LIGANDS[name] || name;

const LINEAGE = [
  ['Serpentes', 'a snake'], ['Scorpiones', 'a scorpion'], ['Araneae', 'a spider'], ['Conus', 'a cone snail'],
  ['Insecta', 'an insect'], ['Arachnida', 'an arachnid'], ['Mollusca', 'a mollusk'], ['Cnidaria', 'a relative of jellyfish and corals'],
  ['Aves', 'a bird'], ['Mammalia', 'a mammal'], ['Amphibia', 'an amphibian'], ['Actinopterygii', 'a fish'],
  ['Chondrichthyes', 'a shark or ray'], ['Lepidosauria', 'a reptile'], ['Testudines', 'a turtle'], ['Crocodylia', 'a crocodilian'],
  ['Nematoda', 'a roundworm'], ['Viridiplantae', 'a plant'], ['Fungi', 'a fungus'],
  ['Bacteria', 'a bacterium'], ['Archaea', 'an archaeon, a single-celled microbe'], ['Viruses', 'a virus'],
];

export function organismLine(org) {
  if (!org) return null;
  if (org.taxonId === 9606) return 'Your own body makes this one.';
  const kind = LINEAGE.find(([k]) => org.lineage.includes(k))?.[1];
  const nameBits = org.common ? `${org.common} (${org.scientific})` : org.scientific;
  return kind ? `Made by ${nameBits}, ${kind}.` : `Made by ${nameBits}.`;
}

export function isUncharacterized(info) {
  if (!info) return false;
  return /uncharacteri[sz]ed|hypothetical/i.test(info.name || '') || (!info.reviewed && !info.functions.length);
}

const AMINO_NAMES = {
  A: 'alanine', R: 'arginine', N: 'asparagine', D: 'aspartate', C: 'cysteine', Q: 'glutamine', E: 'glutamate',
  G: 'glycine', H: 'histidine', I: 'isoleucine', L: 'leucine', K: 'lysine', M: 'methionine', F: 'phenylalanine',
  P: 'proline', S: 'serine', T: 'threonine', W: 'tryptophan', Y: 'tyrosine', V: 'valine',
};

const fmt = (n) => Math.round(n).toLocaleString();
const joinList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function summaryText({ info, wiki, feat }) {
  if (feat) return feat.fact;
  if (info && isUncharacterized(info)) return 'No one has studied this protein yet. AlphaFold predicted its shape anyway, from its sequence alone.';
  if (info?.functions?.length) return firstSentences(info.functions[0], 2, 220);
  if (wiki) return firstSentences(wiki.extract, 2, 220);
  return null;
}

// The deck of facts that pops up each time you grab the protein.
export function buildFacts({ prot, info, wiki, feat }) {
  const facts = [];
  const add = (title, body, source) => { if (body) facts.push({ title, body, source }); };

  if (feat) add('Why it’s famous', feat.fact, 'Written for Native State');
  if (info && isUncharacterized(info)) {
    add('Never studied', 'No scientist has studied this protein yet. AlphaFold predicted its shape anyway, from its string of letters alone. You might be one of the first people to look at it.', 'UniProt');
  }
  if (info?.functions?.length) add('What it does', firstSentences(info.functions[0], 2, 260), 'UniProt');
  else if (wiki) add('What it is', firstSentences(wiki.extract, 2, 260), 'Wikipedia');

  if (info?.locations?.length || info?.tissue) {
    const where = info.locations.length ? `It works ${joinList(plainLocations(info.locations))}.` : '';
    const tissue = info.tissue ? ` ${firstSentences(info.tissue, 1, 150)}` : '';
    add('Where it works', `${where}${tissue}`.trim(), 'UniProt');
  }
  if (info?.diseases?.length) {
    const d = info.diseases.slice(0, 3);
    const more = info.diseases.length > 3 ? `, and ${info.diseases.length - 3} more` : '';
    add('Linked to', `Changes in this protein are linked to ${joinList(d)}${more}.`, 'UniProt');
  }
  if (info?.drugs?.length) {
    const d = info.drugs.slice(0, 4);
    const more = info.drugs.length > 4 ? ` and ${info.drugs.length - 4} others` : '';
    add('Medicines', `Medicines and compounds known to act on it include ${joinList(d)}${more}.`, 'DrugBank, via UniProt');
  }
  if (info) {
    add('Seen in a lab', info.pdbCount > 0
      ? `Scientists have measured its real shape ${fmt(info.pdbCount)} ${info.pdbCount === 1 ? 'time' : 'times'}, with X-rays, electron microscopes or magnets. AlphaFold predicts the same kind of shape in seconds.`
      : 'No one has measured this protein’s shape in a lab. This AlphaFold prediction is the best look anyone has.', 'UniProt');
  }

  // Size, from the structure itself.
  const nm = (prot.radius * 2) / 10;
  const hair = 70000 / nm;
  const stretched = prot.n * 0.38;
  add('How big it is', `About ${nm.toFixed(1)} nanometers across. Line up ${fmt(hair)} of them and you’d match the width of one human hair. Stretched out, its chain would be ${fmt(stretched)} nanometers long.`, 'From the structure');

  // Building blocks.
  const counts = {};
  for (const ch of prot.seq) counts[ch] = (counts[ch] || 0) + 1;
  const [top, topN] = Object.entries(counts).filter(([k]) => AMINO_NAMES[k]).sort((a, b) => b[1] - a[1])[0] || [];
  const mass = info?.mass ? ` It weighs about as much as ${fmt(info.mass)} hydrogen atoms.` : '';
  if (top) add('What it’s made of', `${fmt(prot.n)} amino acids, picked from the same 20 that every living thing uses. The most common one here is ${AMINO_NAMES[top]}, at ${Math.round((100 * topN) / prot.n)}%.${mass}`, 'From the structure');

  add('Who makes it', organismLine(info?.organism), 'UniProt');

  const sure = Math.round((100 * (prot.counts[0] + prot.counts[1])) / prot.n);
  add('How sure AlphaFold is', sure >= 85
    ? `AlphaFold is confident about ${sure}% of this chain, so this shape is likely close to the real thing.`
    : `AlphaFold is confident about ${sure}% of this chain. The parts it’s unsure about often have no fixed shape in real life, which is why they wobble here.`, 'AlphaFold DB');

  if (wiki && !facts.some((f) => f.source === 'Wikipedia')) {
    add('From Wikipedia', firstSentences(wiki.extract, 2, 260), 'Wikipedia');
  }
  return facts;
}

// Labels on the model: curated marks first, then sites from UniProt, then the chain's ends.
export function buildMarks({ prot, info, feat }) {
  const { n, first } = prot;
  const last = first + n - 1;
  const idx = (num) => Math.min(n - 1, Math.max(0, num - first));
  const inRange = (from, to) => from != null && to != null && to >= first && from <= last;
  const marks = [];
  const push = (from, to, text) => {
    if (!inRange(from, to) || marks.length >= 6) return;
    marks.push({ a: idx(from), b: idx(to), text });
  };

  for (const m of feat?.marks || []) push(m.from, m.to, m.text);

  if (info && !feat?.marks?.length) {
    if (info.active.length) {
      const a = info.active.filter((s) => s.from != null);
      if (a.length) {
        const center = a.map((s) => s.from).sort((x, y) => x - y)[Math.floor(a.length / 2)];
        push(center, center, 'Active site, where the chemistry happens');
      }
    }
    const byLigand = new Map();
    for (const b of info.binding) {
      if (!b.ligand || b.from == null) continue;
      if (!byLigand.has(b.ligand)) byLigand.set(b.ligand, []);
      byLigand.get(b.ligand).push(b.from);
    }
    [...byLigand.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 2).forEach(([lig, list]) => {
      const p = list.sort((x, y) => x - y)[Math.floor(list.length / 2)];
      push(p, p, `Holds ${plainLigand(lig)}`);
    });
    if (info.signal) push(info.signal.from, info.signal.to, 'Address tag, cut off once delivered');
    if (info.transmem.length) {
      const t = info.transmem[Math.floor(info.transmem.length / 2)];
      push(t.from, t.to, info.transmem.length > 1 ? `Crosses the cell membrane ${info.transmem.length} times` : 'Crosses the cell membrane');
    }
    if (marks.length < 3 && info.domains.length) {
      const d = info.domains.filter((x) => x.name)[0];
      if (d) push(d.from, d.to, `${d.name} domain`);
    }
  }

  push(first, first + 2, 'Chain starts');
  push(last - 2, last, 'Chain ends');

  if (marks.length < 5 && n > 40) {
    const win = 12;
    let best = Infinity;
    let at = 0;
    let run = 0;
    for (let i = 0; i < n; i++) {
      run += prot.plddt[i];
      if (i >= win) run -= prot.plddt[i - win];
      if (i >= win - 1 && run / win < best) { best = run / win; at = i - win + 1; }
    }
    if (best < 55 && at > 6 && at + win < n - 6) push(first + at, first + at + win - 1, 'Least certain stretch');
  }
  return marks;
}
