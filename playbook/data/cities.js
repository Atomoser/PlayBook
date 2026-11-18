const catalogue = require('./national/catalogue.js')
const points = require('./national/points.js')

const cities = Object.fromEntries(catalogue.cities.map(city => [city.id, {
  ...city, points: points[city.id], boundaries: [], outline: null
}]))

Object.assign(cities['440900'], {
  boundaries: require('./cities/440000/440900/boundaries.js'),
  outline: require('./cities/440000/440900/outline.js')
})

module.exports = cities
