const { getCity, ensureCityDetails, getCountryBase, ensureCountryBase } = require('../../services/city-data.js')
const catalogue = require('../../data/national/catalogue.js')
const { decodePolygons } = require('../../services/map-geometry.js')
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

function projectPolygons(polygons, project) {
  return polygons.map(polygon => {
    const rings = polygon.map(ring => ring.map(project))
    return { rings, bounds: projectedBounds(rings) }
  })
}

function projectCountry(national) {
  const center = [105, 35]
  const project = coordinate => projectLocal(coordinate, center)
  const provinces = (national?.provinces || []).map(province => ({
    id: province.id, name: province.name, label: project(province.label),
    polygons: projectPolygons(decodePolygons(province.polygons), project)
  }))
  const [west, south, east, north] = catalogue.bounds
  const bases = national?.cities || catalogue.cities.map(city => ({ id: city.id, polygons: [] }))
  return {
    center,
    corners: [project([west, north]), project([east, south])],
    provinces,
    borders: projectPolygons(decodePolygons(national?.borders || []), project),
    cities: bases.map(base => {
      const city = getCity(base.id)
      const [west, south, east, north] = city.bounds
      const corners = [project([west, north]), project([east, south])]
      const polygons = projectPolygons(decodePolygons(base.polygons), project)
      return {
        id: city.id, name: city.cityName, provinceId: city.provinceId,
        label: project(city.center), corners, polygons,
        bounds: projectedBounds([corners]),
        outline: polygons.map(polygon => polygon.rings[0])
      }
    })
  }
}

