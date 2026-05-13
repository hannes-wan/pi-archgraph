import { Database } from '../db/connection.js';

/**
 * Calculate total price from items
 */
export function calculateTotal(items: { price: number; quantity: number }[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/**
 * Format price as currency string
 */
export function formatPrice(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Validate input data
 */
export function validateInput(data: unknown): boolean {
  return data !== null && data !== undefined;
}
