const fs = require('fs');

const content = fs.readFileSync('src/pages/Home.tsx', 'utf8');
const lines = content.split('\n');

// Line ranges (1-indexed) to PRESERVE as-is (hero section + demo UI mockups)
const PRESERVE_RANGES = [
  [169, 225],  // hero section (stays dark navy)
  [487, 506],  // drafting editor mockup (dark UI)
  [574, 607],  // chat widget (dark UI)
];

function inPreserveRange(lineno) {
  return PRESERVE_RANGES.some(([s, e]) => lineno >= s && lineno <= e);
}

const REPLACEMENTS = [
  // Section backgrounds
  ["background: '#050505' }}>", "background: '#ffffff' }}>"],
  ["background: 'rgba(255,255,255,0.02)' }}>", "background: '#FAF8F3' }}>"],
  ["background: 'rgba(255,255,255,0.03)', borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)'",
   "background: '#ffffff', borderTop: '1px solid #e8d5a3', borderBottom: '1px solid #e8d5a3'"],

  // H2 heading colors
  ["fontSize: 38, color: '#fff',", "fontSize: 38, color: '#0a0f1e',"],
  ["fontSize: 40, color: '#fff',", "fontSize: 40, color: '#0a0f1e',"],
  ["fontSize: 48, color: '#fff',", "fontSize: 48, color: '#0a0f1e',"],
  ["fontSize: 38, color: '#fff' }", "fontSize: 38, color: '#0a0f1e' }"],
  ["fontSize: 40, color: '#fff' }", "fontSize: 40, color: '#0a0f1e' }"],
  ["fontSize: 48, color: '#fff' }", "fontSize: 48, color: '#0a0f1e' }"],
  ["fontSize: 40, color: '#fff', marginBottom: 16", "fontSize: 40, color: '#0a0f1e', marginBottom: 16"],

  // H3 heading colors
  ["fontSize: 18, fontWeight: 700, color: '#fff'", "fontSize: 18, fontWeight: 700, color: '#0a0f1e'"],
  ["fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: '\"Playfair Display\",serif'",
   "fontSize: 16, fontWeight: 700, color: '#0a0f1e', fontFamily: '\"Playfair Display\",serif'"],

  // Feature item headings
  ["fontWeight: 700, fontSize: 14, color: '#fff' }}", "fontWeight: 700, fontSize: 14, color: '#0a0f1e' }}"],

  // Body text
  ["color: 'rgba(255,255,255,0.75)'", "color: '#374151'"],
  ["color: 'rgba(255,255,255,0.7)'", "color: '#4b5563'"],
  ["color: 'rgba(255,255,255,0.6)'", "color: '#4b5563'"],
  ["color: 'rgba(255,255,255,0.55)'", "color: '#4b5563'"],
  ["color: 'rgba(255,255,255,0.5)'", "color: '#6b7280'"],
  ["color: 'rgba(255,255,255,0.45)'", "color: '#6b7280'"],
  ["color: 'rgba(255,255,255,0.4)'", "color: '#9ca3af'"],
  ["color: 'rgba(255,255,255,0.35)'", "color: '#9ca3af'"],
  ["color: 'rgba(255,255,255,0.3)'", "color: '#9ca3af'"],

  // Card backgrounds
  ["background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)'",
   "background: '#ffffff', border: '1px solid #f0e8d0'"],
  ["background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)'",
   "background: '#f9fafb', border: '1px solid #e8d5a3'"],
  // Expert cards
  ["background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.08)'",
   "background: '#ffffff', border: '1px solid #f0e8d0'"],

  // onMouseLeave borders
  ["el.style.borderColor = 'rgba(255,255,255,0.08)'",
   "el.style.borderColor = '#f0e8d0'"],

  // Expert card photo border
  ["border: '2px solid rgba(255,255,255,0.1)' }}",
   "border: '2px solid #e8d5a3' }}"],

  // Online dot border on expert cards
  ["border: '2px solid #0f172a'",
   "border: '2px solid #ffffff'"],

  // Expert name
  ["fontWeight: 600, color: '#fff', fontSize: 13,",
   "fontWeight: 600, color: '#0a0f1e', fontSize: 13,"],

  // Expert rate
  ["fontWeight: 700, color: '#fff', fontSize: 13",
   "fontWeight: 700, color: '#0a0f1e', fontSize: 13"],

  // Expert stats
  ["fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 12",
   "fontSize: 12, color: '#6b7280', marginBottom: 12"],

  // Border patterns
  ["border: '1px solid rgba(255,255,255,0.08)'", "border: '1px solid #f0e8d0'"],
  ["border: '1px solid rgba(255,255,255,0.07)'", "border: '1px solid #e8d5a3'"],
  ["border: '1px solid rgba(255,255,255,0.10)'", "border: '1px solid #e8d5a3'"],
  ["border: '1px solid rgba(255,255,255,0.12)'", "border: '1px solid #e8d5a3'"],
  ["border: '1px solid rgba(255,255,255,0.15)'", "border: '1px solid #e8d5a3'"],
  ["borderTop: '1px solid rgba(255,255,255,0.08)'", "borderTop: '1px solid #f0e8d0'"],
  ["borderTop: '1px solid rgba(255,255,255,0.06)'", "borderTop: '1px solid #f0e8d0'"],
  ["borderBottom: '1px solid rgba(255,255,255,0.08)'", "borderBottom: '1px solid #f0e8d0'"],
  ["borderRight: i < STATS.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none'",
   "borderRight: i < STATS.length - 1 ? '1px solid #e8d5a3' : 'none'"],

  // Progress bar tracks
  ["background: 'rgba(255,255,255,0.08)', borderRadius: 2", "background: '#f0e8d0', borderRadius: 2"],
  ["background: 'rgba(255,255,255,0.08)', borderRadius: 3", "background: '#f0e8d0', borderRadius: 3"],

  // Win probability label
  ["fontSize: 13, color: '#6b7280', marginTop: 2 }}>Estimated Win Probability",
   "fontSize: 13, color: '#6b7280', marginTop: 2 }}>Estimated Win Probability"],

  // Case Factor Analysis title
  ["fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>Case Factor Analysis",
   "fontSize: 14, fontWeight: 700, color: '#374151' }}>Case Factor Analysis"],

  // Why Us items
  ["background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '18px 22px'",
   "background: '#ffffff', border: '1px solid #f0e8d0', borderRadius: 12, padding: '18px 22px'"],

  // Security cards (green tint - keep the tint, just fix text)
  // desc text is already handled by rgba replacement above

  // Practice area cards
  ["background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14",
   "background: '#ffffff', border: '1px solid #f0e8d0', borderRadius: 14"],
  ["el.style.borderColor = 'rgba(255,255,255,0.08)'; el.style.background = 'rgba(255,255,255,0.04)'",
   "el.style.borderColor = '#e8d5a3'; el.style.background = '#ffffff'"],
  ["fontSize: 14, color: '#fff' }}>{p.name}", "fontSize: 14, color: '#0a0f1e' }}>{p.name}"],
  ["fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>{p.desc}",
   "fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{p.desc}"],

  // Security card desc
  ["fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>{s.desc}",
   "fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{s.desc}"],

  // How it works desc
  ["fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>{s.desc}",
   "fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>{s.desc}"],

  // Final CTA section
  ["padding: '100px 0', background: 'linear-gradient(to bottom, #050505, rgba(245,166,35,0.06), #050505)'",
   "padding: '100px 0', background: '#FFF8EE'"],
  ['<Logo size="lg" litigationColor="#ffffff" />',
   '<Logo size="lg" litigationColor="#0a0f1e" />'],
  ["background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 16, padding: '14px 32px', borderRadius: 9, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.15)'",
   "background: '#0a1628', color: '#ffffff', fontWeight: 600, fontSize: 16, padding: '14px 32px', borderRadius: 9, textDecoration: 'none', border: 'none'"],
  ["color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No credit card",
   "color: '#9ca3af', fontSize: 13 }}>No credit card"],

  // Ghost button for "Smart Intake Form"
  ["background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 600, fontSize: 14, padding: '11px 22px', borderRadius: 8, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.12)'",
   "background: 'transparent', color: '#0a1628', fontWeight: 600, fontSize: 14, padding: '11px 22px', borderRadius: 8, textDecoration: 'none', border: '1.5px solid #0a1628'"],

  // Legal Brain tier desc
  ["color: 'rgba(255,255,255,0.5)' }}>{t.desc}", "color: '#6b7280' }}>{t.desc}"],

  // Live Bench stats label
  ["fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{s.label}",
   "fontSize: 11, color: '#6b7280', marginTop: 2 }}>{s.label}"],

  // Case Navigator headings
  ["fontSize: 14, color: '#fff' }}>{f.label}", "fontSize: 14, color: '#0a0f1e' }}>{f.label}"],
  ["fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{f.desc}", "fontSize: 13, color: '#6b7280' }}>{f.desc}"],
  ["fontWeight: 700, fontSize: 14, color: '#fff' }}>{s.title}", "fontWeight: 700, fontSize: 14, color: '#0a0f1e' }}>{s.title}"],
  ["fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{s.desc}", "fontSize: 13, color: '#6b7280' }}>{s.desc}"],

  // Motion Intelligence tool block text
  ["color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>Built for motions",
   "color: '#6b7280', lineHeight: 1.6 }}>Built for motions"],
  ["color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>Built for contracts",
   "color: '#6b7280', lineHeight: 1.6 }}>Built for contracts"],

  // Strong text in Motion Intelligence
  ["<strong style={{ color: '#fff' }}>Free. No account required.</strong>",
   "<strong style={{ color: '#0a0f1e' }}>Free. No account required.</strong>"],

  // Sample analysis subtitle
  ["fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Motion to Dismiss",
   "fontSize: 13, color: '#9ca3af' }}>Motion to Dismiss"],

  // WIN SCORE label
  ["fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>WIN SCORE",
   "fontSize: 11, color: '#9ca3af', marginTop: 2 }}>WIN SCORE"],

  // Analysis item labels
  ["color: 'rgba(255,255,255,0.6)' }}>{item.label}", "color: '#374151' }}>{item.label}"],

  // Risk flag body
  ["fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>• {f}", "fontSize: 12, color: '#374151' }}>• {f}"],

  // Case Navigator purple box headings
  ["fontSize: 14, color: '#fff' }}>{s.title}", "fontSize: 14, color: '#0a0f1e' }}>{s.title}"],
];

const result = lines.map((line, i) => {
  const lineno = i + 1;

  // Line 165: outer wrapper
  if (lineno === 165) {
    return line.replace("background: '#050505', color: '#fff'", "background: '#FAF8F3', color: '#1a1a1a'");
  }

  if (inPreserveRange(lineno)) {
    return line;
  }

  let out = line;
  for (const [oldStr, newStr] of REPLACEMENTS) {
    if (out.includes(oldStr)) {
      out = out.split(oldStr).join(newStr);
    }
  }
  return out;
});

fs.writeFileSync('src/pages/Home.tsx', result.join('\n'), 'utf8');
console.log('Done! Home.tsx color scheme updated.');
console.log('Lines:', result.length);
