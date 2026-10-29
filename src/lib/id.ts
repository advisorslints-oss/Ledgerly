// Time-ordered ids (UUIDv7 layout) so records created offline on different devices never
// collide and still sort roughly by creation time when they are merged during sync.

export function newId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const ms = Date.now()
  bytes[0] = (ms / 2 ** 40) & 0xff
  bytes[1] = (ms / 2 ** 32) & 0xff
  bytes[2] = (ms >>> 24) & 0xff
  bytes[3] = (ms >>> 16) & 0xff
  bytes[4] = (ms >>> 8) & 0xff
  bytes[5] = ms & 0xff
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 128-bit string hash (cyrb128). */
function hash128(text: string): number[] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/**
 * The same seed gives the same id on every device. Used for documents created by a recurring
 * schedule, so two devices creating the same occurrence end up with one record, not two.
 */
export function seededId(seed: string): string {
  const hex = hash128(seed)
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('')
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

let deviceId: string | null = null

/** A stable id for this browser/device, used to attribute changes for sync and audit. */
export function getDeviceId(): string {
  if (deviceId) return deviceId
  try {
    deviceId = localStorage.getItem('ledgerly.deviceId')
    if (!deviceId) {
      deviceId = newId()
      localStorage.setItem('ledgerly.deviceId', deviceId)
    }
  } catch {
    deviceId = newId()
  }
  return deviceId
}
