/**
 * QueenAvatar — Illustrated portrait of Queen, LitigationSpace's AI assistant.
 * Woman of color with long curly hair, gold crown. Used in chat bubbles and header.
 */
import { useId } from 'react'

interface Props {
  size?: number
  className?: string
}

export default function QueenAvatar({ size = 32, className = '' }: Props) {
  const uid = useId().replace(/:/g, '_')
  const bg       = `qa_bg_${uid}`
  const skin     = `qa_sk_${uid}`
  const crownG   = `qa_cr_${uid}`
  const gem      = `qa_gm_${uid}`
  const clip     = `qa_cl_${uid}`

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, borderRadius: '50%' }}
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
        <radialGradient id={bg} cx="50%" cy="35%" r="65%">
          <stop offset="0%"   stopColor="#0f1b30" />
          <stop offset="100%" stopColor="#06101c" />
        </radialGradient>
        <radialGradient id={skin} cx="42%" cy="32%" r="65%">
          <stop offset="0%"   stopColor="#D4956A" />
          <stop offset="55%"  stopColor="#C07840" />
          <stop offset="100%" stopColor="#A5622E" />
        </radialGradient>
        <linearGradient id={crownG} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#fff8c0" />
          <stop offset="28%"  stopColor="#ffd700" />
          <stop offset="62%"  stopColor="#F5A623" />
          <stop offset="100%" stopColor="#b07010" />
        </linearGradient>
        <linearGradient id={gem} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#ffffff" />
          <stop offset="45%"  stopColor="#ffe066" />
          <stop offset="100%" stopColor="#F5A623" />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${clip})`}>

        {/* ── Background ─────────────────────────────────────────────── */}
        <circle cx="50" cy="50" r="50" fill={`url(#${bg})`} />

        {/* ── HAIR — back layer (rendered before face) ────────────────── */}

        {/* Left hair mass — scalloped outer edge = visible curl loops */}
        <path
          d="
            M 50,30
            C 44,27 34,26 24,31
            C 16,36 10,44 9,53
            Q 7,60 10,67
            Q 13,74 10,81
            Q 8,88 13,93
            C 16,97 21,100 26,100
            L 16,100
            C 10,96 7,89 8,82
            Q 9,75 12,69
            Q 15,63 12,56
            Q 9,49 12,42
            C 16,34 25,27 36,26
            L 50,28 Z
          "
          fill="#170800"
        />
        {/* Left curl spirals hinting at texture */}
        <path d="M 28,34 C 20,40 17,50 20,58 Q 22,63 20,69 Q 18,76 20,82" stroke="#2e1002" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 22,42 C 16,50 15,60 18,70 Q 20,77 18,84" stroke="#2e1002" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Right hair mass — mirrored */}
        <path
          d="
            M 50,30
            C 56,27 66,26 76,31
            C 84,36 90,44 91,53
            Q 93,60 90,67
            Q 87,74 90,81
            Q 92,88 87,93
            C 84,97 79,100 74,100
            L 84,100
            C 90,96 93,89 92,82
            Q 91,75 88,69
            Q 85,63 88,56
            Q 91,49 88,42
            C 84,34 75,27 64,26
            L 50,28 Z
          "
          fill="#170800"
        />
        {/* Right curl texture */}
        <path d="M 72,34 C 80,40 83,50 80,58 Q 78,63 80,69 Q 82,76 80,82" stroke="#2e1002" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 78,42 C 84,50 85,60 82,70 Q 80,77 82,84" stroke="#2e1002" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Top-of-head hair dome */}
        <ellipse cx="50" cy="30" rx="20" ry="9" fill="#170800" />

        {/* ── FACE ───────────────────────────────────────────────────── */}

        {/* Ears */}
        <ellipse cx="32" cy="54" rx="3.5" ry="4.5" fill="#A5622E" />
        <ellipse cx="68" cy="54" rx="3.5" ry="4.5" fill="#A5622E" />
        <ellipse cx="32" cy="54" rx="2" ry="3" fill="#B87040" opacity="0.5" />
        <ellipse cx="68" cy="54" rx="2" ry="3" fill="#B87040" opacity="0.5" />

        {/* Face */}
        <ellipse cx="50" cy="53" rx="18" ry="21" fill={`url(#${skin})`} />

        {/* Jaw shadow */}
        <ellipse cx="50" cy="69" rx="14" ry="6" fill="rgba(0,0,0,0.10)" />

        {/* ── NECK & SHOULDERS ───────────────────────────────────────── */}

        {/* Neck */}
        <rect x="43" y="72" width="14" height="14" rx="4" fill="#C07840" />
        <rect x="43" y="72" width="14" height="3" rx="2" fill="rgba(0,0,0,0.08)" />

        {/* Clothing / shoulders */}
        <path d="M 0,100 L 0,84 C 8,82 22,80 32,83 C 37,85 41,88 43,88 L 43,100 Z" fill="#0d1e38" />
        <path d="M 100,100 L 100,84 C 92,82 78,80 68,83 C 63,85 59,88 57,88 L 57,100 Z" fill="#0d1e38" />
        <rect x="0" y="98" width="100" height="2" fill="#0d1e38" />

        {/* Neckline detail */}
        <path d="M 38,88 Q 50,92 62,88" stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none" />

        {/* Hair over shoulders (front of shoulders) */}
        <path d="M 26,80 Q 22,88 20,100 L 14,100 Q 16,88 22,78 Z" fill="#170800" />
        <path d="M 22,80 Q 18,89 17,100 L 12,100 Q 14,89 20,79 Z" fill="#1f0b00" />
        <path d="M 74,80 Q 78,88 80,100 L 86,100 Q 84,88 78,78 Z" fill="#170800" />
        <path d="M 78,80 Q 82,89 83,100 L 88,100 Q 86,89 80,79 Z" fill="#1f0b00" />

        {/* Shoulder-level curl spirals */}
        <path d="M 24,82 Q 18,86 20,92 Q 22,98 18,100" stroke="#2e1002" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 76,82 Q 82,86 80,92 Q 78,98 82,100" stroke="#2e1002" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* ── FACIAL FEATURES ────────────────────────────────────────── */}

        {/* Eyebrows */}
        <path d="M 36,43 Q 41,40 46,43" stroke="#1a0800" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M 54,43 Q 59,40 64,43" stroke="#1a0800" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Eye whites */}
        <ellipse cx="41" cy="48" rx="5" ry="3.2" fill="#F0E6D6" />
        <ellipse cx="59" cy="48" rx="5" ry="3.2" fill="#F0E6D6" />

        {/* Irises */}
        <circle cx="42" cy="48" r="2.8" fill="#2c1500" />
        <circle cx="60" cy="48" r="2.8" fill="#2c1500" />

        {/* Pupils */}
        <circle cx="42" cy="48" r="1.6" fill="#0d0500" />
        <circle cx="60" cy="48" r="1.6" fill="#0d0500" />

        {/* Eye shine */}
        <circle cx="43.2" cy="46.8" r="1" fill="#fff" opacity="0.9" />
        <circle cx="61.2" cy="46.8" r="1" fill="#fff" opacity="0.9" />

        {/* Top eyelashes */}
        <path d="M 36,46 Q 41,43.5 46,46" stroke="#1a0800" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M 54,46 Q 59,43.5 64,46" stroke="#1a0800" strokeWidth="1.4" fill="none" strokeLinecap="round" />

        {/* Bottom eyelash shadow */}
        <path d="M 37.5,50 Q 41,51.5 44.5,50" stroke="#1a0800" strokeWidth="0.8" fill="none" strokeLinecap="round" opacity="0.5" />
        <path d="M 55.5,50 Q 59,51.5 62.5,50" stroke="#1a0800" strokeWidth="0.8" fill="none" strokeLinecap="round" opacity="0.5" />

        {/* Nose */}
        <path d="M 47,57 Q 50,61 53,57" stroke="#9B5E28" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <ellipse cx="47.5" cy="58.5" rx="1.5" ry="1" fill="#9B5E28" opacity="0.35" />
        <ellipse cx="52.5" cy="58.5" rx="1.5" ry="1" fill="#9B5E28" opacity="0.35" />

        {/* Lips — lower */}
        <path d="M 43,64 Q 50,69.5 57,64" fill="#8B3030" />
        {/* Lips — upper */}
        <path d="M 43,64 Q 46.5,61 50,62.5 Q 53.5,61 57,64" fill="#B03838" />
        {/* Lip center line */}
        <path d="M 43,64 Q 50,65 57,64" stroke="#7a2828" strokeWidth="0.6" fill="none" />
        {/* Lip highlight */}
        <ellipse cx="50" cy="65.5" rx="4" ry="1.2" fill="rgba(255,200,180,0.18)" />

        {/* Cheek blush */}
        <ellipse cx="35" cy="57" rx="5.5" ry="3" fill="rgba(195,80,60,0.13)" />
        <ellipse cx="65" cy="57" rx="5.5" ry="3" fill="rgba(195,80,60,0.13)" />

        {/* ── CROWN ──────────────────────────────────────────────────── */}

        {/* Left spike */}
        <polygon points="36,6 31,24 42,24" fill={`url(#${crownG})`} />
        {/* Center spike — tallest */}
        <polygon points="50,2 44,24 56,24" fill={`url(#${crownG})`} />
        {/* Right spike */}
        <polygon points="64,6 58,24 69,24" fill={`url(#${crownG})`} />

        {/* Crown band */}
        <rect x="29" y="22" width="42" height="10" rx="2.5" fill={`url(#${crownG})`} />

        {/* Band top sheen */}
        <rect x="29" y="22" width="42" height="2.5" rx="1.2" fill="rgba(255,255,255,0.28)" />

        {/* Center gem (diamond) */}
        <polygon points="50,5 53,11 50,17 47,11" fill={`url(#${gem})`} />
        <polygon points="50,5 53,11 50,17 47,11" fill="rgba(255,255,255,0.22)" />

        {/* Left gem */}
        <circle cx="36.5" cy="9.5" r="2.4" fill={`url(#${gem})`} />
        <circle cx="36.5" cy="8.8" r="1" fill="rgba(255,255,255,0.55)" />

        {/* Right gem */}
        <circle cx="63.5" cy="9.5" r="2.4" fill={`url(#${gem})`} />
        <circle cx="63.5" cy="8.8" r="1" fill="rgba(255,255,255,0.55)" />

        {/* Crown band rivets */}
        <circle cx="37" cy="27" r="1.3" fill="rgba(255,255,255,0.38)" />
        <circle cx="50" cy="27" r="1.3" fill="rgba(255,255,255,0.38)" />
        <circle cx="63" cy="27" r="1.3" fill="rgba(255,255,255,0.38)" />

        {/* ── HAIR FRONT — curl strands framing face ──────────────────── */}

        {/* Left face-framing curl */}
        <path d="M 32,33 C 24,40 21,50 24,59 Q 26,64 23,71 Q 21,77 23,84" stroke="#170800" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M 35,33 C 28,40 25,51 27,61 Q 28,67 26,74" stroke="#170800" strokeWidth="2.5" fill="none" strokeLinecap="round" />

        {/* Right face-framing curl */}
        <path d="M 68,33 C 76,40 79,50 76,59 Q 74,64 77,71 Q 79,77 77,84" stroke="#170800" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M 65,33 C 72,40 75,51 73,61 Q 72,67 74,74" stroke="#170800" strokeWidth="2.5" fill="none" strokeLinecap="round" />

        {/* ── Outer ring glow ──────────────────────────────────────────── */}
        <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(245,166,35,0.18)" strokeWidth="1" />

      </g>
    </svg>
  )
}
