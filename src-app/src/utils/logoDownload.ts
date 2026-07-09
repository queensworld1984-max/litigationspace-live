export type LogoVariant = 'light' | 'dark'

export function drawLogo(canvas: HTMLCanvasElement, variant: LogoVariant) {
  const W = 520
  const H = 120
  const dpr = window.devicePixelRatio || 1
  canvas.width  = W * dpr
  canvas.height = H * dpr
  canvas.style.width  = `${W}px`
  canvas.style.height = `${H}px`

  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  const bg = variant === 'dark' ? '#0d1117' : '#ffffff'
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const boxX = 20, boxY = 20, boxSize = 80, boxR = 18
  const boxGrad = ctx.createLinearGradient(boxX, boxY, boxX + boxSize, boxY + boxSize)
  boxGrad.addColorStop(0,   '#fff8c0')
  boxGrad.addColorStop(0.2, '#ffd700')
  boxGrad.addColorStop(0.4, '#F5A623')
  boxGrad.addColorStop(0.6, '#b8760a')
  boxGrad.addColorStop(0.8, '#F5A623')
  boxGrad.addColorStop(1.0, '#ffd700')

  ctx.beginPath()
  ctx.moveTo(boxX + boxR, boxY)
  ctx.lineTo(boxX + boxSize - boxR, boxY)
  ctx.arcTo(boxX + boxSize, boxY,           boxX + boxSize, boxY + boxR,           boxR)
  ctx.lineTo(boxX + boxSize, boxY + boxSize - boxR)
  ctx.arcTo(boxX + boxSize, boxY + boxSize, boxX + boxSize - boxR, boxY + boxSize, boxR)
  ctx.lineTo(boxX + boxR, boxY + boxSize)
  ctx.arcTo(boxX, boxY + boxSize, boxX, boxY + boxSize - boxR,                     boxR)
  ctx.lineTo(boxX, boxY + boxR)
  ctx.arcTo(boxX, boxY, boxX + boxR, boxY,                                         boxR)
  ctx.closePath()

  ctx.shadowColor = 'rgba(245,166,35,0.5)'
  ctx.shadowBlur  = 12
  ctx.fillStyle   = boxGrad
  ctx.fill()
  ctx.shadowBlur  = 0

  ctx.font         = '900 28px Georgia, "Times New Roman", serif'
  ctx.fillStyle    = '#000000'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('LS', boxX + boxSize / 2, boxY + boxSize / 2)

  ctx.font         = '900 36px Georgia, "Times New Roman", serif'
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'middle'
  const wordX = boxX + boxSize + 16
  const wordY = H / 2

  ctx.fillStyle = variant === 'dark' ? '#ffffff' : '#000000'
  ctx.fillText('Litigation', wordX, wordY)

  const litigationW = ctx.measureText('Litigation').width
  const spaceX = wordX + litigationW
  const spaceGrad = ctx.createLinearGradient(spaceX, 0, spaceX + 140, 0)
  spaceGrad.addColorStop(0,    '#ffd700')
  spaceGrad.addColorStop(0.33, '#F5A623')
  spaceGrad.addColorStop(0.66, '#b8760a')
  spaceGrad.addColorStop(1.0,  '#ffd700')
  ctx.fillStyle = spaceGrad
  ctx.fillText('Space', spaceX, wordY)
}

export function downloadLogo(variant: LogoVariant, format: 'png' | 'jpg') {
  const canvas = document.createElement('canvas')
  drawLogo(canvas, variant)
  const mime    = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const quality = format === 'jpg' ? 0.95 : undefined
  const dataUrl = canvas.toDataURL(mime, quality)
  const a = document.createElement('a')
  a.href     = dataUrl
  a.download = `litigationspace-logo-${variant}.${format}`
  a.click()
}
