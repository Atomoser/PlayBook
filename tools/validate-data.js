const cities = require('../playbook/data/cities.js')
const catalogue = require('../playbook/data/feedback-cities.js')
const app = require('../playbook/app.json')
const { decodeCity } = require('../playbook/services/map-geometry.js')
const coverage = require('../playbook/data/national/coverage.js')
const { readdirSync, statSync } = require('node:fs')
const { resolve, join, sep } = require('node:path')

const fields = ['id', 'provinceName', 'cityName', 'category', 'name', 'coordinate', 'address', 'description']
const cityCode = /^\d{6}$/
const validText = value => typeof value === 'string' && !!value.trim()

function validatePackageSizes() {
  const root = resolve(__dirname, '../playbook')
  const packages = app.subPackages.map(pkg => ({ ...pkg, folder: resolve(root, pkg.root), bytes: 0 }))
  let mainBytes = 0
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.name !== 'project.private.config.json') {
        const bytes = statSync(file).size
        const pkg = packages.find(item => file.startsWith(item.folder + sep))
        if (pkg) pkg.bytes += bytes
        else mainBytes += bytes
      }
    }
  }
  visit(root)
  if (mainBytes >= 2 * 1024 * 1024 || packages.some(pkg => pkg.bytes >= 2 * 1024 * 1024)) {
    throw new Error('主包或地图分包超过 2 MB，请重新分包')
  }
  console.log(`主包 ${(mainBytes / 1000000).toFixed(2)} MB，${packages.length} 个分包，最大分包 ${(Math.max(...packages.map(pkg => pkg.bytes)) / 1000000).toFixed(2)} MB`)
  if (mainBytes > 1500000) console.warn('主包超过 1.5 MB 的优化建议，建议继续拆分')
}

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
  const details = new Map()
  for (const pkg of app.subPackages) {
    if (pkg.name === 'base_0') continue
    for (const packed of require('../playbook/' + pkg.root + '/data.js')) {
      if (details.has(packed.id)) throw new Error('地图分包的城市编号重复 ' + packed.id)
      details.set(packed.id, decodeCity(packed))
    }
  }
  if (details.size !== Object.keys(cities).length || coverage.provinces !== 34 ||
      coverage.prefectures !== 333 || coverage.mainlandCounties !== 2844) {
    throw new Error('全国地图覆盖数量与数据清单不一致')
  }
  for (const descriptor of Object.values(cities)) {
    const city = { ...descriptor, ...details.get(descriptor.id) }
    if (city.dataFolder !== `cities/${city.provinceId}/${city.id}`) {
      throw new Error(`${city.cityName}的点位目录须按省份和城市编码分层`)
    }
    const entry = catalogued.get(city.id)
    if ((entry && (entry.cityName !== city.cityName || entry.provinceName !== city.provinceName)) ||
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
    if (!Array.isArray(city.outline?.rings) || !city.outline.rings.length || !Array.isArray(city.outline.extra)) {
      throw new Error(`${city.cityName}缺少市域外轮廓，请重新生成地图数据`)
    }
    const vertices = city.boundaries.flatMap(district => district.polygons.flatMap(polygon => polygon.flat()))
    const outlineVertexCount = vertices.length + city.outline.extra.length
    for (const coordinate of city.outline.extra) validateCoordinate(coordinate, city.bounds)
    for (const ring of city.outline.rings) {
      if (!Array.isArray(ring) || ring.length < 4 || ring[0] !== ring.at(-1) ||
          !ring.every(index => Number.isInteger(index) && index >= 0 && index < outlineVertexCount)) {
        throw new Error(`${city.cityName}的市域外轮廓没有正确引用底图顶点`)
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
  console.log(`已校验 ${coverage.provinces} 个省级区域、${coverage.prefectures} 个地级区域、${coverage.mainlandCounties} 个大陆县级区域、${coverage.specialDistricts} 个港澳分区和 ${pointCount} 个点位`)
  validatePackageSizes()
}

if (require.main === module) {
  try { validateAll() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}

module.exports = { validatePoint }
