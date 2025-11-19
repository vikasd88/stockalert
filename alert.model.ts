export interface Alert {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: Date;
  source: string;
  isPremium: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  isSubscribed: boolean;
  subscriptionDate?: Date;
  lastLogin?: Date;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'super_admin';
}

// Futures and Options Models
export interface FuturesContract {
  id: string;
  symbol: string;
  name: string;
  type: 'FUTURES';
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  openInterest: number;
  change: number;
  changePercent: number;
  bid: number;
  ask: number;
  timestamp: Date;
  expiryDate: Date;
  isPremium: boolean;
}

export interface OptionsContract {
  id: string;
  symbol: string;
  name: string;
  type: 'CALL' | 'PUT';
  strikePrice: number;
  currentPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  change: number;
  changePercent: number;
  timestamp: Date;
  expiryDate: Date;
  isPremium: boolean;
}

export type FOContract = FuturesContract | OptionsContract;

export interface MarketData {
  id: string;
  contracts: FOContract[];
  lastUpdated: Date;
  totalVolume: number;
}
