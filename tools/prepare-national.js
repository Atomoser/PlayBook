const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { normalizeBoundaries, boundaryBounds, createOutline } = require('./prepare-geodata.js')

const root = path.resolve(__dirname, '../playbook')
const output = path.join(root, 'data/national')
const cache = path.join(os.tmpdir(), 'playbook-national-source')
const source = 'https://geo.datav.aliyun.com/areas_v3/bound'
const packageLimit = 1800000
const municipalities = new Set(['110000', '120000', '310000', '500000'])
const specialRegions = new Set(['810000', '820000'])
const oldCities = require('../playbook/data/cities.js')
const catalogue = require('../playbook/data/feedback-cities.js')
const knownNames = new Map(catalogue.map(city => [city.cityId, city]))

function writeModule(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'module.exports = ' + JSON.stringify(value) + '\n', 'utf8')
}

async function read(code) {
  const file = path.join(cache, code + '_full.json')
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(source + '/' + code + '_full.json', { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(code + ': HTTP ' + response.status)
      const text = await response.text()
      const json = JSON.parse(text)
      fs.mkdirSync(cache, { recursive: true })
      fs.writeFileSync(file, text, 'utf8')
      return json
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

function displayName(name) {
  return name.replace(/[省市]$/, '')
}

function describe(feature, province) {
  const id = String(feature.properties.adcode)
  const boundaries = normalizeBoundaries([feature], 0.006)
  const bounds = boundaryBounds(boundaries)
  const known = knownNames.get(id)
  const old = oldCities[id]
  return {
    id, provinceId: province.id, provinceName: province.name,
    cityName: known?.cityName || displayName(feature.properties.name),
    fullName: feature.properties.name,
    level: municipalities.has(id) ? 'municipality' : specialRegions.has(id) ? 'special' :
      id === '710000' ? 'province' : id.endsWith('00') ? 'city' : 'county',
    coordSystem: 'GCJ-02',
    center: old?.center || feature.properties.centroid || feature.properties.center,
    bounds: old?.bounds || bounds,
    dataFolder: 'cities/' + province.id + '/' + id,
    base: boundaries[0].polygons
  }
}

function packCity(city, boundaries) {
  return {
    id: city.id,
    boundaries: boundaries.map(district => ({ ...district, polygons: encodePolygons(district.polygons) })),
    outline: createOutline({ id: city.id, boundaries })
  }
}

function encodePolygons(polygons) {
  return polygons.map(polygon => polygon.map(ring => {
    let longitude = 0
    let latitude = 0
    const bytes = []
    for (const coordinate of ring) {
      const nextLongitude = Math.round(coordinate[0] * 1000000)
      const nextLatitude = Math.round(coordinate[1] * 1000000)
      for (const delta of [nextLongitude - longitude, nextLatitude - latitude]) {
        let value = (delta << 1) ^ (delta >> 31)
        while (value >= 128) {
          bytes.push((value & 127) | 128)
          value >>>= 7
        }
        bytes.push(value)
      }
      longitude = nextLongitude
      latitude = nextLatitude
    }
    return Buffer.from(bytes).toString('base64')
  }))
}

function emitPackage(name, cities) {
  const folder = path.join(root, 'map-packages', name)
  fs.mkdirSync(folder, { recursive: true })
  writeModule(path.join(folder, 'data.js'), cities)
  fs.writeFileSync(path.join(folder, 'entry.js'), 'Page({})\n', 'utf8')
  fs.writeFileSync(path.join(folder, 'entry.json'), '{}\n', 'utf8')
  fs.writeFileSync(path.join(folder, 'entry.wxml'), '<view />\n', 'utf8')
  return { name, root: 'map-packages/' + name, pages: ['entry'] }
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const national = await read('100000')
  const provinceFeatures = national.features.filter(feature => /^\d{6}$/.test(String(feature.properties.adcode)))
  if (provinceFeatures.length !== 34) throw new Error('省级边界数量发生变化，请复核')
  const provinces = []
  const cities = []
  const packages = []
  const coverage = []
  let prefectures = 0
  let mainlandCounties = 0
  let specialDistricts = 0

  for (const feature of provinceFeatures) {
    const id = String(feature.properties.adcode)
    const province = {
      id, name: knownNames.get(id)?.provinceName || displayName(feature.properties.name),
      fullName: feature.properties.name,
      label: feature.properties.centroid || feature.properties.center,
      polygons: normalizeBoundaries([feature], 0.006)[0].polygons
    }
    provinces.push(province)
    const children = feature.properties.childrenNum ? (await read(id)).features : []
    const direct = municipalities.has(id) || specialRegions.has(id)
    const mapFeatures = direct || !children.length ? [feature] : children
    const details = []
    let counties = 0
    for (const cityFeature of mapFeatures) {
      const city = describe(cityFeature, province)
      let districts
      if (direct) districts = children
      else if (cityFeature.properties.childrenNum) districts = (await read(city.id)).features
      else districts = [cityFeature]
      if (city.id === '710000') districts = [cityFeature]
      const boundaries = oldCities[city.id]?.boundaries?.length ? oldCities[city.id].boundaries : normalizeBoundaries(districts)
      if (!boundaries.length) throw new Error(city.cityName + '缺少边界')
      city.bounds = boundaryBounds(boundaries)
      if (oldCities[city.id]) city.bounds = oldCities[city.id].bounds
      city.districtCount = city.id === '710000' ? 0 : districts.length
      counties += city.districtCount
      if (specialRegions.has(id)) specialDistricts += city.districtCount
      else if (id !== '710000') {
        if (!direct && city.level === 'city') {
          prefectures++
          mainlandCounties += cityFeature.properties.childrenNum ? districts.length : 0
        } else mainlandCounties += city.districtCount
      }
      cities.push(city)
      details.push(packCity(city, boundaries))
      const pointsFile = path.join(root, 'data', city.dataFolder, 'points.js')
      if (!fs.existsSync(pointsFile)) writeModule(pointsFile, [])
    }

    let batch = []
    let batchBytes = 0
    let part = 0
    for (const detail of details) {
      const bytes = Buffer.byteLength(JSON.stringify(detail), 'utf8')
      if (bytes > packageLimit) throw new Error(detail.id + '的城市边界超过单包预算')
      if (batch.length && batchBytes + bytes > packageLimit) {
        const name = 'p' + id.slice(0, 2) + '_' + part++
        packages.push(emitPackage(name, batch))
        for (const item of batch) cities.find(city => city.id === item.id).mapPackage = name
        batch = []
        batchBytes = 0
      }
      batch.push(detail)
      batchBytes += bytes
    }
    if (batch.length) {
      const name = 'p' + id.slice(0, 2) + '_' + part
      packages.push(emitPackage(name, batch))
      for (const item of batch) cities.find(city => city.id === item.id).mapPackage = name
    }
    coverage.push({ id, name: province.name, mapEntries: details.length, districts: counties })
    console.log(province.name + '：' + details.length + ' 个地图入口，' + counties + ' 个下级区域')
  }

  const provinceGeometry = provinces.map(province => ({ ...province, polygons: encodePolygons(province.polygons) }))
  const cityGeometry = cities.map(city => ({ id: city.id, polygons: encodePolygons(city.base) }))
  const descriptors = cities.map(({ base, ...city }) => city)
  const borders = national.features.filter(feature => !/^\d{6}$/.test(String(feature.properties.adcode)))
    .flatMap(feature => normalizeBoundaries([feature], 0.006)[0].polygons)
  const bounds = boundaryBounds(normalizeBoundaries(provinceFeatures, 0.006))
  writeModule(path.join(output, 'catalogue.js'), {
    bounds, provinces: provinces.map(({ polygons, ...province }) => province), cities: descriptors
  })
  packages.unshift(emitPackage('base_0', {
    provinces: provinceGeometry, cities: cityGeometry, borders: encodePolygons(borders)
  }))
  const maoming = detailsForMaoming()
  writeModule(path.join(root, 'data/cities/440000/440900/outline.js'), maoming.outline)
  const pointImports = descriptors.map(city =>
    "  '" + city.id + "': require('../" + city.dataFolder + "/points.js')")
  fs.writeFileSync(path.join(output, 'points.js'), 'module.exports = {\n' + pointImports.join(',\n') + '\n}\n')
  const loaders = packages.map(pkg => "  '" + pkg.name + "': () => require.async('../" + pkg.root + "/data.js')")
  fs.writeFileSync(path.join(root, 'services/map-loaders.js'), 'module.exports = {\n' + loaders.join(',\n') + '\n}\n')
  const appFile = path.join(root, 'app.json')
  const app = JSON.parse(fs.readFileSync(appFile, 'utf8'))
  app.subPackages = packages
  fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + '\n')
  const packageRoot = path.resolve(root, 'map-packages')
  const active = new Set(packages.map(pkg => pkg.name))
  for (const name of fs.readdirSync(packageRoot)) {
    const obsolete = path.resolve(packageRoot, name)
    if (/^p\d{2}_\d+$/.test(name) && !active.has(name) && obsolete.startsWith(packageRoot + path.sep)) {
      fs.rmSync(obsolete, { recursive: true })
    }
  }
  const manifest = {
    source: source + '/100000_full.json', generatedAt: new Date().toISOString(),
    provinces: provinces.length, prefectures, mainlandCounties, specialDistricts,
    mapEntries: cities.length, packages: packages.length, detailPackages: packages.length - 1, coverage,
    notes: ['地级与县级统计为数据源的中国大陆口径。', '香港、澳门分区另行统计。', '台湾仅提供省级轮廓，数据源缺少其下级行政边界。']
  }
  fs.writeFileSync(path.join(output, 'coverage.js'), 'module.exports = ' + JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify({ provinces: provinces.length, prefectures, mainlandCounties, specialDistricts, mapEntries: cities.length, packages: packages.length }))
}

function detailsForMaoming() {
  return packCity(oldCities['440900'], oldCities['440900'].boundaries)
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}

module.exports = { prepareNational: main }
