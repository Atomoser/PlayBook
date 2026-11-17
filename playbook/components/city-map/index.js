const { getCity, getProvinceCities } = require('../../services/city-data.js')
const { projectLocal, toScreen, zoomAt, fit, layoutLabels } = require('./geometry.js')

const mapPadding = { left: 30, right: 34, top: 24, bottom: 28 }
const districtFills = ['#eaeaea', '#f3f3f3', '#ededed', '#f5f5f5', '#f0f0f0']

function projectedBounds(rings) {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const ring of rings) {
    for (const { x, y } of ring) {
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return { left, top, right, bottom }
}

function intersects(bounds, viewport) {
  return bounds.left <= viewport.right && bounds.right >= viewport.left &&
    bounds.top <= viewport.bottom && bounds.bottom >= viewport.top
}

function projectProvince(provinceName) {
  const cities = getProvinceCities(provinceName)
  const west = Math.min(...cities.map(city => city.bounds[0]))
  const south = Math.min(...cities.map(city => city.bounds[1]))
  const east = Math.max(...cities.map(city => city.bounds[2]))
  const north = Math.max(...cities.map(city => city.bounds[3]))
  const center = [(west + east) / 2, (south + north) / 2]
  const project = coordinate => projectLocal(coordinate, center)
  const corners = [project([west, north]), project([east, south])]
  return {
    name: provinceName, center, corners,
    cities: cities.map(city => {
      const [west, south, east, north] = city.bounds
      const corners = [project([west, north]), project([east, south])]
      return {
        id: city.id,
        name: city.cityName,
        label: project(city.center),
        corners,
        bounds: projectedBounds([corners]),
        outline: city.outline.map(ring => ring.map(project)),
        districts: city.boundaries.map(district => ({
          name: district.name,
          label: project(district.label),
          polygons: district.polygons.map(polygon => {
            const rings = polygon.map(ring => ring.map(project))
            return { rings, bounds: projectedBounds(rings) }
          })
        }))
      }
    })
  }
}

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
      if (this.province?.name !== city.provinceName) this.province = projectProvince(city.provinceName)
      this.selectedCity = this.province.cities.find(item => item.id === city.id)
      this.provinceView = fit(this.province.corners, this.width, this.height, mapPadding)
      this.homeView = fit(this.selectedCity.corners, this.width, this.height, mapPadding)
      this.resetView()
    },
    local(coordinate) { return projectLocal(coordinate, this.province.center) },
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
      const minScale = this.provinceView.scale
      const scale = Math.min(this.homeView.scale * 14, Math.max(minScale, this.view.scale * factor))
      if (scale === this.view.scale) return
      this.view = scale === minScale ? { ...this.provinceView } : zoomAt(this.view, anchor, scale)
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
      this.drawProvince()
      const markers = this.markers()
      if (this.properties.route) drawRoute(ctx, markers)
      markers.forEach(marker => drawMarker(ctx, marker))
      this.labels = this.moved ? [] : layoutLabels(ctx, markers, width, height)
      this.labels.forEach(label => drawLabel(ctx, label))
    },
    drawProvince() {
      const { context: ctx, width, height, view } = this
      const { x, y, scale } = view
      const viewport = {
        left: (-x - 1) / scale, top: (-y - 1) / scale,
        right: (width - x + 1) / scale, bottom: (height - y + 1) / scale
      }
      const overview = scale < this.provinceView.scale * 2
      const labels = []
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(scale, scale)
      ctx.strokeStyle = overview ? '#b6b6b6' : '#9a9a9a'
      ctx.lineWidth = (overview ? 0.75 : 1) / scale
      this.province.cities.forEach((city, cityIndex) => {
        if (!intersects(city.bounds, viewport)) return
        if (overview) labels.push(city)
        city.districts.forEach((district, districtIndex) => {
          ctx.fillStyle = districtFills[(overview ? cityIndex : districtIndex) % districtFills.length]
          for (const polygon of district.polygons) {
            if (!intersects(polygon.bounds, viewport)) continue
            ctx.beginPath()
            for (const ring of polygon.rings) trace(ctx, ring, true)
            ctx.fill()
            ctx.stroke()
          }
          if (!overview) labels.push(district)
        })
      })
      ctx.strokeStyle = '#1c1c1e'
      ctx.lineWidth = 2.5 / scale
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (const ring of this.selectedCity.outline) trace(ctx, ring, true)
      ctx.stroke()
      ctx.restore()

      ctx.fillStyle = '#686868'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = overview ? '11px sans-serif' : '12px sans-serif'
      for (const { name, label } of labels) {
        const point = this.screen(label)
        if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue
        ctx.fillText(name, point.x, point.y)
      }
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
