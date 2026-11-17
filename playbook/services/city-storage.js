const schemaVersion = 1
const emptyState = () => ({ schemaVersion, routes: [], activeRouteId: null })
const storageKey = cityId => `eat-play-map:city:${cityId}`

function validateRoute(route, cityId) {
  if (!route || route.cityId !== cityId || typeof route.id !== 'string' || !route.id ||
      typeof route.name !== 'string' || !route.name.trim() || !Array.isArray(route.stops) || route.stops.length < 2) {
    throw new Error('路线需要名称和至少两个地点')
  }
  const pointIds = new Set()
  for (const stop of route.stops) {
    if (!stop || typeof stop.pointId !== 'string' || !stop.pointId || pointIds.has(stop.pointId) ||
        typeof stop.name !== 'string' || !stop.name.trim() || !['eat', 'play'].includes(stop.category) ||
        !Array.isArray(stop.coordinate) || stop.coordinate.length !== 2 || !stop.coordinate.every(Number.isFinite)) {
      throw new Error('路线站点格式有误')
    }
    pointIds.add(stop.pointId)
  }
}

function readCityState(cityId) {
  const state = wx.getStorageSync(storageKey(cityId))
  if (state === '' || state == null) return emptyState()
  if (state.schemaVersion !== schemaVersion || !Array.isArray(state.routes) ||
      (state.activeRouteId != null && typeof state.activeRouteId !== 'string')) {
    throw new Error('路线数据版本或格式无法读取')
  }
  const ids = new Set()
  for (const route of state.routes) {
    validateRoute(route, cityId)
    if (ids.has(route.id)) throw new Error('路线数据有重复编号')
    ids.add(route.id)
  }
  const activeRouteId = ids.has(state.activeRouteId) ? state.activeRouteId : (state.routes[0] || {}).id || null
  return { schemaVersion, routes: state.routes, activeRouteId }
}

function writeState(cityId, routes, activeRouteId) {
  const state = { schemaVersion, routes, activeRouteId }
  wx.setStorageSync(storageKey(cityId), state)
  return state
}

function saveRoute(cityId, draft) {
  const state = readCityState(cityId)
  const index = state.routes.findIndex(route => route.id === draft.id)
  if (draft.id && index < 0) throw new Error('该路线已被删除')
  let id = draft.id
  if (!id) {
    do {
      id = `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    } while (state.routes.some(route => route.id === id))
  }
  const route = { id, cityId, name: draft.name.trim(), stops: draft.stops }
  validateRoute(route, cityId)
  const routes = state.routes.slice()
  if (index < 0) routes.unshift(route)
  else routes[index] = route
  return writeState(cityId, routes, id)
}

function selectRoute(cityId, routeId) {
  const state = readCityState(cityId)
  if (!state.routes.some(route => route.id === routeId)) throw new Error('该路线已被删除')
  return writeState(cityId, state.routes, routeId)
}

function removeRoute(cityId, routeId) {
  const state = readCityState(cityId)
  const routes = state.routes.filter(route => route.id !== routeId)
  const activeRouteId = state.activeRouteId === routeId ? (routes[0] || {}).id || null : state.activeRouteId
  return writeState(cityId, routes, activeRouteId)
}

module.exports = { readCityState, saveRoute, selectRoute, removeRoute }
