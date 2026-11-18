const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function decodeDeltas(text) {
  const bytes = []
  let buffer = 0
  let bits = 0
  for (const character of text) {
    if (character === '=') break
    buffer = (buffer << 6) | base64Alphabet.indexOf(character)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 255)
    }
  }
  const deltas = []
  let value = 0
  let shift = 0
  for (const byte of bytes) {
    value |= (byte & 127) << shift
    if (byte & 128) {
      shift += 7
    } else {
      deltas.push((value >>> 1) ^ -(value & 1))
      value = 0
      shift = 0
    }
  }
  return deltas
}

function decodePolygons(polygons) {
  return polygons.map(polygon => polygon.map(ring => {
    const deltas = typeof ring === 'string' ? decodeDeltas(ring) : ring
    let longitude = 0
    let latitude = 0
    const coordinates = []
    for (let index = 0; index < deltas.length; index += 2) {
      longitude += deltas[index]
      latitude += deltas[index + 1]
      coordinates.push([longitude / 1000000, latitude / 1000000])
    }
    return coordinates
  }))
}

function decodeCity(city) {
  return {
    ...city,
    boundaries: city.boundaries.map(district => ({ ...district, polygons: decodePolygons(district.polygons) }))
  }
}

module.exports = { decodePolygons, decodeCity }
