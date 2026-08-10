export const CURRENCIES: Record<string, { symbol: string; name: string; rate: number }> = {
  AED: { symbol: 'AED', name: 'UAE Dirham', rate: 1 },
  USD: { symbol: 'USD', name: 'US Dollar', rate: 3.6725 },
  EUR: { symbol: 'EUR', name: 'Euro', rate: 4.02 },
  GBP: { symbol: 'GBP', name: 'British Pound', rate: 4.65 },
  SAR: { symbol: 'SAR', name: 'Saudi Riyal', rate: 0.9793 },
  INR: { symbol: 'INR', name: 'Indian Rupee', rate: 0.0437 },
}

export const toAED = (amount: number, currency = 'AED'): number =>
  (Number(amount) || 0) * (CURRENCIES[currency]?.rate || 1)

export const fromAED = (aedAmount: number, currency = 'AED'): number =>
  (Number(aedAmount) || 0) / (CURRENCIES[currency]?.rate || 1)
