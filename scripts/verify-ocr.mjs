import { createCanvas } from '@napi-rs/canvas'
import { extractDocument } from '../server/lib/ingest/extract.ts'
import { terminateOcr } from '../server/lib/ingest/ocr.ts'
import assert from 'node:assert/strict'

function makeImagePdf(jpeg, width, height) {
  const content = Buffer.from(`q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`, 'latin1')
  const bodies = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 5 0 R /Resources << /XObject << /Im1 4 0 R >> >> >>`,
      'latin1',
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        'latin1',
      ),
      jpeg,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
      content,
      Buffer.from('\nendstream', 'latin1'),
    ]),
  ]

  let pdf = Buffer.from('%PDF-1.4\n', 'latin1')
  const offsets = [0]
  bodies.forEach((body, index) => {
    offsets[index + 1] = pdf.length
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ])
  })
  const xref = pdf.length
  let tail = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= bodies.length; index++) {
    tail += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  tail += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.concat([pdf, Buffer.from(tail, 'latin1')])
}

try {
  const width = 900
  const height = 240
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = 'white'
  context.fillRect(0, 0, width, height)
  context.fillStyle = 'black'
  context.font = '56px Arial'
  context.fillText('SCANNED INVOICE 98765', 40, 140)
  const jpeg = canvas.toBuffer('image/jpeg', 90)
  const pdf = makeImagePdf(jpeg, width, height)

  const result = await extractDocument({
    buffer: pdf,
    filename: 'scan.pdf',
    contentType: 'application/pdf',
  })
  assert.equal(result.kind, 'pdf')
  assert.equal(result.ocrUsed, true)
  assert.match(result.text, /SCANNED INVOICE 98765/i)

  const imageResult = await extractDocument({
    buffer: jpeg,
    filename: 'scan.jpg',
    contentType: 'image/jpeg',
  })
  assert.equal(imageResult.kind, 'image')
  assert.match(imageResult.text, /SCANNED INVOICE 98765/i)
  console.log('[ok] OCR extracted text from a scanned PDF and JPG image')
} finally {
  await terminateOcr()
}
