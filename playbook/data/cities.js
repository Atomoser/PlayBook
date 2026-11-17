const boundaries = require('./maoming/boundaries.js')
const points = require('./maoming/points.js')

const maoming = {
  id: '440900',
  provinceName: '广东',
  cityName: '茂名',
  dataFolder: 'maoming',
  coordSystem: 'GCJ-02',
  center: [111.0046, 22.028],
  bounds: [110.325821, 21.37103, 111.683363, 22.704334],
  boundaries,
  points
}

module.exports = { [maoming.id]: maoming }
