import Anthropic from '@anthropic-ai/sdk'
import { ApiError } from './core.mjs'

const MODEL = 'claude-opus-5'
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/**
 * Structured output schema. Claude is constrained to this shape, so the
 * response never needs defensive parsing beyond JSON.parse.
 */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['days', 'notes'],
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['weekday', 'slots'],
        properties: {
          weekday: {
            type: 'string',
            enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'lines'],
              properties: {
                label: { type: 'string' },
                lines: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['item', 'full', 'half', 'price', 'unreadable'],
                    properties: {
                      item: { type: 'string' },
                      full: { type: 'integer' },
                      half: { type: 'integer' },
                      price: { type: 'number' },
                      unreadable: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const SYSTEM = `You transcribe sandwich order spreadsheets for a catering run. You are reading a screenshot of a spreadsheet, not interpreting it: report exactly the numbers shown.

Rules:
- Report every item row that appears for a day, including rows whose quantity is zero.
- Quantities are whole numbers. If a cell is blank, treat it as 0.
- If a cell is redacted, blacked out, obscured or genuinely unreadable, set that quantity to 0 and set "unreadable" to true for that line. Never guess a hidden number.
- "full" is the Quantity Full Sandwich column and "half" is the Quantity half sandwich column. "price" is the row's price total for that collection time.
- "label" is the collection time heading exactly as printed, for example "8:00am" or "10:30am".
- Do not include the day total row as a line item.
- Put anything ambiguous, any redacted cell, and any item name that does not match the known list into "notes". Keep notes to a few short sentences.`

function parseDataUrl(dataUrl) {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl ?? ''))
  if (!match) throw new ApiError(400, 'Image must be a base64 data URL')

  const [, mediaType, base64] = match
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType.toLowerCase())) {
    throw new ApiError(400, `Unsupported image type ${mediaType}. Use PNG, JPEG, WebP or GIF.`)
  }
  // base64 inflates by ~4/3; check the decoded size.
  const bytes = Math.floor((base64.length * 3) / 4)
  if (bytes > MAX_IMAGE_BYTES) {
    throw new ApiError(413, 'Image is too large. Keep it under 4 MB.')
  }
  return { mediaType: mediaType.toLowerCase(), base64 }
}

/**
 * Sends the screenshot to Claude and returns the transcribed orders.
 * Nothing is written anywhere: the caller reviews the result before saving.
 */
export async function extractOrdersFromImage({ apiKey, image, catalogue, slots }) {
  if (!apiKey) {
    throw new ApiError(500, 'Server is missing ANTHROPIC_API_KEY, so image import is unavailable.')
  }
  const { mediaType, base64 } = parseDataUrl(image)

  const itemList = catalogue.map(i => `- ${i.name}`).join('\n')
  const slotList = slots.map(s => `- ${s.label} (id ${s.id})`).join('\n')

  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            {
              type: 'text',
              text: `Transcribe every order in this spreadsheet screenshot.

Known items (match names to these where you can, otherwise report the printed name):
${itemList}

Known collection times:
${slotList}

Return one entry per weekday, and within each weekday one entry per collection time.`,
            },
          ],
        },
      ],
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ApiError(500, 'The server ANTHROPIC_API_KEY was rejected.')
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ApiError(429, 'Claude is rate limited right now. Try again shortly.')
    }
    if (err instanceof Anthropic.APIError) {
      throw new ApiError(502, `Claude request failed (${err.status}): ${err.message}`)
    }
    throw err
  }

  if (response.stop_reason === 'refusal') {
    throw new ApiError(422, 'Claude declined to read this image.')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ApiError(502, 'The response was cut short. Try importing one week at a time.')
  }

  const text = response.content.find(block => block.type === 'text')?.text
  if (!text) throw new ApiError(502, 'Claude returned no readable result.')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ApiError(502, 'Claude returned malformed JSON.')
  }

  return {
    ...parsed,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  }
}
