const cities = require('../data/cities.js')
const feedbackCities = require('../data/feedback-cities.js')
const loaders = require('./map-loaders.js')
const { decodeCity } = require('./map-geometry.js')

const pendingPackages = new Map()
let countryBase = null
let pendingCountry = null
const routebookFeedbackLimits = Object.freeze({ maxPlaces: 50, nameLimit: 40, placeNameLimit: 120 })

function getCountryBase() { return countryBase }

function ensureCountryBase() {
  if (!pendingCountry) {
    pendingCountry = Promise.resolve().then(loaders.base_0).then(data => {
      countryBase = data
      return data
    }).catch(error => {
      pendingCountry = null
      throw error
    })
  }
  return pendingCountry
}

function getCity(cityId) {
  return cities[cityId]
}

function getProvinceCities(provinceName) {
  return Object.values(cities).filter(city => city.provinceName === provinceName)
}

function ensureCityDetails(cityId) {
  const city = getCity(cityId)
  if (!city) return Promise.reject(new Error('城市地图不存在'))
  if (city.boundaries.length) return Promise.resolve()
  const name = city.mapPackage
  if (!pendingPackages.has(name)) {
    const pending = Promise.resolve().then(loaders[name]).then(entries => {
      for (const entry of entries) {
        const target = getCity(entry.id)
        if (target && !target.boundaries.length) Object.assign(target, decodeCity(entry))
      }
    }).catch(error => {
      pendingPackages.delete(name)
      throw error
    })
    pendingPackages.set(name, pending)
  }
  return pendingPackages.get(name)
}

function getPoints(cityId, category) {
  return getCity(cityId).points.filter(point => point.category === category)
}

function getFeedbackCity(cityId) {
  const known = feedbackCities.find(city => city.cityId === cityId)
  if (known) return known
  const city = getCity(cityId)
  return city && { cityId, cityName: city.cityName, provinceName: city.provinceName, mapCityId: cityId }
}

function searchFeedbackCities(query) {
  const keyword = query.trim().replace(/市$/, '')
  return feedbackCities.filter(city => city.cityName.includes(keyword))
}

function createFeedback(draft) {
  const city = getFeedbackCity(draft.cityId)
  const { category } = draft
  const name = draft.name.trim()
  const address = draft.address.trim()
  const description = draft.description.trim()
  if (!city || !['eat', 'play'].includes(category) || !name || !address || !description) {
    throw new Error('请选择城市和类别，并填写地点信息')
  }
  return {
    cityId: city.cityId,
    provinceName: city.provinceName,
    cityName: city.cityName,
    category,
    name,
    address,
    description,
    coordinate: null
  }
}

function createRoutebookFeedback(draft) {
  const { maxPlaces, nameLimit, placeNameLimit } = routebookFeedbackLimits
  const name = typeof draft?.name === 'string' ? draft.name.trim() : ''
  if (!name) throw new Error('请填写路书名称')
  if (name.length > nameLimit) throw new Error(`路书名称最多${nameLimit}个字`)
  if (!Array.isArray(draft.places) || !draft.places.length) throw new Error('请填写至少1个地点')
  if (draft.places.length > maxPlaces) throw new Error(`最多反馈${maxPlaces}个地点`)

  const places = draft.places.map((place, index) => {
    const placeName = typeof place?.name === 'string' ? place.name.trim() : ''
    if (!placeName) throw new Error(`请填写第${index + 1}个地点`)
    if (placeName.length > placeNameLimit) throw new Error(`第${index + 1}个地点最多${placeNameLimit}个字`)
    return { order: index + 1, name: placeName }
  })
  return { type: 'routebook', name, places }
}

module.exports = {
  getCity,
  getCountryBase,
  ensureCountryBase,
  getProvinceCities,
  ensureCityDetails,
  getPoints,
  getFeedbackCity,
  searchFeedbackCities,
  createFeedback,
  createRoutebookFeedback,
  routebookFeedbackLimits,
  openCities: Object.values(cities).map(city => ({
    id: city.id, name: city.cityName, fullName: city.fullName, provinceName: city.provinceName
  }))
}
