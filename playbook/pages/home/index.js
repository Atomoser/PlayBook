const {
  getCity, getPoints, getFeedbackCity, searchFeedbackCities, createFeedback, openCities
} = require('../../services/city-data.js')
const { readCityState, saveRoute, selectRoute, removeRoute } = require('../../services/city-storage.js')

const defaultCityId = '440900'
const feedbackBatchSize = 70
const sheetTitles = {
  cities: '选择城市', points: '点位列表', detail: '地点详情', routes: '我的路线',
  stop: '路线站点', editor: '编辑路线', feedback: '反馈点位', 'feedback-cities': '选择城市'
}
const mapPreviewSheets = ['cities', 'points', 'detail', 'stop', 'routes', 'editor', 'feedback', 'feedback-cities']

function toast(title) { wx.showToast({ title, icon: 'none' }) }

Page({
  data: {
    statusBarHeight: 0, navigationHeight: 44, menuInset: 0,
    cityId: defaultCityId, cityName: '茂名', provinceName: '广东', openCities,
    mapCityQuery: '', mapCityMatches: openCities,
    activeTab: 'eat', mapPoints: [], mapRoute: null, route: null, routes: [], routeError: '',
    sheet: '', sheetTitle: '', keepMapVisible: false, detail: null, selectedKey: '', stopNumber: 0,
    routeDraft: null, routeChoices: [],
    feedbackDraft: null, feedbackCityName: '', feedbackCopied: false,
    feedbackQuery: '', feedbackMatches: [], feedbackHasMore: false
  },

  onLoad() {
    this.updateNavigationLayout()
    this.loadCity(defaultCityId)
  },

  onResize() { this.updateNavigationLayout() },

  onShareAppMessage() {
    return {
      title: '吃玩书',
      path: '/pages/home/index',
      imageUrl: '/assets/playbook-logo.png'
    }
  },

  updateNavigationLayout() {
    const { windowWidth, statusBarHeight = 0 } = wx.getWindowInfo()
    const menu = wx.getMenuButtonBoundingClientRect()
    const menuGap = menu.height && menu.top >= statusBarHeight ? menu.top - statusBarHeight : 0
    this.setData({
      statusBarHeight,
      navigationHeight: Math.max(44, menu.height + menuGap * 2),
      menuInset: menu.left > 0 ? Math.max(0, windowWidth - menu.left + 8) : 0
    })
  },

  loadCity(cityId) {
    const city = getCity(cityId)
    if (!city) return
    const { activeTab } = this.data
    const routeView = activeTab === 'book'
    let routes = []
    let route = null
    let routeError = ''
    try {
      const state = readCityState(cityId)
      routes = state.routes
      route = routes.find(item => item.id === state.activeRouteId) || null
    } catch (error) {
      routeError = '本地路线暂时无法读取'
    }
    this.showSheet('', { cityId, cityName: city.cityName, provinceName: city.provinceName,
      mapPoints: routeView ? [] : getPoints(cityId, activeTab), mapRoute: routeView ? route : null,
      route, routes, routeError, routeDraft: null, routeChoices: [], detail: null, selectedKey: '' })
  },

  showSheet(sheet, extra = {}) {
    this.setData({ sheet, sheetTitle: sheetTitles[sheet] || '', keepMapVisible: mapPreviewSheets.includes(sheet), ...extra })
  },
  closeSheet() {
    if (this.data.sheet === 'feedback-cities') this.showSheet('feedback')
    else this.showSheet('')
  },
  noop() {},
  tapMapCity() {
    if (this.data.openCities.length > 1) this.showSheet('cities', { mapCityQuery: '', mapCityMatches: openCities })
    else this.resetMapView()
  },
  searchMapCities(event) {
    const query = event.detail.value.trim()
    this.setData({ mapCityQuery: event.detail.value, mapCityMatches: openCities.filter(city =>
      (city.provinceName + city.fullName).includes(query)) })
  },
  changeMapCity(event) {
    const cityId = event.currentTarget.dataset.id
    if (cityId === this.data.cityId) this.resetMapView()
    else this.loadCity(cityId)
  },
  resetMapView() {
    this.showSheet('', { selectedKey: '' })
    this.map()?.resetView()
  },
  switchTab(event) { this.activateTab(event.currentTarget.dataset.tab) },
  activateTab(tab, forceFit = false) {
    const { cityId, route, activeTab } = this.data
    const routeView = tab === 'book'
    this.setData({ activeTab: tab, mapPoints: routeView ? [] : getPoints(cityId, tab),
      mapRoute: routeView ? route : null, sheet: '', sheetTitle: '', selectedKey: '' }, () => {
      if (routeView && route && (forceFit || activeTab !== 'book')) this.map().fitRoute(route)
    })
  },
  map() { return this.selectComponent('#map') },

  openPoints() { this.showSheet('points') },
  pointTap(event) { this.showPoint(event.detail.id) },
  pointFromList(event) { this.showPoint(event.currentTarget.dataset.id, true) },
  showPoint(id, focus = false) {
    const point = getCity(this.data.cityId).points.find(item => item.id === id)
    if (!point) return
    if (focus) this.map().focusCoordinate(point.coordinate)
    this.showSheet('detail', { detail: point, selectedKey: id })
  },
  stopTap(event) { this.showStop(event.detail.index) },
  stopFromList(event) { this.showStop(Number(event.currentTarget.dataset.index), true) },
  showStop(index, focus = false) {
    const stop = this.data.route?.stops[index]
    if (!stop) return
    const point = getCity(this.data.cityId).points.find(item => item.id === stop.pointId)
    if (focus) this.map().focusCoordinate(stop.coordinate)
    this.showSheet('stop', { detail: { ...point, ...stop }, selectedKey: `stop-${index}`, stopNumber: index + 1 })
  },

  openRoutes() {
    if (this.data.routeError) {
      this.loadStoredRoutes()
      if (this.data.routeError) return toast(this.data.routeError)
    }
    this.showSheet('routes')
  },
  loadStoredRoutes() {
    try {
      this.applyRoutes(readCityState(this.data.cityId))
    } catch (error) {
      this.setData({ routeError: '本地路线暂时无法读取' })
    }
  },
  applyRoutes(state) {
    const route = state.routes.find(item => item.id === state.activeRouteId) || null
    this.setData({ routes: state.routes, route, mapRoute: this.data.activeTab === 'book' ? route : null, routeError: '' })
  },
  openRouteOnMap(event) {
    const id = event.currentTarget.dataset.id
    try {
      this.applyRoutes(selectRoute(this.data.cityId, id))
      this.activateTab('book', true)
    } catch (error) { toast('打开路线失败，请重试') }
  },
  deleteRoute(event) {
    const id = event.currentTarget.dataset.id
    const cityId = this.data.cityId
    wx.showModal({ title: '删除路线', content: '确定删除这条本地路线？', confirmColor: '#161616', success: result => {
      if (!result.confirm || this.data.cityId !== cityId) return
      try {
        this.applyRoutes(removeRoute(cityId, id))
        if (this.data.routeDraft?.id === id) this.setData({ routeDraft: null, routeChoices: [] })
        const { route } = this.data
        if (route) this.map().fitRoute(route)
        else this.map().resetView()
      } catch (error) { toast('删除失败，请重试') }
    } })
  },
  newRoute() {
    if (this.data.routeError) return toast(this.data.routeError)
    const draft = this.data.routeDraft || { id: '', name: '', stops: [] }
    this.openEditor(draft)
  },
  editRoute(event) {
    const route = this.data.routes.find(item => item.id === event.currentTarget.dataset.id)
    if (!route) return
    const draft = this.data.routeDraft
    if (draft && draft.id !== route.id) {
      wx.showModal({ title: '切换编辑路线', content: '切换后会放弃当前未保存的编辑。', confirmColor: '#161616',
        success: result => { if (result.confirm) this.openEditor({ ...route, stops: route.stops.slice() }) } })
      return
    }
    this.openEditor(draft || { ...route, stops: route.stops.slice() })
  },
  draftChoices(draft) {
    const selected = new Set(draft.stops.map(stop => stop.pointId))
    return getCity(this.data.cityId).points.map(point => ({ id: point.id, name: point.name,
      category: point.category, added: selected.has(point.id) }))
  },
  openEditor(draft) {
    this.showSheet('editor', { routeDraft: draft, routeChoices: this.draftChoices(draft),
      sheetTitle: draft.id ? '编辑路线' : '新建路线' })
  },
  resumeEditor() { if (this.data.routeDraft) this.openEditor(this.data.routeDraft) },
  browseMapForStops() {
    this.activateTab(this.data.activeTab === 'book' ? 'eat' : this.data.activeTab)
  },
  updateDraftName(event) { this.setData({ 'routeDraft.name': event.detail.name }) },
  copyDetailAddress() {
    const address = this.data.detail?.address?.trim()
    if (!address) return toast('该地点暂无详细地址')
    wx.setClipboardData({ data: address, fail: () => toast('复制失败，请重试') })
  },
  addDetailToRoute() {
    const point = this.data.detail
    if (point) this.addStop(point.id, true)
  },
  addEditorStop(event) { this.addStop(event.detail.id, false) },
  addStop(id, openEditor) {
    if (this.data.routeError) return toast(this.data.routeError)
    const point = getCity(this.data.cityId).points.find(item => item.id === id)
    if (!point) return
    const draft = this.data.routeDraft || { id: '', name: '', stops: [] }
    if (draft.stops.some(item => item.pointId === point.id)) {
      if (openEditor) this.openEditor(draft)
      return
    }
    const { name, category, coordinate } = point
    const next = { ...draft, stops: [...draft.stops, { pointId: point.id, name, category, coordinate }] }
    if (openEditor) this.openEditor(next)
    else this.setData({ routeDraft: next, routeChoices: this.draftChoices(next) })
  },
  moveStop(event) {
    const { index, step } = event.detail
    const stops = this.data.routeDraft.stops.slice()
    const target = index + step
    if (!stops[index] || !stops[target]) return
    const stop = stops[index]
    stops[index] = stops[target]
    stops[target] = stop
    this.setData({ 'routeDraft.stops': stops })
  },
  removeStop(event) {
    const draft = this.data.routeDraft
    const next = { ...draft, stops: draft.stops.filter((_, index) => index !== event.detail.index) }
    this.setData({ routeDraft: next, routeChoices: this.draftChoices(next) })
  },
  cancelDraft() { this.showSheet('', { routeDraft: null, routeChoices: [] }) },
  saveDraft() {
    const { routeDraft, cityId } = this.data
    if (!routeDraft.name.trim()) return toast('请填写路线名称')
    if (routeDraft.stops.length < 2) return toast('请添加至少两个地点')
    try {
      this.applyRoutes(saveRoute(cityId, routeDraft))
      this.setData({ routeDraft: null, routeChoices: [] })
      this.activateTab('book', true)
      wx.showToast({ title: '路线已保存', icon: 'success' })
    } catch (error) { toast('路线保存失败，请重试') }
  },

  openFeedback() {
    const { cityId, activeTab } = this.data
    this.showSheet('feedback', {
      feedbackDraft: { cityId, category: activeTab === 'book' ? '' : activeTab, name: '', address: '', description: '' },
      feedbackCityName: getFeedbackCity(cityId)?.cityName || '', feedbackCopied: false
    })
  },
  selectFeedbackCategory(event) {
    this.setData({ 'feedbackDraft.category': event.currentTarget.dataset.category, feedbackCopied: false })
  },
  changeFeedbackText(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`feedbackDraft.${field}`]: event.detail.value, feedbackCopied: false })
  },
  openFeedbackCities() {
    this.showSheet('feedback-cities', { feedbackQuery: '' })
    this.loadFeedbackMatches('')
  },
  loadFeedbackMatches(query) {
    this.filteredCities = searchFeedbackCities(query)
    this.setData({ feedbackQuery: query, feedbackMatches: this.filteredCities.slice(0, feedbackBatchSize),
      feedbackHasMore: this.filteredCities.length > feedbackBatchSize })
  },
  searchCities(event) { this.loadFeedbackMatches(event.detail.value) },
  moreCities() {
    if (!this.data.feedbackHasMore) return
    const size = this.data.feedbackMatches.length + feedbackBatchSize
    this.setData({ feedbackMatches: this.filteredCities.slice(0, size), feedbackHasMore: this.filteredCities.length > size })
  },
  chooseFeedbackCity(event) {
    const city = getFeedbackCity(event.currentTarget.dataset.id)
    if (!city) return
    this.showSheet('feedback', { 'feedbackDraft.cityId': city.cityId, feedbackCityName: city.cityName, feedbackCopied: false })
  },
  copyFeedback() {
    let feedback
    try { feedback = createFeedback(this.data.feedbackDraft) }
    catch (error) { return toast(error.message) }
    wx.setClipboardData({ data: JSON.stringify(feedback, null, 2),
      success: () => this.setData({ feedbackCopied: true }), fail: () => toast('复制失败，请重试') })
  },
  editFeedback() { this.setData({ feedbackCopied: false }) }
})
