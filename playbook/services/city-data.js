const cities = require('../data/cities.js')
const feedbackCities = require('../data/feedback-cities.js')

function getCity(cityId) {
  return cities[cityId]
}

function getPoints(cityId, category) {
  return getCity(cityId).points.filter(point => point.category === category)
}

function getFeedbackCity(cityId) {
  return feedbackCities.find(city => city.cityId === cityId)
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

module.exports = {
  getCity,
  getPoints,
  getFeedbackCity,
  searchFeedbackCities,
  createFeedback,
  openCities: Object.values(cities).map(city => ({ id: city.id, name: city.cityName }))
}
