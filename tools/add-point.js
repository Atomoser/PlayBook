const { randomUUID } = require('node:crypto')
const { readFileSync, writeFileSync, renameSync, openSync, closeSync, rmSync } = require('node:fs')
const { resolve } = require('node:path')
const cities = require('../playbook/data/cities.js')
const feedbackCities = require('../playbook/data/feedback-cities.js')
const { validatePoint } = require('./validate-data.js')

const text = value => typeof value === 'string' ? value.trim() : ''
const fold = value => value.normalize('NFKC').trim().toLowerCase()

function addPoint(input) {
  const feedback = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''))
  const selected = feedbackCities.find(city => city.cityId === feedback?.cityId)
  if (!selected || feedback.cityName !== selected.cityName || feedback.provinceName !== selected.provinceName) {
    throw new Error('城市编号、省份名称和城市名称须与反馈目录一致')
  }
  const city = cities[selected.mapCityId]
  if (!city) throw new Error('该城市地图尚未开放，请保存反馈，等对应地图上线后再导入')

  const point = {
    id: `p-${randomUUID()}`,
    provinceName: city.provinceName,
    cityName: city.cityName,
    category: feedback.category,
    name: text(feedback.name),
    coordinate: feedback.coordinate,
    address: text(feedback.address),
    description: text(feedback.description)
  }
  validatePoint(point, city)

  const output = resolve(__dirname, '../playbook/data', city.dataFolder, 'points.js')
  const lockPath = `${output}.lock`
  const temporary = `${output}.${point.id}.tmp`
  let lock
  try { lock = openSync(lockPath, 'wx') }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('正在写入此城市的点位文件，请稍后重试')
    throw error
  }
  try {
    delete require.cache[require.resolve(output)]
    const points = require(output)
    const duplicate = points.find(item => fold(item.name) === fold(point.name) &&
      Math.hypot(item.coordinate[0] - point.coordinate[0], item.coordinate[1] - point.coordinate[1]) < 0.001)
    if (duplicate) throw new Error(`已有同名邻近点位 ${duplicate.id}，请先核对地址`)
    writeFileSync(temporary, `module.exports = ${JSON.stringify([...points, point], null, 2)}\n`, 'utf8')
    renameSync(temporary, output)
  } finally {
    closeSync(lock)
    rmSync(temporary, { force: true })
    rmSync(lockPath, { force: true })
  }
  console.log(`已将 ${point.name}（${point.id}）添加到 ${output}`)
}

try {
  const [, , flag, input] = process.argv
  if (flag !== '--from' || !input) throw new Error('用法：node tools/add-point.js --from feedback.json')
  addPoint(input)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
