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

// Retry with exponential backoff on 429 rate limit or model fallback
async function withRetry<T>(fn: (modelName: string) => Promise<T>, maxRetries = 3): Promise<T> {
  const modelsToTry = ['gemini-3.6-flash', 'gemini-1.5-flash']
  
  for (const modelName of modelsToTry) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn(modelName)
      } catch (err: unknown) {
        const errObj = err as { status?: number; message?: string }
        const isRateLimit = errObj?.status === 429 || (errObj?.message && /429|quota|resource_exhausted/i.test(errObj.message))
        const isNotFound = errObj?.status === 404 || (errObj?.message && /404|not found|no longer available/i.test(errObj.message))

        if (isNotFound) {
          console.warn(`Model ${modelName} returned 404, trying fallback model...`)
          break // break retry loop to try next model in modelsToTry
        }
        
        if (isRateLimit && attempt < maxRetries - 1) {
          const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500
          await new Promise((res) => setTimeout(res, delayMs))
          continue
        }

        if (attempt === maxRetries - 1 && modelName === modelsToTry[modelsToTry.length - 1]) {
          throw err
        }
      }
    }
  }
  throw new Error('All Gemini model attempts failed')
}

export async function parseTransaction(req: GeminiRequest): Promise<GeminiResponse> {
  try {
    const systemPrompt = getSystemPrompt()

    // Build contents array with chat history
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []

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

    contents.push({
      role: 'user',
      parts: [{ text: userText }],
    })

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
