/**
 * Transform Home.tsx:
 * - 5 sections → pure white #ffffff with dark text
 * - All other sections → dark navy #0d1117 with white text
 * - Hero stays dark (but updates #050505 → #0d1117)
 * - Preserves demo UIs (drafting editor, chat widget)
 */
const fs = require('fs');
const lines = fs.readFileSync('src/pages/Home.tsx', 'utf8').split('\n');

// Section line ranges (1-indexed, inclusive)
const SECTIONS = {
  hero:      { start: 169, end: 225, type: 'hero'  },
  stats:     { start: 228, end: 239, type: 'white' },  // WHITE ✓
  motion:    { start: 242, end: 318, type: 'dark'  },
  pillars:   { start: 321, end: 361, type: 'dark'  },
  winSim:    { start: 364, end: 414, type: 'dark'  },
  liveBench: { start: 417, end: 480, type: 'white' },  // WHITE ✓
  drafting:  { start: 483, end: 542, type: 'dark'  },  // editor mockup preserved inside
  legalBrain:{ start: 544, end: 611, type: 'dark'  },  // chat widget preserved inside
  caseNav:   { start: 613, end: 665, type: 'dark'  },
  whyUs:     { start: 668, end: 690, type: 'white' },  // WHITE ✓
  security:  { start: 693, end: 720, type: 'white' },  // WHITE ✓
  howItWorks:{ start: 723, end: 744, type: 'dark'  },
  practice:  { start: 746, end: 767, type: 'dark'  },
  cta:       { start: 770, end: 791, type: 'white' },  // WHITE ✓
};

// These sub-ranges are ALWAYS preserved (dark demo UIs inside dark sections)
const ALWAYS_PRESERVE = [
  { start: 487, end: 506 },  // Drafting editor mockup
  { start: 574, end: 607 },  // Chat widget
];

function getSectionType(lineno) {
  for (const [, sec] of Object.entries(SECTIONS)) {
    if (lineno >= sec.start && lineno <= sec.end) return sec.type;
  }
  return 'outer'; // between sections, or wrapper
}

function inAlwaysPreserve(lineno) {
  return ALWAYS_PRESERVE.some(r => lineno >= r.start && lineno <= r.end);
}

// Replacements for DARK sections (light → dark)
const DARK_REPLACEMENTS = [
  // Section backgrounds
  ["background: '#ffffff' }}>", "background: '#0d1117' }}>"],
  ["background: '#FAF8F3' }}>", "background: '#0d1117' }}>"],
  ["background: '#f9fafb' }}>", "background: '#0d1117' }}>"],

  // H2 colors
  ["color: '#0a0f1e', marginBottom: 16 }}>", "color: '#ffffff', marginBottom: 16 }}>"],
  ["color: '#0a0f1e' }}>", "color: '#ffffff' }}>"],  // general heading
  ["color: '#0a0f1e', letterSpacing:", "color: '#ffffff', letterSpacing:"],

  // H3 colors
  ["fontWeight: 700, color: '#0a0f1e', fontFamily: '\"Playfair Display\",serif'",
   "fontWeight: 700, color: '#ffffff', fontFamily: '\"Playfair Display\",serif'"],
  ["fontWeight: 700, fontSize: 14, color: '#0a0f1e'", "fontWeight: 700, fontSize: 14, color: '#ffffff'"],

  // Body text
  ["color: '#4b5563', fontSize: 15, lineHeight: 1.7, marginBottom: 28",
   "color: 'rgba(255,255,255,0.6)', fontSize: 15, lineHeight: 1.7, marginBottom: 28"],
  ["color: '#4b5563', fontSize: 15, lineHeight: 1.7, marginBottom: 24",
   "color: 'rgba(255,255,255,0.6)', fontSize: 15, lineHeight: 1.7, marginBottom: 24"],
  ["color: '#4b5563', fontSize: 15, maxWidth: 600,",
   "color: 'rgba(255,255,255,0.55)', fontSize: 15, maxWidth: 600,"],
  ["color: '#4b5563', fontSize: 15, lineHeight: 1.7 }}>",
   "color: 'rgba(255,255,255,0.6)', fontSize: 15, lineHeight: 1.7 }}>"],
  ["color: '#4b5563', lineHeight: 1.7", "color: 'rgba(255,255,255,0.55)', lineHeight: 1.7"],
  ["color: '#4b5563', fontSize: 14, lineHeight: 1.7", "color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.7"],
  ["color: '#4b5563', fontSize: 14, color: '#4b5563'", "color: 'rgba(255,255,255,0.55)', fontSize: 14"],
  // General #4b5563 catch-all
  ["color: '#4b5563'", "color: 'rgba(255,255,255,0.6)'"],

  // Secondary text
  ["color: '#6b7280'", "color: 'rgba(255,255,255,0.5)'"],
  ["color: '#374151'", "color: 'rgba(255,255,255,0.6)'"],

  // Muted text
  ["color: '#9ca3af'", "color: 'rgba(255,255,255,0.4)'"],

  // Strong text overrides
  ["color: '#0a0f1e' }}>Free. No account required.", "color: '#ffffff' }}>Free. No account required."],

  // Card/panel backgrounds
  ["background: '#f9fafb', border: '1px solid #e8d5a3'",
   "background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)'"],
  ["background: '#ffffff', border: '1px solid #f0e8d0'",
   "background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)'"],

  // Panel bottom border
  ["borderBottom: '1px solid #f0e8d0'", "borderBottom: '1px solid rgba(255,255,255,0.08)'"],

  // onMouseLeave borders
  ["el.style.borderColor = '#f0e8d0'", "el.style.borderColor = 'rgba(255,255,255,0.08)'"],
  ["e.currentTarget.style.borderColor = '#f0e8d0'", "e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'"],

  // Practice area card mouse leave
  ["el.style.borderColor = '#f0e8d0'; el.style.background = '#ffffff'",
   "el.style.borderColor = 'rgba(255,255,255,0.08)'; el.style.background = 'rgba(255,255,255,0.04)'"],

  // Progress bar tracks
  ["background: '#f0e8d0', borderRadius: 2", "background: 'rgba(255,255,255,0.08)', borderRadius: 2"],
  ["background: '#f0e8d0', borderRadius: 3", "background: 'rgba(255,255,255,0.08)', borderRadius: 3"],

  // Drafting ghost button (Smart Intake Form)
  ["background: 'transparent', color: '#0a1628', fontWeight: 600, fontSize: 14, padding: '11px 22px', borderRadius: 8, textDecoration: 'none', border: '1.5px solid #0a1628'",
   "background: 'rgba(255,255,255,0.06)', color: '#ffffff', fontWeight: 600, fontSize: 14, padding: '11px 22px', borderRadius: 8, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.12)'"],

  // How It Works step titles
  ["fontSize: 16, fontWeight: 700, color: '#0a0f1e', fontFamily: '\"Playfair Display\",serif'",
   "fontSize: 16, fontWeight: 700, color: '#ffffff', fontFamily: '\"Playfair Display\",serif'"],

  // Practice area card
  ["background: '#ffffff', border: '1px solid #f0e8d0', borderRadius: 14",
   "background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14"],
];

