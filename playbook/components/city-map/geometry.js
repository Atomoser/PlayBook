function projectLocal(coordinate, center) {
  return {
    x: (coordinate[0] - center[0]) * Math.cos(center[1] * Math.PI / 180),
    y: center[1] - coordinate[1]
  }
}

function toScreen(point, view) {
  return { x: view.x + point.x * view.scale, y: view.y + point.y * view.scale }
}

function zoomAt(view, anchor, scale) {
  const ratio = scale / view.scale
  return { x: anchor.x + (view.x - anchor.x) * ratio, y: anchor.y + (view.y - anchor.y) * ratio, scale }
}

function fit(points, width, height, padding, maxScale = Infinity) {
  const minX = Math.min(...points.map(point => point.x))
  const maxX = Math.max(...points.map(point => point.x))
  const minY = Math.min(...points.map(point => point.y))
  const maxY = Math.max(...points.map(point => point.y))
  const usableWidth = Math.max(32, width - padding.left - padding.right)
  const usableHeight = Math.max(32, height - padding.top - padding.bottom)
  const scale = Math.min(
    usableWidth / Math.max(0.0001, maxX - minX),
    usableHeight / Math.max(0.0001, maxY - minY), maxScale)
  return {
    x: padding.left + usableWidth / 2 - (minX + maxX) * scale / 2,
    y: padding.top + usableHeight / 2 - (minY + maxY) * scale / 2,
    scale
  }
}

function layoutLabels(ctx, markers, width, height) {
  const labels = []
  ctx.font = '650 12px sans-serif'
  const ordered = [...markers.filter(marker => marker.selected), ...markers.filter(marker => !marker.selected)]
  const visible = ordered.filter(marker => marker.x >= 7 && marker.y >= 7 && marker.x <= width - 7 && marker.y <= height - 7)
  for (const marker of visible) {
    const labelWidth = Math.min(144, Math.ceil(ctx.measureText(marker.title).width) + 16)
    const candidates = [
      [marker.x + 13, marker.y - 13],
      [marker.x - labelWidth - 13, marker.y - 13],
      [marker.x - labelWidth / 2, marker.y - 37],
      [marker.x - labelWidth / 2, marker.y + 13]
    ]
    for (const [left, top] of candidates) {
      const right = left + labelWidth
      const bottom = top + 26
      if (left < 6 || right > width - 6 || top < 6 || bottom > height - 6) continue
      if (labels.some(label => left < label.left + label.width + 4 && right + 4 > label.left &&
          top < label.top + 30 && bottom + 4 > label.top)) continue
      if (visible.some(other => left < other.x + 9 && right > other.x - 9 &&
          top < other.y + 9 && bottom > other.y - 9)) continue
      labels.push({ key: marker.key, title: marker.title, selected: marker.selected,
        left: Math.round(left), top: Math.round(top), width: labelWidth })
      break
    }
  }
  return labels
}

module.exports = { projectLocal, toScreen, zoomAt, fit, layoutLabels }
