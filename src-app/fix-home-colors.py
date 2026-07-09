"""
Transform Home.tsx dark sections → cream/white theme.
Hero section (lines 169-225) stays dark navy.
Demo UI mockups (drafting editor, chat widget) stay dark - they're realistic app mockups.
"""

with open('src/pages/Home.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Line ranges (1-indexed) to PRESERVE as-is (hero + demo UIs)
# Hero: lines 169-225
# Drafting editor mockup: lines 487-506
# Legal Brain chat widget: lines 574-607
PRESERVE_RANGES = [
    (169, 225),   # hero section
    (487, 506),   # drafting editor mockup
    (574, 607),   # chat widget
]

def in_preserve_range(lineno):
    for start, end in PRESERVE_RANGES:
        if start <= lineno <= end:
            return True
    return False

# Replacements to apply outside preserved ranges
# Order matters - more specific first
REPLACEMENTS = [
    # Outer wrapper - only on line 165
    # (handled separately below)

    # ── Section backgrounds ──
    ("background: '#050505' }}>", "background: '#ffffff' }}>"),   # section bg (odd)
    ("background: 'rgba(255,255,255,0.02)' }}>", "background: '#FAF8F3' }}>"),  # section bg (even)
    ("background: 'rgba(255,255,255,0.03)', borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)'",
     "background: '#ffffff', borderTop: '1px solid #e8d5a3', borderBottom: '1px solid #e8d5a3'"),  # stats bar

    # ── H2 heading colors ──
    ("fontSize: 38, color: '#fff',", "fontSize: 38, color: '#0a0f1e',"),
    ("fontSize: 40, color: '#fff',", "fontSize: 40, color: '#0a0f1e',"),
    ("fontSize: 48, color: '#fff',", "fontSize: 48, color: '#0a0f1e',"),
    ("fontSize: 38, color: '#fff' }", "fontSize: 38, color: '#0a0f1e' }"),
    ("fontSize: 40, color: '#fff' }", "fontSize: 40, color: '#0a0f1e' }"),
    ("fontSize: 48, color: '#fff' }", "fontSize: 48, color: '#0a0f1e' }"),

    # H3 heading colors
    ("fontSize: 18, fontWeight: 700, color: '#fff'", "fontSize: 18, fontWeight: 700, color: '#0a0f1e'"),
    ("fontSize: 16, fontWeight: 700, color: '#fff'", "fontSize: 16, fontWeight: 700, color: '#0a0f1e'"),
    ("fontSize: 14, color: '#fff' }", "fontSize: 14, color: '#0a0f1e' }"),

    # Feature item headings (Case Navigator section)
    ("fontWeight: 700, fontSize: 14, color: '#fff' }", "fontWeight: 700, fontSize: 14, color: '#0a0f1e' }"),

    # Body text colors (outside hero/demos)
    ("color: 'rgba(255,255,255,0.75)'", "color: '#374151'"),
    ("color: 'rgba(255,255,255,0.7)'", "color: '#4b5563'"),
    ("color: 'rgba(255,255,255,0.6)'", "color: '#4b5563'"),
    ("color: 'rgba(255,255,255,0.55)'", "color: '#4b5563'"),
    ("color: 'rgba(255,255,255,0.5)'", "color: '#6b7280'"),
    ("color: 'rgba(255,255,255,0.45)'", "color: '#6b7280'"),
    ("color: 'rgba(255,255,255,0.4)'", "color: '#9ca3af'"),
    ("color: 'rgba(255,255,255,0.35)'", "color: '#9ca3af'"),
    ("color: 'rgba(255,255,255,0.3)'", "color: '#9ca3af'"),

    # ── Card / panel backgrounds ──
    ("background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)'",
     "background: '#ffffff', border: '1px solid #f0e8d0'"),
    ("background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)'",
     "background: '#f9fafb', border: '1px solid #e8d5a3'"),
    # Expert cards (live bench)
    ("background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.08)'",
     "background: '#ffffff', border: '1px solid #f0e8d0'"),

    # Card onMouseLeave borders
    ("el.style.borderColor = 'rgba(255,255,255,0.08)'",
     "el.style.borderColor = '#f0e8d0'"),

    # Expert card img border
    ("border: '2px solid rgba(255,255,255,0.1)' }}",
     "border: '2px solid #e8d5a3' }}"),

    # Expert card online dot border
    ("border: '2px solid #0f172a'",
     "border: '2px solid #ffffff'"),

    # Expert name color
    ("fontWeight: 600, color: '#fff', fontSize: 13",
     "fontWeight: 600, color: '#0a0f1e', fontSize: 13"),

    # Expert rate color
    ("fontWeight: 700, color: '#fff', fontSize: 13",
     "fontWeight: 700, color: '#0a0f1e', fontSize: 13"),

    # Expert stats text
    ("fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 12",
     "fontSize: 12, color: '#6b7280', marginBottom: 12"),

    # ── Border patterns ──
    ("border: '1px solid rgba(255,255,255,0.08)'",
     "border: '1px solid #f0e8d0'"),
    ("border: '1px solid rgba(255,255,255,0.07)'",
     "border: '1px solid #e8d5a3'"),
    ("border: '1px solid rgba(255,255,255,0.10)'",
     "border: '1px solid #e8d5a3'"),
    ("border: '1px solid rgba(255,255,255,0.12)'",
     "border: '1px solid #e8d5a3'"),
    ("border: '1px solid rgba(255,255,255,0.15)'",
     "border: '1px solid #e8d5a3'"),
    ("borderTop: '1px solid rgba(255,255,255,0.08)'",
     "borderTop: '1px solid #f0e8d0'"),
    ("borderTop: '1px solid rgba(255,255,255,0.06)'",
     "borderTop: '1px solid #f0e8d0'"),
    ("borderBottom: '1px solid rgba(255,255,255,0.08)'",
     "borderBottom: '1px solid #f0e8d0'"),
    ("borderRight: i < STATS.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none'",
     "borderRight: i < STATS.length - 1 ? '1px solid #e8d5a3' : 'none'"),

    # ── Progress bar tracks ──
    ("background: 'rgba(255,255,255,0.08)', borderRadius: 2",
     "background: '#f0e8d0', borderRadius: 2"),
    ("background: 'rgba(255,255,255,0.08)', borderRadius: 3",
     "background: '#f0e8d0', borderRadius: 3"),

    # ── Win probability text in demo panel ──
    ("fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>Estimated Win Probability",
     "fontSize: 13, color: '#6b7280', marginTop: 2 }}>Estimated Win Probability"),

    # Case Factor Analysis title
    ("fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>Case Factor Analysis",
     "fontSize: 14, fontWeight: 700, color: '#374151' }}>Case Factor Analysis"),

    # Why Us items text
    ("fontSize: 15, color: 'rgba(255,255,255,0.75)'",
     "fontSize: 15, color: '#374151'"),

    # Why Us item bg
    ("background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '18px 22px'",
     "background: '#ffffff', border: '1px solid #f0e8d0', borderRadius: 12, padding: '18px 22px'"),

    # Security section - change 'color: '#fff'' in headings
    ("fontSize: 38, color: '#fff', marginBottom: 16 }}>\\n              Security Built",
     "fontSize: 38, color: '#0a0f1e', marginBottom: 16 }}>\\n              Security Built"),

    # Security card descriptions
    ("fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>{s.desc}",
     "fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{s.desc}"),

    # How it works - h3 and p in steps
    ("fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: '\"Playfair Display\",serif'",
     "fontSize: 16, fontWeight: 700, color: '#0a0f1e', fontFamily: '\"Playfair Display\",serif'"),
    ("fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>{s.desc}",
     "fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>{s.desc}"),

    # Practice area cards
    ("background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14",
     "background: '#ffffff', border: '1px solid #f0e8d0', borderRadius: 14"),
    ("el.style.borderColor = 'rgba(255,255,255,0.08)'; el.style.background = 'rgba(255,255,255,0.04)'",
     "el.style.borderColor = '#f0e8d0'; el.style.background = '#ffffff'"),
    ("fontSize: 14, color: '#fff' }}>{p.name}",
     "fontSize: 14, color: '#0a0f1e' }}>{p.name}"),
    ("fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>{p.desc}",
     "fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{p.desc}"),

    # Final CTA section
    ("padding: '100px 0', background: 'linear-gradient(to bottom, #050505, rgba(245,166,35,0.06), #050505)'",
     "padding: '100px 0', background: '#FFF8EE'"),
    # Logo in final CTA - change to dark
    ("<Logo size=\"lg\" litigationColor=\"#ffffff\" />",
     "<Logo size=\"lg\" litigationColor=\"#0a0f1e\" />"),
    # Final CTA buttons
    ("background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 600, fontSize: 16, padding: '14px 32px', borderRadius: 9, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.15)'",
     "background: '#0a1628', color: '#ffffff', fontWeight: 600, fontSize: 16, padding: '14px 32px', borderRadius: 9, textDecoration: 'none', border: 'none'"),
    # Final CTA fine print
    ("color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No credit card",
     "color: '#9ca3af', fontSize: 13 }}>No credit card"),

    # Ghost button for "Smart Intake Form" (Drafting section)
    ("background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 600, fontSize: 14, padding: '11px 22px', borderRadius: 8, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.12)'",
     "background: 'transparent', color: '#0a1628', fontWeight: 600, fontSize: 14, padding: '11px 22px', borderRadius: 8, textDecoration: 'none', border: '1.5px solid #0a1628'"),

    # Legal Brain tier descriptions
    ("color: 'rgba(255,255,255,0.5)' }}>{t.desc}",
     "color: '#6b7280' }}>{t.desc}"),

    # Live Bench stats label
    ("fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{s.label}",
     "fontSize: 11, color: '#6b7280', marginTop: 2 }}>{s.label}"),

    # Case Navigator section content headings
    ("fontSize: 14, color: '#fff' }}>{f.label}",
     "fontSize: 14, color: '#0a0f1e' }}>{f.label}"),
    ("fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>{f.desc}",
     "fontSize: 13, color: '#6b7280' }}>{f.desc}"),
    # Case navigator RAG panel headings
    ("fontWeight: 700, fontSize: 14, color: '#fff' }}>{s.title}",
     "fontWeight: 700, fontSize: 14, color: '#0a0f1e' }}>{s.title}"),
    ("fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{s.desc}",
     "fontSize: 13, color: '#6b7280' }}>{s.desc}"),

    # Motion Intelligence tool block text
    ("color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>Built for motions",
     "color: '#6b7280', lineHeight: 1.6 }}>Built for motions"),
    ("color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>Built for contracts",
     "color: '#6b7280', lineHeight: 1.6 }}>Built for contracts"),

    # Motion Intelligence strong text
    ("<strong style={{ color: '#fff' }}>Free. No account required.</strong>",
     "<strong style={{ color: '#0a0f1e' }}>Free. No account required.</strong>"),

    # Sample analysis "Motion to Dismiss • SDNY" subtitle
    ("fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Motion to Dismiss",
     "fontSize: 13, color: '#9ca3af' }}>Motion to Dismiss"),

    # WIN SCORE label
    ("fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>WIN SCORE",
     "fontSize: 11, color: '#9ca3af', marginTop: 2 }}>WIN SCORE"),

    # Analysis item labels
    ("color: 'rgba(255,255,255,0.6)' }}>{item.label}",
     "color: '#374151' }}>{item.label}"),

    # Risk flag body text
    ("fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>• {f}",
     "fontSize: 12, color: '#374151' }}>• {f}"),

    # Pillars section heading
    ("fontSize: 40, color: '#fff', marginBottom: 16",
     "fontSize: 40, color: '#0a0f1e', marginBottom: 16"),
]

result = []
for i, line in enumerate(lines):
    lineno = i + 1  # 1-indexed

    # Line 165: outer wrapper
    if lineno == 165:
        line = line.replace(
            "background: '#050505', color: '#fff'",
            "background: '#FAF8F3', color: '#1a1a1a'"
        )
        result.append(line)
        continue

    if in_preserve_range(lineno):
        result.append(line)
        continue

    for old, new in REPLACEMENTS:
        line = line.replace(old, new)

    result.append(line)

with open('src/pages/Home.tsx', 'w', encoding='utf-8') as f:
    f.writelines(result)

print("Done! Home.tsx color scheme updated.")
