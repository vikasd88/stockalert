
export interface User {
  id: string;
  email: string;
  name: string;
  isSubscribed: boolean;
  subscriptionDate?: Date;
  lastLogin?: Date;
}


// Volume Spike Alert Model - Based on database structure
export interface VolumeSpikeAlert {
  id: number;
  symbol: string;
  trade_type: string;                    // FUTURES, OPTIONS, EQUITY
  volume_in_window: number;              // Volume in the current window
  threshold_volume: number;              // Threshold volume
  percent_change: number;                // Percentage change
  delay_seconds: number;                 // Delay in seconds
  alert_time: Date;                      // When alert was generated
  exchange_time: Date;                   // Exchange timestamp
  ltp: number;                           // Last Traded Price
  atp: number;                           // Average Traded Price
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  week_52_high: number;
  week_52_low: number;
  analyzer_url: string;
  live_option_chart_url: string;
  fut_chart_url: string;
  equity_chart_url: string;
  news_url: string;
  oi_url: string;
  datasource: string;                    // Data source identifier
  created_at: Date;
  isNew?: boolean;                       // Flag for newly received data (for blinking)
  isHighVolume?: boolean;                // Flag for high volume alerts
}

export interface TimeFilter {
  label: string;
  value: number;                         // Minutes
}

export interface FilteredAlertData {
  socketData: VolumeSpikeAlert[];        // Real-time data from WebSocket
  apiData: VolumeSpikeAlert[];           // Historical data from API
}
