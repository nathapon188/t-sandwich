// Claude reads images up to 2576px on the long edge; anything larger costs
// tokens and upload size for no accuracy gain.
const MAX_EDGE = 2576
const MAX_BYTES = 4 * 1024 * 1024

const readAsDataUrl = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })

const approxBytes = dataUrl => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)

/** Reads an image file, downscaling it only when it exceeds Claude's limit. */
export async function prepareImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('That is not an image. Paste or choose a PNG or JPEG screenshot.')
  }

  const original = await readAsDataUrl(file)
  const bitmap = await createImageBitmap(file)
  const longEdge = Math.max(bitmap.width, bitmap.height)

  if (longEdge <= MAX_EDGE && approxBytes(original) <= MAX_BYTES) {
    bitmap.close()
    return { dataUrl: original, width: bitmap.width, height: bitmap.height, resized: false }
  }

  const scale = Math.min(1, MAX_EDGE / longEdge)
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // PNG keeps small digits crisp; JPEG artefacts hurt transcription accuracy.
  let dataUrl = canvas.toDataURL('image/png')
  if (approxBytes(dataUrl) > MAX_BYTES) dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  if (approxBytes(dataUrl) > MAX_BYTES) {
    throw new Error('That image is too large even after resizing. Crop it to one week and try again.')
  }

  return { dataUrl, width, height, resized: true }
}

/** Pulls the first image out of a paste event, if there is one. */
export function imageFromPaste(event) {
  const items = Array.from(event.clipboardData?.items ?? [])
  const item = items.find(i => i.kind === 'file' && i.type.startsWith('image/'))
  return item ? item.getAsFile() : null
}
