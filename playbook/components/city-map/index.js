const { getCity } = require('../../services/city-data.js')
const { projectLocal, toScreen, zoomAt, fit, layoutLabels } = require('./geometry.js')

function trace(ctx, points, close) {
  ctx.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y)
  if (close) ctx.closePath()
}

function drawRoute(ctx, markers) {
  if (markers.length < 2) return
  ctx.save()
  ctx.strokeStyle = '#161616'
  ctx.fillStyle = '#161616'
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.setLineDash([7, 5])
  ctx.beginPath()
  trace(ctx, markers, false)
  ctx.stroke()
  ctx.setLineDash([])
  for (let index = 1; index < markers.length; index++) {
    const from = markers[index - 1]
    const to = markers[index]
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    if (distance < 32) continue
    const dx = (to.x - from.x) / distance
    const dy = (to.y - from.y) / distance
    const x = (to.x + from.x) / 2
    const y = (to.y + from.y) / 2
    ctx.beginPath()
    ctx.moveTo(x + 6 * dx, y + 6 * dy)
    ctx.lineTo(x - 5 * dx + 4 * dy, y - 5 * dy - 4 * dx)
    ctx.lineTo(x - 5 * dx - 4 * dy, y - 5 * dy + 4 * dx)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawMarker(ctx, marker) {
  ctx.save()
  ctx.fillStyle = '#161616'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  const size = marker.number ? 12 : marker.selected ? 9 : 7
  ctx.beginPath()
  if (marker.category === 'play' && !marker.number) {
    ctx.rect(marker.x - size, marker.y - size, size * 2, size * 2)
  } else {
    ctx.arc(marker.x, marker.y, size, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.stroke()
  if (marker.number) {
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '700 12px sans-serif'
    ctx.fillText(String(marker.number), marker.x, marker.y + 0.5)
  }
  ctx.restore()
}

function drawLabel(ctx, label) {
  const { left, top, width, selected, title } = label
  ctx.fillStyle = selected ? '#161616' : '#fff'
  ctx.fillRect(left, top, width, 26)
  ctx.strokeStyle = selected ? '#161616' : '#b5b5b5'
  ctx.lineWidth = 1
  ctx.strokeRect(left + 0.5, top + 0.5, width - 1, 25)
  ctx.fillStyle = selected ? '#fff' : '#161616'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, left + width / 2, top + 13, width - 12)
}

Component({
  properties: {
    cityId: { type: String, value: '440900', observer: 'updateCity' },
    points: { type: Array, value: [] },
    route: { type: Object, value: null },
    selectedKey: { type: String, value: '' },
    blocked: { type: Boolean, value: false, observer: 'redraw' },
    showPreview: { type: Boolean, value: false }
  },
  data: { error: '', previewPath: '' },
  observers: {
    'points, route, selectedKey': function () { this.redraw() },
    'showPreview, route, selectedKey': function (showPreview) {
      if (showPreview) this.capturePreview()
      else if (this.data.previewPath) this.setData({ previewPath: '' })
    }
  },
  lifetimes: {
    ready() { this.measure() },
    detached() {
      if (this.frame != null) {
        if (this.hasAnimationFrame) this.canvas.cancelAnimationFrame(this.frame)
        else clearTimeout(this.frame)
      }
    }
  },
  pageLifetimes: { resize() { this.measure() } },
  methods: {
    measure() {
      this.createSelectorQuery().select('#city-map').fields({ node: true, size: true, rect: true }, result => {
        if (!result || !result.node || !result.width || !result.height) {
          this.setData({ error: '地图画布无法初始化' })
          return
        }
        this.canvas = result.node
        this.context = this.canvas.getContext('2d')
        if (!this.context) {
          this.setData({ error: '地图画布无法初始化' })
          return
        }
        this.width = result.width
        this.height = result.height
        this.left = result.left || 0
        this.top = result.top || 0
        const dpr = Math.min(wx.getWindowInfo().pixelRatio || 1, 1365 / this.width, 1365 / this.height)
        this.canvas.width = Math.round(this.width * dpr)
        this.canvas.height = Math.round(this.height * dpr)
        this.context.scale(dpr, dpr)
        this.setData({ error: '' })
        this.updateCity()
        if (this.properties.route) this.fitRoute(this.properties.route)
      }).exec()
    },
    updateCity() {
      if (!this.context) return
      const city = getCity(this.properties.cityId)
      if (!city) return
      this.center = city.center
      this.districts = city.boundaries.map(district => ({
        name: district.name,
        label: this.local(district.label),
        polygons: district.polygons.map(polygon => polygon.map(ring => ring.map(coordinate => this.local(coordinate))))
      }))
      const [west, south, east, north] = city.bounds
      this.homeView = fit([this.local([west, north]), this.local([east, south])], this.width, this.height,
        { left: 30, right: 34, top: 24, bottom: 28 })
      this.resetView()
    },
    local(coordinate) { return projectLocal(coordinate, this.center) },
    screen(point) { return toScreen(point, this.view) },
    resetView() {
      if (!this.homeView) return
      this.view = { ...this.homeView }
      this.redraw()
    },
    fitRoute(route) {
      if (!this.homeView || !route || !route.stops.length) return
      this.view = fit(route.stops.map(stop => this.local(stop.coordinate)), this.width, this.height,
        { left: 64, right: 64, top: 42, bottom: 54 }, this.homeView.scale * 4)
      this.redraw()
    },
    focusCoordinate(coordinate) {
      if (!this.homeView) return
      const point = this.local(coordinate)
      const scale = Math.max(this.view.scale, this.homeView.scale * 1.75)
      this.view = { x: this.width / 2 - point.x * scale, y: this.height * 0.48 - point.y * scale, scale }
      this.redraw()
    },
    changeZoom(factor, anchor = { x: this.width / 2, y: this.height / 2 }) {
      if (!this.homeView) return
      const scale = Math.min(this.homeView.scale * 14, Math.max(this.homeView.scale * 0.75, this.view.scale * factor))
      this.view = zoomAt(this.view, anchor, scale)
      this.redraw()
    },
    wheelZoom(event) {
      const { deltaY, deltaMode } = event.detail || {}
      if (this.properties.blocked || !Number.isFinite(deltaY) || deltaY === 0) return

      let pixels = deltaY
      if (deltaMode === 1) pixels *= 16
      if (deltaMode === 2) pixels *= this.height
      const factor = Math.exp(Math.max(-0.35, Math.min(0.35, -pixels * 0.002)))
      const pointer = event.touches?.[0]
      const anchor = pointer && this.localTouch(pointer)
      this.changeZoom(factor, Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y) ? anchor : undefined)
    },
    markers() {
      const { route, points, selectedKey } = this.properties
      const entries = route ? route.stops : points
      return entries.map((entry, index) => {
        const key = route ? `stop-${index}` : entry.id
        return { ...this.screen(this.local(entry.coordinate)), key, title: entry.name, category: entry.category,
          selected: key === selectedKey, number: route ? index + 1 : 0 }
      })
    },
    redraw() {
      if (!this.view || this.frame != null) return
      const draw = () => {
        this.frame = null
        this.draw()
      }
      this.hasAnimationFrame = typeof this.canvas.requestAnimationFrame === 'function'
      this.frame = this.hasAnimationFrame ? this.canvas.requestAnimationFrame(draw) : setTimeout(draw, 16)
    },
    capturePreview() {
      if (!this.view) return
      // A regular image can sit behind the sheet when the native canvas is hidden.
      const capture = {}
      this.previewCapture = capture
      this.draw()
      wx.canvasToTempFilePath({
        canvas: this.canvas,
        destWidth: this.canvas.width,
        destHeight: this.canvas.height,
        success: ({ tempFilePath }) => {
          if (this.properties.showPreview && this.previewCapture === capture) {
            this.setData({ previewPath: tempFilePath })
          }
        }
      })
    },
    draw() {
      const ctx = this.context
      const { width, height } = this
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#dedede'
      for (let x = 14; x < width; x += 22) {
        for (let y = 14; y < height; y += 22) ctx.fillRect(x, y, 1, 1)
      }
      const fills = ['#eaeaea', '#f3f3f3', '#ededed', '#f5f5f5', '#f0f0f0']
      this.districts.forEach((district, index) => {
        ctx.strokeStyle = '#9a9a9a'
        ctx.fillStyle = fills[index % fills.length]
        ctx.lineWidth = 1
        for (const polygon of district.polygons) {
          ctx.beginPath()
          for (const ring of polygon) trace(ctx, ring.map(point => this.screen(point)), true)
          ctx.fill()
          ctx.stroke()
        }
        const label = this.screen(district.label)
        ctx.fillStyle = '#686868'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = '12px sans-serif'
        ctx.fillText(district.name, label.x, label.y)
      })
      const markers = this.markers()
      if (this.properties.route) drawRoute(ctx, markers)
      markers.forEach(marker => drawMarker(ctx, marker))
      this.labels = this.moved ? [] : layoutLabels(ctx, markers, width, height)
      this.labels.forEach(label => drawLabel(ctx, label))
    },
    localTouch(touch) {
      return {
        x: Number.isFinite(touch.x) ? touch.x : (touch.clientX ?? touch.pageX) - this.left,
        y: Number.isFinite(touch.y) ? touch.y : (touch.clientY ?? touch.pageY) - this.top
      }
    },
    gesture(touches) {
      const first = this.localTouch(touches[0])
      if (touches.length === 1) return { ...first, distance: 0 }
      const second = this.localTouch(touches[1])
      return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2,
        distance: Math.hypot(first.x - second.x, first.y - second.y) }
    },
    touchStart(event) {
      if (this.properties.blocked || !this.view || !event.touches.length) return
      this.lastGesture = this.gesture(event.touches)
      if (event.touches.length > 1) this.moved = true
    },
    touchMove(event) {
      if (this.properties.blocked || !this.lastGesture || !event.touches.length) return
      const next = this.gesture(event.touches)
      const last = this.lastGesture
      const dx = next.x - last.x
      const dy = next.y - last.y
      if (!this.moved && !next.distance && Math.hypot(dx, dy) < 5) return
      this.moved = true
      if (last.distance && next.distance) this.changeZoom(next.distance / last.distance, last)
      this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy }
      this.lastGesture = next
      this.redraw()
    },
    touchEnd(event) {
      if (!this.lastGesture) return
      if (event.touches.length) {
        this.lastGesture = this.gesture(event.touches)
        return
      }
      if (!this.moved && !this.properties.blocked && event.changedTouches.length) {
        const point = this.localTouch(event.changedTouches[0])
        const label = (this.labels || []).find(item => point.x >= item.left && point.x <= item.left + item.width &&
          point.y >= item.top && point.y <= item.top + 26)
        if (label) this.choose(label.key)
        else {
          const ranked = this.markers().map(marker => ({ marker, distance: Math.hypot(marker.x - point.x, marker.y - point.y) }))
            .filter(item => item.distance <= 18).sort((left, right) => left.distance - right.distance)
          if (ranked.length) this.choose(ranked[0].marker.key)
        }
      }
      this.touchCancel()
    },
    touchCancel() {
      this.lastGesture = null
      this.moved = false
      this.redraw()
    },
    choose(key) {
      if (this.properties.route) this.triggerEvent('stoptap', { index: Number(key.slice(5)) })
      else this.triggerEvent('pointtap', { id: key })
    }
  }
})
