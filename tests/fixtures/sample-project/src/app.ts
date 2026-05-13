import { Database } from './db/connection.js';
import { calculateTotal, formatPrice } from './utils/helper.js';

/**
 * Main application class
 */
export class App {
  private db: Database;
  private name: string;

  constructor(name: string = 'ArchGraph Sample') {
    this.name = name;
    this.db = new Database();
  }

  start(): void {
    this.db.connect();
    console.log(`App "${this.name}" started`);
  }

  stop(): void {
    this.db.disconnect();
    console.log(`App "${this.name}" stopped`);
  }

  getDatabase(): Database {
    return this.db;
  }

  /**
   * Process an order and return formatted total
   */
  processOrder(items: { price: number; quantity: number }[]): string {
    const total = calculateTotal(items);
    return formatPrice(total);
  }
}

export { Database, calculateTotal, formatPrice };
