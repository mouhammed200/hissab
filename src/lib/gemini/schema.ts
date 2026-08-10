// Gemini structured output schema — matches ParsedRecord type
// Used as responseSchema in the Gemini API call

export const RECORD_RESPONSE_SCHEMA = {
  type: 'object' as const,
  properties: {
    type: {
      type: 'string' as const,
      enum: ['sale', 'purchase', 'employee', 'asset', 'relatedParty', 'query', 'action'],
    },
    subtype: {
      type: 'string' as const,
      enum: ['itemized', 'lumpSum'],
    },
    party: { type: 'string' as const },
    date: { type: 'string' as const },
    currency: {
      type: 'string' as const,
      enum: ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'INR'],
    },
    exchangeRate: { type: 'number' as const }, // CBUAE Exchange rate to AED
    amountInAED: { type: 'number' as const },  // Total converted to AED
    vatInAED: { type: 'number' as const },     // VAT 5% converted to AED (FTA rule)
    emirate: {
      type: 'string' as const,
      enum: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'],
    },
    reverseCharge: { type: 'boolean' as const },
    sellerTRN: { type: 'string' as const },
    buyerTRN: { type: 'string' as const }, // Mandatory for FTA tax invoices > AED 10,000
    invoiceNumber: { type: 'string' as const },
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          description: { type: 'string' as const },
          qty: { type: 'number' as const },
          price: { type: 'number' as const },
          discount: { type: 'number' as const },
          lineTotal: { type: 'number' as const }, // Explicit line total for arithmetic verification
          category: {
            type: 'string' as const,
            enum: ['standard', 'zero', 'exempt'],
          },
          exciseCategory: {
            type: 'string' as const,
            enum: ['tobacco', 'energyDrinks', 'eSmoking', 'sweetenedHigh', 'sweetenedMed', 'sweetenedLow', 'none'],
          },
        },
        required: ['description', 'qty', 'price', 'discount', 'category'],
      },
    },
    // Employee fields
    name: { type: 'string' as const },
    position: { type: 'string' as const },
    basicSalary: { type: 'number' as const },
    allowances: { type: 'number' as const },
    hireDate: { type: 'string' as const },
    contractType: {
      type: 'string' as const,
      enum: ['limited', 'unlimited'],
    },
    terminationReason: {
      type: 'string' as const,
      enum: ['employer', 'resignation', 'expiry'],
    },
    // Asset fields
    assetName: { type: 'string' as const },
    purchaseCost: { type: 'number' as const },
    salvageValue: { type: 'number' as const },
    usefulLifeYears: { type: 'number' as const },
    supplier: { type: 'string' as const },
    purchaseDate: { type: 'string' as const },
    // Related party fields
    relationship: { type: 'string' as const },
    transactionType: { type: 'string' as const },
    amount: { type: 'number' as const },
    isArmsLength: { type: 'boolean' as const },
    // Query response
    queryResponse: { type: 'string' as const },
    // Action
    actionType: {
      type: 'string' as const,
      enum: ['generate_pdf', 'set_recurring', 'set_budget', 'upload_bank_statement', 'file_vat_return'],
    },
    actionPayload: { type: 'object' as const },
    // Meta
    notes: { type: 'string' as const },
    confidence: { type: 'number' as const },
  },
  required: ['type'],
}
