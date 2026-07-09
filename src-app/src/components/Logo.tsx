/**
 * Logo — Gold LS box + "Litigation" + "Space" wordmark
 *
 * Sizes:
 *   sm  — 28px box, 16px text  (footer, small placements)
 *   md  — 36px box, 18px text  (sidebar)
 *   nav — 38px box, 21px text  (top navbar)
 *   lg  — 64px box, 26px text  (auth pages centered)
 *
 * litigationColor: '#000000' on light backgrounds, '#ffffff' on dark
 */

interface LogoProps {
  size?: 'sm' | 'md' | 'nav' | 'lg' | 'xl'
  /** Color of the "Litigation" text. Defaults to '#000000'. */
  litigationColor?: string
  /** Devin compat: lightBg=true → dark text, lightBg=false → white text */
  lightBg?: boolean
  className?: string
}

const SIZES = {
  sm:  { box: 28, radius: 7,  lsSize: 11, lsSpacing: '-0.5px', wordSize: 16, gap: 8  },
  md:  { box: 36, radius: 8,  lsSize: 13, lsSpacing: '-0.5px', wordSize: 18, gap: 9  },
  nav: { box: 38, radius: 8,  lsSize: 14, lsSpacing: '-1px',   wordSize: 21, gap: 9  },
  lg:  { box: 64, radius: 14, lsSize: 24, lsSpacing: '-1px',   wordSize: 26, gap: 12 },
  xl:  { box: 80, radius: 18, lsSize: 30, lsSpacing: '-1px',   wordSize: 32, gap: 14 },
}

const GOLD_BOX = 'linear-gradient(135deg, #fff8c0, #ffd700, #F5A623, #b8760a, #F5A623, #ffd700)'
const GOLD_TEXT = 'linear-gradient(135deg, #ffd700, #F5A623, #b8760a, #F5A623, #ffd700)'

/** Standalone gold LS box icon — used in chat bubbles and small placements */
export function LSBox({ size = 'sm', className = '' }: { size?: 'sm' | 'md' | 'nav' | 'lg'; className?: string }) {
  const s = SIZES[size]
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: s.box, height: s.box, borderRadius: s.radius, flexShrink: 0, background: GOLD_BOX, boxShadow: '0 2px 8px rgba(245,166,35,0.45)' }}>
      <span style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 900, fontSize: s.lsSize, color: '#000000', letterSpacing: s.lsSpacing, lineHeight: 1 }}>LS</span>
    </span>
  )
}

export default function Logo({
  size = 'nav',
  litigationColor,
  lightBg,
  className = '',
}: LogoProps) {
  const textColor = litigationColor ?? (lightBg === false ? '#ffffff' : '#000000')
  const s = SIZES[size]

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: s.gap,
        lineHeight: 1,
        textDecoration: 'none',
        userSelect: 'none',
      }}
    >
      {/* Gold LS box */}
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: s.box,
          height: s.box,
          borderRadius: s.radius,
          flexShrink: 0,
          background: GOLD_BOX,
          boxShadow: '0 2px 8px rgba(245,166,35,0.45)',
        }}
      >
        <span
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 900,
            fontSize: s.lsSize,
            color: '#000000',
            letterSpacing: s.lsSpacing,
            lineHeight: 1,
          }}
        >
          LS
        </span>
      </span>

      {/* Wordmark */}
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 0 }}>
        <span
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 900,
            fontSize: s.wordSize,
            color: textColor,
            letterSpacing: '-0.3px',
            lineHeight: 1,
          }}
        >
          Litigation
        </span>
        <span
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 900,
            fontSize: s.wordSize,
            background: GOLD_TEXT,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.3px',
            lineHeight: 1,
          }}
        >
          Space
        </span>
      </span>
    </span>
  )
}
