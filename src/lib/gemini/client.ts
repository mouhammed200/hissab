// Server-side Gemini SDK wrapper
// This file is ONLY used in API routes — never imported from client code

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai'
import { getSystemPrompt } from './prompts'
import { RECORD_RESPONSE_SCHEMA } from './schema'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

export interface GeminiRequest {
  userMessage: string
  contextData?: Record<string, unknown>
  chatHistory?: Array<{ role: 'user' | 'model'; content: string }>
  fileData?: { mimeType: string; data: string }
}

export interface GeminiResponse {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  rawText?: string
}

// Safety settings configured for business accounting domain
const ACCOUNTING_SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
]

// Model chain. gemini-1.5-flash was removed: it is retired and every request to
// it 404s, which burned a whole retry cycle before surfacing a useless error.
// Override with GEMINI_MODELS="model-a,model-b" when rolling forward.
const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite']

export function getModelChain(): string[] {
  const configured = (process.env.GEMINI_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  return configured.length ? configured : DEFAULT_MODELS
}

// Retry with exponential backoff on 429, fall forward on 404/unsupported model.
// Every failure is logged with its model and attempt so a silent degradation to
// the fallback model is visible in production logs instead of invisible.
async function withRetry<T>(fn: (modelName: string) => Promise<T>, maxRetries = 3): Promise<T> {
  const modelsToTry = getModelChain()
  let lastError: unknown = null

  for (const modelName of modelsToTry) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn(modelName)
      } catch (err: unknown) {
        lastError = err
        const errObj = err as { status?: number; message?: string }
        const message = errObj?.message || ''
        const isRateLimit = errObj?.status === 429 || /429|quota|resource_exhausted/i.test(message)
        const isNotFound =
          errObj?.status === 404 || /404|not found|no longer available|is not supported/i.test(message)

        console.warn(
          `[gemini] ${modelName} attempt ${attempt + 1}/${maxRetries} failed: ${message || 'unknown error'}`,
        )

        if (isNotFound) break // stop retrying a model that does not exist

        if (isRateLimit && attempt < maxRetries - 1) {
          const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500
          await new Promise((res) => setTimeout(res, delayMs))
          continue
        }

        // Non-retryable (400 bad request, malformed schema, auth): fail fast
        // rather than hammering the same broken call across every model.
        if (!isRateLimit) break
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`All Gemini models failed: ${modelsToTry.join(', ')}`)
}

export async function parseTransaction(req: GeminiRequest): Promise<GeminiResponse> {
  try {
    const systemPrompt = getSystemPrompt()

    // Build contents array with chat history
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }> = []

    // Add previous conversation turns if any
    if (req.chatHistory?.length) {
      for (const turn of req.chatHistory) {
        contents.push({
          role: turn.role,
          parts: [{ text: turn.content }],
        })
      }
    }

    // Build the user message with optional context
    let userText = req.userMessage
    if (req.contextData) {
      userText += `\n\n[FINANCIAL CONTEXT — use this data to answer queries]\n${JSON.stringify(req.contextData, null, 2)}`
    }

    const userParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: userText }]
    if (req.fileData) userParts.push({ inlineData: req.fileData })
    contents.push({ role: 'user', parts: userParts })

    const response = await withRetry((selectedModel) =>
      ai.models.generateContent({
        model: selectedModel,
        contents,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: RECORD_RESPONSE_SCHEMA,
          safetySettings: ACCOUNTING_SAFETY_SETTINGS,
        },
      })
    )

    const text = response.text ?? ''

    try {
      const data = JSON.parse(text)
      return { success: true, data, rawText: text }
    } catch {
      return { success: false, error: 'Failed to parse JSON response', rawText: text }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown Gemini error'
    return { success: false, error: message }
  }
}
