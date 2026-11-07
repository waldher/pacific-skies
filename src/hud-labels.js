// Keep optional call signs attached to visible wingmen. Use the original
// below-aircraft slot first, flip vertically when it is blocked, or omit.
export function wingLabelBaseline(x, y, metrics, view, panels) {
  const margin = 3;
  if (x < 0 || x >= view.W || y < 0 || y >= view.H) return null;
  for (const panel of panels) {
    if (panel && x >= panel.x && x < panel.x + panel.w &&
        y >= panel.y && y < panel.y + panel.h) return null;
  }
  const halfWidth = Math.max(metrics.width / 2,
    metrics.actualBoundingBoxLeft ?? 0, metrics.actualBoundingBoxRight ?? 0) + margin;
  const left = x - halfWidth, right = x + halfWidth;
  if (left < 0 || right > view.W) return null;
  for (const baseline of [y + 30, y - 30]) {
    const top = baseline - (metrics.actualBoundingBoxAscent ?? 9) - margin;
    const bottom = baseline + (metrics.actualBoundingBoxDescent ?? 3) + margin;
    if (top < 0 || bottom > view.H) continue;
    if (!panels.some(panel => panel && left < panel.x + panel.w && right > panel.x &&
        top < panel.y + panel.h && bottom > panel.y)) return baseline;
  }
  return null;
}
