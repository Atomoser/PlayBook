const cities = require('../playbook/data/cities.js')
const catalogue = require('../playbook/data/feedback-cities.js')

const fields = ['id', 'provinceName', 'cityName', 'category', 'name', 'coordinate', 'address', 'description']
const cityCode = /^\d{6}$/
const validText = value => typeof value === 'string' && !!value.trim()

function validateCoordinate(coordinate, bounds) {
  if (!Array.isArray(coordinate) || coordinate.length !== 2 || !coordinate.every(Number.isFinite)) {
    throw new Error('请输入 GCJ-02 坐标 [经度, 纬度]')
  }
  const [longitude, latitude] = coordinate
  const [west, south, east, north] = bounds
  if (longitude < west - 0.002 || longitude > east + 0.002 || latitude < south - 0.002 || latitude > north + 0.002) {
    throw new Error('坐标超出当前城市的地图范围')
  }
}

function validatePoint(point, city) {
  const label = point?.name || point?.id || '未命名点位'
  if (!point || Object.keys(point).length !== fields.length || !fields.every(field => Object.hasOwn(point, field))) {
    throw new Error(`${label}须使用统一的八个点位字段`)
  }
  if (!['id', 'name', 'address', 'description'].every(field => validText(point[field])) ||
      !['eat', 'play'].includes(point.category)) throw new Error(`${label}缺少地点信息或类别有误`)
  if (point.provinceName !== city.provinceName || point.cityName !== city.cityName) {
    throw new Error(`${label}的省份或城市与所属地图不一致`)
  }
  validateCoordinate(point.coordinate, city.bounds)
}

function validateAll() {
  const catalogued = new Map()
  for (const city of catalogue) {
    if (!cityCode.test(city.cityId) || !cityCode.test(city.mapCityId) || !validText(city.cityName) ||
        !validText(city.provinceName) || /[省市]$/.test(city.provinceName) ||
        catalogued.has(city.cityId)) throw new Error(`反馈目录记录无效 ${JSON.stringify(city)}`)
    catalogued.set(city.cityId, city)
  }
  for (const city of catalogue) {
    if (!catalogued.has(city.mapCityId)) throw new Error(`反馈城市 ${city.cityName} 缺少所属地图城市代码`)
  }

  let pointCount = 0
  for (const city of Object.values(cities)) {
    const entry = catalogued.get(city.id)
    if (!entry || entry.cityName !== city.cityName || entry.provinceName !== city.provinceName ||
        !city.boundaries.length) throw new Error(`地图城市 ${city.id} 的配置有误`)
    for (const district of city.boundaries) {
      validateCoordinate(district.label, city.bounds)
      for (const polygon of district.polygons) {
        for (const ring of polygon) {
          const end = ring.at(-1)
          if (ring.length < 4 || ring[0][0] !== end[0] || ring[0][1] !== end[1]) {
            throw new Error(`${district.name} 的边界环未闭合`)
          }
          for (const coordinate of ring) validateCoordinate(coordinate, city.bounds)
        }
      }
    }
    const ids = new Set()
    for (const point of city.points) {
      validatePoint(point, city)
      if (ids.has(point.id)) throw new Error(`${city.cityName}的点位编号重复 ${point.id}`)
      ids.add(point.id)
      pointCount++
    }
  }
  console.log(`已校验 ${Object.keys(cities).length} 张地图、${catalogued.size} 条反馈城市记录和 ${pointCount} 个点位`)
}

if (require.main === module) {
  try { validateAll() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}

module.exports = { validatePoint }
