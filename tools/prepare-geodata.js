const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { union } = require('polygon-clipping')

const dataV = 'https://geo.datav.aliyun.com/areas_v3/bound'
const maomingSource = `${dataV}/440900_full.json`
const catalogueSource = 'https://dmfw.mca.gov.cn/9095/xzqh/getList'
const data = resolve(__dirname, '../playbook/data')

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`)
  return response.json()
}

function segmentDistance(point, first, last) {
  const dx = last[0] - first[0]
  const dy = last[1] - first[1]
  const length = dx * dx + dy * dy
  const fraction = length ? Math.max(0, Math.min(1,
    ((point[0] - first[0]) * dx + (point[1] - first[1]) * dy) / length)) : 0
  return Math.hypot(point[0] - first[0] - dx * fraction, point[1] - first[1] - dy * fraction)
}

function simplify(points, tolerance = 0.00025) {
  let maximum = tolerance
  let split = 0
  const last = points.length - 1
  for (let index = 1; index < last; index++) {
    const distance = segmentDistance(points[index], points[0], points[last])
    if (distance > maximum) {
      maximum = distance
      split = index
    }
  }
  if (!split) return [points[0], points[last]]
  return simplify(points.slice(0, split + 1), tolerance).slice(0, -1).concat(simplify(points.slice(split), tolerance))
}

function normalizeBoundaries(features, tolerance = 0.00025) {
  return features.map(({ properties, geometry }) => ({
    id: String(properties.adcode),
    name: properties.name,
    label: properties.centroid || properties.center,
    polygons: (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates)
      .map(polygon => polygon.map(ring => {
        const simplified = simplify(ring, tolerance)
        return (simplified.length < 4 ? ring : simplified)
          .map(coordinate => coordinate.map(value => Number(value.toFixed(6))))
      }))
  }))
}

async function prepareBoundaries() {
  const { features } = await read(maomingSource)
  if (features.length !== 5) throw new Error('茂名区划源的区县数量发生变化，请复核。')
  return normalizeBoundaries(features)
}

function boundaryBounds(boundaries) {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const { polygons } of boundaries) {
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [longitude, latitude] of ring) {
          west = Math.min(west, longitude)
          south = Math.min(south, latitude)
          east = Math.max(east, longitude)
          north = Math.max(north, latitude)
        }
      }
    }
  }
  if (!(west < east && south < north)) throw new Error('地图边界范围无效')
  return [west, south, east, north]
}

function writeBoundaries(output, source, boundaries) {
  writeFileSync(output,
    `// Source: ${source} (GCJ-02)\nmodule.exports = [\n${boundaries.map(value => '  ' + JSON.stringify(value)).join(',\n')}\n]\n`,
    'utf8')
}

function createOutline(city) {
  const polygons = union(...city.boundaries.map(district => district.polygons))
  if (!polygons.length) throw new Error(`${city.id}的市域外轮廓为空，请复核`)
  const vertices = city.boundaries.flatMap(district => district.polygons.flatMap(polygon => polygon.flat()))
  const indices = new Map(vertices.map((coordinate, index) => [coordinate.join(','), index]))
  const extra = []
  // 外轮廓直接引用底图顶点，仅额外存储合并时产生的交点。
  const rings = polygons.map(polygon => polygon[0].map(coordinate => {
    const key = coordinate.join(',')
    if (!indices.has(key)) {
      indices.set(key, vertices.length + extra.length)
      extra.push(coordinate)
    }
    return indices.get(key)
  }))
  return { rings, extra }
}

async function prepareCities() {
  const { data: root } = await read(catalogueSource)
  const provinces = root.children.filter(item => /^\d{6}/.test(item.code))
  const rows = []
  const prefectures = new Set(['地级市', '自治州', '地区', '盟'])

  for (let offset = 0; offset < provinces.length; offset += 6) {
    const batch = provinces.slice(offset, offset + 6)
    const trees = await Promise.all(batch.map(async province => {
      if (province.type === '直辖市' || province.type === '特别行政区') return province
      for (const code of [province.code.slice(0, 6), province.code]) {
        try {
          const result = await read(`${catalogueSource}?code=${code}`)
          if (result.data?.code === province.code && result.data.children?.length) return result.data
        } catch (error) {
          console.warn(`${province.name}: ${error.message}`)
        }
      }
      throw new Error(`缺少 ${province.name} 数据`)
    }))

    for (const province of trees) {
      const provinceName = province.name.replace(/[省市]$/, '')
      const add = (entry, parentId) => {
        const cityId = entry.code.slice(0, 6)
        rows.push({ cityId, cityName: entry.name.replace(/市$/, ''), provinceName, mapCityId: parentId || cityId })
      }
      if (province.type === '直辖市' || province.type === '特别行政区') {
        add(province)
        continue
      }
      for (const city of province.children) {
        if (prefectures.has(city.type) || city.type === '县级市') add(city)
        for (const county of city.children || []) {
          if (county.type === '县级市') add(county, prefectures.has(city.type) ? city.code.slice(0, 6) : undefined)
        }
      }
    }
  }

  // The official city hierarchy response has no subentries for this record.
  if (!rows.some(city => city.cityId === '710000') && root.children.some(item => item.name === '台湾省')) {
    rows.push({ cityId: '710000', cityName: '台湾', provinceName: '台湾', mapCityId: '710000' })
  }
  if (rows.length < 650 || new Set(rows.map(item => item.cityId)).size !== rows.length) {
    throw new Error('全国城市目录不完整或存在重复城市代码')
  }
  return rows.sort((left, right) => left.cityId.localeCompare(right.cityId))
}

async function main() {
  const [, , option] = process.argv
  if (option && !['--national', '--guangdong'].includes(option)) {
    throw new Error('用法：node tools/prepare-geodata.js [--national]')
  }
  if (!option) {
    const [boundaries, cities] = await Promise.all([prepareBoundaries(), prepareCities()])
    writeBoundaries(resolve(data, 'cities/440000/440900/boundaries.js'), maomingSource, boundaries)
    writeFileSync(resolve(data, 'feedback-cities.js'),
      '// Source: ' + catalogueSource + '\nmodule.exports = ' + JSON.stringify(cities) + '\n', 'utf8')
  }
  const { prepareNational } = require('./prepare-national.js')
  await prepareNational()
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { normalizeBoundaries, boundaryBounds, createOutline }