function projectCityDetails(city, center) {
  const project = coordinate => projectLocal(coordinate, center)
  const vertices = []
  const districts = city.boundaries.map(district => ({
    name: district.name, label: project(district.label),
    polygons: district.polygons.map(polygon => {
      const rings = polygon.map(ring => ring.map(coordinate => {
        const point = project(coordinate)
        vertices.push(point)
        return point
      }))
      return { rings, bounds: projectedBounds(rings) }
    })
  }))
  for (const coordinate of city.outline.extra) vertices.push(project(coordinate))
  return { districts, outline: city.outline.rings.map(ring => ring.map(index => vertices[index])) }
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
  data: { error: '', previewPath: '', loading: false, loadError: '' },
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
      this.disposed = true
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
      const base = getCountryBase()
      if (!this.country || this.countrySource !== base) {
        this.country = projectCountry(base)
        this.countrySource = base
      }
      if (!this.detailCache) {
        this.detailCache = new Map()
        this.pendingCities = new Set()
        this.failedCities = new Set()
      }
      this.selectedCity = this.country.cities.find(item => item.id === city.id)
      this.countryView = fit(this.country.corners, this.width, this.height, mapPadding)
      this.homeView = fit(this.selectedCity.corners, this.width, this.height, mapPadding)
      this.failedCities.delete(city.id)
      this.syncLoadStatus()
      this.resetView()
      this.requestDetails(this.selectedCity)
      this.requestCountry()
    },
    local(coordinate) { return projectLocal(coordinate, this.country.center) },
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
      const minScale = this.countryView.scale
      const scale = Math.min(this.homeView.scale * 14, Math.max(minScale, this.view.scale * factor))
      if (scale === this.view.scale) return
      this.view = scale === minScale ? { ...this.countryView } : zoomAt(this.view, anchor, scale)
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
      this.drawCountry()
      const markers = this.markers()
      if (this.properties.route) drawRoute(ctx, markers)
      markers.forEach(marker => drawMarker(ctx, marker))
      this.labels = this.moved ? [] : layoutLabels(ctx, markers, width, height)
      this.labels.forEach(label => drawLabel(ctx, label))
    },
    detailedCity(city) {
      const raw = getCity(city.id)
      if (!raw.boundaries.length) return null
      if (!this.detailCache.has(city.id)) {
        if (this.detailCache.size >= 48) this.detailCache.delete(this.detailCache.keys().next().value)
        this.detailCache.set(city.id, projectCityDetails(raw, this.country.center))
      }
      return this.detailCache.get(city.id)
    },
    syncLoadStatus() {
      const missingBase = !getCountryBase()
      const missingCity = !getCity(this.properties.cityId).boundaries.length
      let loadError = ''
      if (missingBase && this.baseLoadFailed) loadError = '全国地图加载失败，点击重试'
      else if (missingCity && this.failedCities.has(this.properties.cityId)) loadError = '详细边界加载失败，点击重试'
      this.setData({ loading: !loadError && (missingBase || missingCity), loadError })
    },
    requestCountry() {
      if (getCountryBase() || this.loadingCountry || this.baseLoadFailed) return
      this.loadingCountry = true
      ensureCountryBase().then(() => {
        if (this.disposed) return
        this.loadingCountry = false
        const view = this.view
        this.updateCity()
        this.view = view
        this.redraw()
        if (this.properties.showPreview) this.capturePreview()
      }).catch(() => {
        if (this.disposed) return
        this.loadingCountry = false
        this.baseLoadFailed = true
        this.syncLoadStatus()
      })
    },
    requestDetails(city) {
      if (getCity(city.id).boundaries.length || this.pendingCities.has(city.id) || this.failedCities.has(city.id)) return
      this.pendingCities.add(city.id)
      ensureCityDetails(city.id).then(() => {
        if (this.disposed) return
        this.pendingCities.delete(city.id)
        this.syncLoadStatus()
        this.redraw()
        if (this.properties.showPreview) this.capturePreview()
      }).catch(() => {
        if (this.disposed) return
        this.pendingCities.delete(city.id)
        this.failedCities.add(city.id)
        this.syncLoadStatus()
      })
    },
    retryDetails() {
      this.failedCities.clear()
      this.baseLoadFailed = false
      this.syncLoadStatus()
      this.requestCountry()
      this.requestDetails(this.selectedCity)
      this.redraw()
    },
    drawPolygons(polygons, viewport) {
      const ctx = this.context
      for (const polygon of polygons) {
        if (!intersects(polygon.bounds, viewport)) continue
        ctx.beginPath()
        for (const ring of polygon.rings) trace(ctx, ring, true)
        ctx.fill()
        ctx.stroke()
      }
    },
    drawCountry() {
      const { context: ctx, width, height, view } = this
      const { x, y, scale } = view
      const viewport = {
        left: (-x - 1) / scale, top: (-y - 1) / scale,
        right: (width - x + 1) / scale, bottom: (height - y + 1) / scale
      }
      const overview = scale < this.countryView.scale * 2.5
      const labels = []
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(scale, scale)
      ctx.strokeStyle = overview ? '#b6b6b6' : '#9a9a9a'
      ctx.lineWidth = (overview ? 0.75 : 1) / scale
      if (overview) {
        this.country.provinces.forEach((province, index) => {
          ctx.fillStyle = districtFills[index % districtFills.length]
          this.drawPolygons(province.polygons, viewport)
          labels.push(province)
        })
        for (const polygon of this.country.borders) {
          ctx.beginPath()
          for (const ring of polygon.rings) trace(ctx, ring, true)
          ctx.stroke()
        }
      } else {
        this.country.cities.forEach((city, cityIndex) => {
          if (!intersects(city.bounds, viewport)) return
          const size = Math.max(city.bounds.right - city.bounds.left, city.bounds.bottom - city.bounds.top) * scale
          if (size >= 120 || city.id === this.properties.cityId) this.requestDetails(city)
          const details = size >= 120 ? this.detailedCity(city) : null
          if (details) {
            details.districts.forEach((district, index) => {
              ctx.fillStyle = districtFills[index % districtFills.length]
              this.drawPolygons(district.polygons, viewport)
              labels.push(district)
            })
          } else {
            ctx.fillStyle = districtFills[cityIndex % districtFills.length]
            this.drawPolygons(city.polygons, viewport)
            if (size >= 35) labels.push(city)
          }
        })
      }
      const selected = this.detailedCity(this.selectedCity)
      const selectedSize = Math.max(this.selectedCity.bounds.right - this.selectedCity.bounds.left,
        this.selectedCity.bounds.bottom - this.selectedCity.bounds.top) * scale
      const outline = !overview && selectedSize >= 120 && selected ? selected.outline : this.selectedCity.outline
      ctx.strokeStyle = '#1c1c1e'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      for (const ring of outline) trace(ctx, ring, true)
      ctx.stroke()
      ctx.restore()

      ctx.fillStyle = '#686868'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = overview ? '11px sans-serif' : '12px sans-serif'
      const occupied = []
      for (const { name, label } of labels) {
        const point = this.screen(label)
        const halfWidth = ctx.measureText(name).width / 2
        const box = { left: point.x - halfWidth - 3, right: point.x + halfWidth + 3,
          top: point.y - 9, bottom: point.y + 9 }
        if (box.left < 0 || box.right > width || box.top < 0 || box.bottom > height ||
            occupied.some(other => intersects(box, other))) continue
        occupied.push(box)
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