// Replacements for WHITE sections (currently mixed → pure white)
const WHITE_REPLACEMENTS = [
  // Fix section background
  ["background: '#FAF8F3' }}>", "background: '#ffffff' }}>"],
  ["background: '#FFF8EE' }}>", "background: '#ffffff' }}>"],

  // Fix stats bar borders
  ["borderTop: '1px solid #e8d5a3', borderBottom: '1px solid #e8d5a3'",
   "borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb'"],
  ["borderRight: i < STATS.length - 1 ? '1px solid #e8d5a3' : 'none'",
   "borderRight: i < STATS.length - 1 ? '1px solid #e5e7eb' : 'none'"],

  // Stats bar label text - #6b7280 → #1a1a1a
  // (we use context: inside stats map)
  ["color: '#6b7280', marginTop: 4, fontWeight: 500", "color: '#1a1a1a', marginTop: 4, fontWeight: 500"],

  // Why Us card borders
  ["background: '#ffffff', border: '1px solid #f0e8d0', borderRadius: 12, padding: '18px 22px'",
   "background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '18px 22px'"],
  // Why Us item text
  ["fontSize: 15, color: '#374151', lineHeight: 1.6", "fontSize: 15, color: '#1a1a1a', lineHeight: 1.6"],
  // Why Us body
  ["color: '#4b5563', fontSize: 15, lineHeight: 1.7 }}>\\n                Designed for",
   "color: '#1a1a1a', fontSize: 15, lineHeight: 1.7 }}>\\n                Designed for"],

  // Live Bench section bg
  // (covered by #FAF8F3 replacement above)

  // Live Bench expert cards - update borders
  ["background: '#ffffff', border: '1px solid #f0e8d0', borderRadius: 16",
   "background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 16"],
  ["e.currentTarget.style.borderColor = '#f0e8d0'",
   "e.currentTarget.style.borderColor = '#e5e7eb'"],
  ["border: '2px solid #e8d5a3' }}", "border: '2px solid #e5e7eb' }}"],

  // Live Bench stats label text
  ["fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{s.label}",
   "fontSize: 11, color: '#1a1a1a', marginTop: 2 }}>{s.label}"],
  // Live Bench expert stats text
  ["fontSize: 12, color: '#9ca3af', marginBottom: 12",
   "fontSize: 12, color: '#6b7280', marginBottom: 12"],

  // Security card descriptions
  ["fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>{s.desc}",
   "fontSize: 12, color: '#1a1a1a', lineHeight: 1.5 }}>{s.desc}"],

  // Final CTA bg
  ["padding: '100px 0', background: '#FFF8EE'", "padding: '100px 0', background: '#ffffff'"],
  // Fine print
  ["color: '#9ca3af', fontSize: 13 }}>No credit card", "color: '#6b7280', fontSize: 13 }}>No credit card"],
];

const result = lines.map((line, i) => {
  const lineno = i + 1;

  // Line 165: outer wrapper
  if (lineno === 165) {
    return line
      .replace("background: '#FAF8F3', color: '#1a1a1a'", "background: '#0d1117', color: '#ffffff'")
      .replace("background: '#0d1117', color: '#1a1a1a'", "background: '#0d1117', color: '#ffffff'");
  }

  // Hero section - only fix #050505 → #0d1117
  if (lineno >= 169 && lineno <= 225) {
    return line.replace("'#050505'", "'#0d1117'");
  }

  // Always-preserve demo UIs
  if (inAlwaysPreserve(lineno)) return line;

  const stype = getSectionType(lineno);

  if (stype === 'dark') {
    let out = line;
    for (const [o, n] of DARK_REPLACEMENTS) {
      if (out.includes(o)) out = out.split(o).join(n);
    }
    return out;
  }

  if (stype === 'white') {
    let out = line;
    for (const [o, n] of WHITE_REPLACEMENTS) {
      if (out.includes(o)) out = out.split(o).join(n);
    }
    return out;
  }

  // outer / between sections — just fix any stray FAF8F3 wrapper
  if (lineno === 165) {
    return line.replace("'#FAF8F3'", "'#0d1117'").replace("'#1a1a1a'", "'#ffffff'");
  }

  return line;
});

fs.writeFileSync('src/pages/Home.tsx', result.join('\n'), 'utf8');
console.log('Done! Home.tsx updated to dark navy + 5 white sections.');
