import { Component, OnInit, OnDestroy, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { StockAlertService, StockAlert as BaseStockAlert, PaginatedResponse, TickerData } from '../../services/stock-alert.service';
import { AuthService } from '../../services/auth.service';
import { Subscription, finalize } from 'rxjs';
import { MarketTicker } from '../market-ticker/market-ticker';
// Extend the BaseStockAlert to properly handle index signatures
type StockAlert = {
  [K in keyof BaseStockAlert]: BaseStockAlert[K];
} & {
  [key: string]: any; // Allow any additional properties
};

// Default column settings
const DEFAULT_COLUMNS = [
  { key: 'symbol', label: 'Symbol', visible: true, order: 0, width: '100px' },
  { key: 'tradeType', label: 'Type', visible: true, order: 1, width: '120px' },
  { key: 'ltp', label: 'Price', visible: true, order: 2, width: '100px' },
  { key: 'percentChange', label: 'Change %', visible: true, order: 3, width: '100px' },
  { key: 'volumeInWindow', label: 'Volume', visible: true, order: 4, width: '120px' },
  { key: 'thresholdVolume', label: 'Threshold', visible: true, order: 5, width: '100px' },
  { key: 'exchangeTime', label: 'Time', visible: true, order: 6, width: '150px' },
  // { key: 'openPrice', label: 'Open', visible: true, order: 7, width: '100px' },
  // { key: 'highPrice', label: 'High', visible: true, order: 8, width: '100px' },
  // { key: 'lowPrice', label: 'Low', visible: true, order: 9, width: '100px' },
  { key: 'closePrice', label: 'Close', visible: true, order: 10, width: '100px' },
  { key: 'volumePercentile', label: 'Volume %ile', visible: true, order: 11, width: '100px' },
  { key: 'delaySeconds', label: 'Delay (s)', visible: true, order: 12, width: '80px' },
  { key: 'actions', label: 'Actions', visible: true, order: 13, width: '150px' }
];

interface ColumnSettings {
  key: string;
  label: string;
  visible: boolean;
  order: number;
  width?: string;
}

@Component({
  selector: 'app-stock-alerts',
  standalone: true,
  imports: [CommonModule, MarketTicker],
  templateUrl: './stock-alerts.html',
  styleUrls: ['./stock-alerts.scss'],
  providers: [DatePipe]
})
export class StockAlerts implements OnInit, OnDestroy {
  freeAlerts: StockAlert[] = [];
  paidAlerts: StockAlert[] = [];
  realTimeAlerts: StockAlert[] = [];
  currentTime: Date = new Date(); // Add current time for display
  tickerData: any = null;
  isPaidUser = false;
  activeTab: 'realtime' | 'free' | 'premium' = 'realtime';
  
  // Pagination
  private pageSize = 20;
  private currentPage = 0;
  hasMore = true;
  isLoading = false;
  
  loading = {
    free: false,
    paid: false
  };
  error: string | null = null;
  showColumnSelector = false;
  columnSettings: ColumnSettings[] = [];
  private subscriptions = new Subscription();
  
  // Get visible columns in correct order
  get visibleColumns() {
    return this.columnSettings
      .filter(col => col.visible)
      .sort((a, b) => a.order - b.order);
  }

  constructor(
    private stockAlertService: StockAlertService,
    private authService: AuthService,
    private datePipe: DatePipe,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.checkAuthStatus();
  }

  private checkAuthStatus(): void {
    this.isPaidUser = this.authService.isAuthenticated() && this.authService.isSubscribed();
    // Set the default tab based on user type
    this.activeTab = this.isPaidUser ? 'premium' : 'free';
  }

  // Check if an alert is new (within the last 5 minutes)
  isNewAlert(alert: StockAlert): boolean {
    if (!alert?.alertTime) return false;
    const alertTime = new Date(alert.alertTime).getTime();
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return alertTime > fiveMinutesAgo;
  }


  private initializeColumns() {
    // Load saved column settings or use defaults
    try {
      const savedSettings = localStorage.getItem('columnSettings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        // Validate the saved settings
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.columnSettings = parsed;
          return;
        }
      }
      // If no valid saved settings, use defaults
      this.columnSettings = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
      this.saveColumnSettings(); // Save defaults
    } catch (error) {
      console.error('Error loading column settings:', error);
      this.columnSettings = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
      this.saveColumnSettings(); // Save defaults
    }
  }

  toggleColumnVisibility(columnKey: string) {
    const column = this.columnSettings.find(c => c.key === columnKey);
    if (column) {
      // Create a new array reference to trigger change detection
      this.columnSettings = this.columnSettings.map(col => {
        if (col.key === columnKey) {
          return { ...col, visible: !col.visible };
        }
        return col;
      });
      this.saveColumnSettings();
    }
  }

  moveColumn(columnKey: string, direction: 'up' | 'down') {
    const currentIndex = this.columnSettings.findIndex(c => c.key === columnKey);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (newIndex >= 0 && newIndex < this.columnSettings.length) {
      // Create a new array to trigger change detection
      const newSettings = [...this.columnSettings];
      
      // Swap the columns
      [newSettings[currentIndex], newSettings[newIndex]] = 
        [newSettings[newIndex], newSettings[currentIndex]];
      
      // Update the order properties
      newSettings.forEach((col, idx) => {
        col.order = idx;
      });
      
      this.columnSettings = newSettings;
      this.saveColumnSettings();
    }
  }

  resetToDefaultColumns() {
    this.columnSettings = JSON.parse(JSON.stringify(DEFAULT_COLUMNS));
    this.saveColumnSettings();
  }

  private saveColumnSettings() {
    // Reassign to trigger change detection
    this.columnSettings = [...this.columnSettings];
    localStorage.setItem('columnSettings', JSON.stringify(this.columnSettings));
  }

  ngOnInit(): void {
    // Initialize columns
    this.initializeColumns();
    
    // Initialize with real-time data
    this.setupWebSocket();
    
    // Get initial auth state
    const currentUser = this.authService.getCurrentUser();
    this.isPaidUser = currentUser?.isSubscribed ?? false;
    
    // Set active tab based on user type
    this.activeTab = this.isPaidUser ? 'premium' : 'free';
    
    // Load initial data based on user subscription
    if (this.isPaidUser) {
      this.loadPaidAlerts();
    } else {
      this.loadFreeAlerts();
    }
    
    // Subscribe to auth changes
    this.subscriptions.add(
      this.authService.authState$.subscribe((user: any) => {
        this.isPaidUser = user?.isSubscribed ?? false;
        if (this.isPaidUser && this.activeTab === 'premium') {
          this.loadPaidAlerts();
        } else if (this.activeTab === 'free') {
          this.loadFreeAlerts();
        } else if (this.activeTab === 'premium' && !this.isPaidUser) {
          // If user is not subscribed but somehow on premium tab, switch to free
          this.activeTab = 'free';
        }
      })
    );
  }
  
  private scrollDebounceTimer: any = null;
  private lastLoadPosition = 0;
  private readonly SCROLL_THRESHOLD = 1000; // pixels from bottom
  private readonly SCROLL_DEBOUNCE = 500; // Increased debounce time
  private readonly MIN_LOAD_DISTANCE = 800; // Minimum pixels to scroll before allowing next load

  @HostListener('window:scroll')
  onScroll(): void {
    // Only handle scroll events for premium tab
    if (this.activeTab !== 'premium' || !this.isPaidUser || this.isLoading || !this.hasMore) {
      return;
    }

    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollPosition = window.scrollY;
    
    // Calculate distance from bottom
    const distanceFromBottom = documentHeight - (windowHeight + scrollPosition);
    
    // Calculate how far we've scrolled since last load
    const scrollDistance = Math.abs(scrollPosition - this.lastLoadPosition);
    
    // Only check for loading more if we've scrolled a minimum distance
    if (scrollDistance < this.MIN_LOAD_DISTANCE && this.lastLoadPosition > 0) {
      return;
    }

    // Use debounce with a longer delay
    if (this.scrollDebounceTimer) {
      clearTimeout(this.scrollDebounceTimer);
    }

    this.scrollDebounceTimer = setTimeout(() => {
      // Recalculate in case scroll position changed during the debounce
      const currentScrollPosition = window.scrollY;
      const currentDistanceFromBottom = documentHeight - (windowHeight + currentScrollPosition);
      
      // Only load more if we're near the bottom and not already loading
      if (currentDistanceFromBottom < this.SCROLL_THRESHOLD) {
        console.log('Near bottom, loading more alerts...');
        this.lastLoadPosition = currentScrollPosition;
        this.loadPaidAlerts(true);
      }
      
      this.scrollDebounceTimer = null;
    }, this.SCROLL_DEBOUNCE);
  }
  
  public loadMoreAlerts(): void {
    if (this.activeTab === 'free') {
      this.loadFreeAlerts(true);
    } else if (this.activeTab === 'premium' && this.isPaidUser) {
      this.loadPaidAlerts(true);
    }
  }

  private convertToStockAlert(alert: Record<string, any> & Partial<StockAlert>): StockAlert {
    console.group('Converting alert data');
    console.log('Raw API alert data:', alert);
    
    // Helper function to safely get numeric values
    const getNumber = (value: any, defaultValue = 0): number => {
      if (value === null || value === undefined) return defaultValue;
      const num = Number(value);
      return isNaN(num) ? defaultValue : num;
    };
    
    // Helper function to safely get string values
    const getString = (value: any, defaultValue = ''): string => {
      return value !== null && value !== undefined ? String(value) : defaultValue;
    };

    // Helper function to safely get date values
    const getDate = (value: any): string => {
      if (!value) return new Date().toISOString();
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'number') return new Date(value).toISOString();
      if (typeof value === 'string') {
        const date = new Date(value);
        return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
      }
      return new Date().toISOString();
    };

    // Get current timestamp for fallback values
    const now = new Date();
    const timestamp = now.getTime();
    
    // Create a new object with all the required fields
    const result: StockAlert = {
      // Required fields with fallbacks
      id: alert.id || timestamp,
      symbol: getString(alert.symbol, 'N/A'),
      tradeType: getString(alert.tradeType, 'premium').toUpperCase(),
      
      // Price data with fallbacks
      ltp: getNumber(alert.ltp ?? alert.lastPrice ?? (alert as any).price, 0),
      atp: getNumber(alert.atp, 0),
      openPrice: getNumber(alert.openPrice ?? (alert as any).open, 0),
      highPrice: getNumber(alert.highPrice ?? (alert as any).high, 0),
      lowPrice: getNumber(alert.lowPrice ?? (alert as any).low, 0),
      closePrice: getNumber(alert.closePrice ?? (alert as any).close ?? (alert as any).prevClose, 0),
      week52High: alert.week52High !== undefined ? getNumber(alert.week52High, 0) : null,
      week52Low: alert.week52Low !== undefined ? getNumber(alert.week52Low, 0) : null,
      
      // Volume data with fallbacks
      volumeInWindow: getNumber(alert.volumeInWindow ?? (alert as any).volume, 0),
      thresholdVolume: getNumber(alert.thresholdVolume, 0),
      volumePercentile: getNumber(alert.volumePercentile, 0),
      
      // Map market data with fallbacks
      exchange: getString(alert.exchange, 'NSE'),
      marketCap: getNumber(alert.marketCap, 0),
      peRatio: getNumber(alert.peRatio, 0),
      avgVolume: getNumber(alert.avgVolume ?? (alert as any).averageVolume, 0),
      
      // Map alert metadata with fallbacks
      percentChange: getNumber(alert.percentChange ?? (alert as any).change, 0),
      change: getNumber((alert as any).change ?? alert.percentChange, 0),
      datasource: getString(alert.datasource, 'premium'),
      alertTime: getDate(alert.alertTime ?? (alert as any).timestamp ?? (alert as any).time ?? timestamp),
      exchangeTime: getDate(alert.exchangeTime ?? (alert as any).timestamp ?? (alert as any).time ?? timestamp),
      delaySeconds: getNumber(alert.delaySeconds, 0),
      
      // Map URLs with fallbacks
      analyzerUrl: getString(alert.analyzerUrl, ''),
      liveOptionChartUrl: getString(alert.liveOptionChartUrl, ''),
      futChartUrl: getString(alert.futChartUrl, ''),
      equityChartUrl: getString(alert.equityChartUrl, ''),
      newsUrl: getString(alert.newsUrl, ''),
      oiUrl: getString(alert.oiUrl, ''),
      
      // System fields
      createdAt: getNumber(alert.createdAt, timestamp),
      redisAlertKey: alert.redisAlertKey !== undefined ? getString(alert.redisAlertKey, '') : null,
      redisKeyExpiry: getNumber(alert.redisKeyExpiry, 0)
    };
    
    console.log('Converted StockAlert:', result);
    console.groupEnd();
    return result;
  }

  loadFreeAlerts(loadMore: boolean = false): void {
    if (this.isLoading) return;
    
    if (!loadMore) {
      this.currentPage = 0;
      this.hasMore = true;
      this.freeAlerts = [];
    }

    if (!this.hasMore) return;

    this.isLoading = true;
    this.loading.free = true;
    this.error = null;

    console.log('Loading free alerts, page:', this.currentPage, 'size:', this.pageSize);

    this.stockAlertService.getFreeAlerts(this.currentPage, this.pageSize)
      .pipe(
        finalize(() => {
          this.isLoading = false;
          this.loading.free = false;
        })
      )
      .subscribe({
        next: (response: PaginatedResponse<StockAlert>) => {
          console.log('Received free alerts response:', response);
          
          if (!response) {
            console.error('Empty response received');
            this.error = 'Received empty response from server';
            return;
          }

          const alerts = response.content?.map(alert => this.convertToStockAlert(alert)) || [];
          console.log('Processed alerts:', alerts);
          
          if (loadMore) {
            this.freeAlerts = [...this.freeAlerts, ...alerts];
          } else {
            this.freeAlerts = alerts;
          }
          
          this.hasMore = !response.last;
          this.currentPage = response.number + 1;
          
          console.log('Updated freeAlerts:', this.freeAlerts);
          console.log('hasMore:', this.hasMore, 'currentPage:', this.currentPage);
        },
        error: (err: any) => {
          console.error('Error loading free alerts:', err);
          this.error = 'Failed to load free alerts. Please try again.';
          this.freeAlerts = [];
        }
      });
  }

  loadPaidAlerts(loadMore: boolean = false): void {
    console.log('loadPaidAlerts called, isPaidUser:', this.isPaidUser, 'loadMore:', loadMore);
    
    if (!this.isPaidUser) {
      console.warn('User is not a paid user, cannot load paid alerts');
      this.error = 'Premium access required to view these alerts';
      return;
    }
    
    if (this.isLoading) {
      console.log('Already loading data, skipping...');
      return;
    }
    
    if (!loadMore) {
      console.log('Initial load of paid alerts');
      this.currentPage = 0;
      this.hasMore = true;
      this.paidAlerts = [];
      // Scroll to top when loading first page
      window.scrollTo(0, 0);
    } else if (!this.hasMore) {
      console.log('No more paid alerts to load');
      return;
    }

    this.isLoading = true;
    this.loading.paid = true;
    this.error = null;

    console.log('Loading paid alerts, page:', this.currentPage, 'size:', this.pageSize);

    const subscription = this.stockAlertService.getPaidAlerts(this.currentPage, this.pageSize)
      .pipe(
        finalize(() => {
          console.log('Paid alerts loading completed');
          console.log('Current paidAlerts:', this.paidAlerts);
          this.isLoading = false;
          this.loading.paid = false;
          this.cdr.detectChanges(); // Trigger change detection
          console.log('After change detection - paidAlerts:', this.paidAlerts);
        })
      )
      .subscribe({
        next: (response: any) => { // Use 'any' temporarily to avoid type errors
          console.group('Paid Alerts Response');
          console.log('Raw response:', response);
          
          if (!response) {
            console.error('Empty response received from paid alerts API');
            this.error = 'Received empty response from server';
            console.groupEnd();
            return;
          }

          console.log('Response content type:', typeof response);
          console.log('Response content:', response);
          
          try {
            // Handle different response formats
            let alertsArray: any[] = [];
            
            // Case 1: Response is an array
            if (Array.isArray(response)) {
              alertsArray = response;
            } 
            // Case 2: Response has a content property that's an array (Spring Data REST)
            else if (response && Array.isArray(response.content)) {
              alertsArray = response.content;
            }
            // Case 3: Response is a single object
            else if (response && typeof response === 'object' && !Array.isArray(response)) {
              alertsArray = [response];
            }
            
            console.log('Alerts array to process:', alertsArray);
            
            if (alertsArray.length === 0) {
              console.warn('No alerts found in the response');
              this.error = 'No premium alerts available at the moment. Please check back later.';
              this.paidAlerts = [];
              return;
            }
            
            // Process each alert
            const alerts = alertsArray.map(alert => {
              console.log('Processing alert:', alert);
              const processedAlert = this.convertToStockAlert(alert);
              console.log('Processed alert:', processedAlert);
              return processedAlert;
            });
              
            console.log(`Processed ${alerts.length} paid alerts`);
            
            // Update the alerts array
            if (loadMore) {
              console.log(`Appending ${alerts.length} alerts to existing ${this.paidAlerts.length} alerts`);
              this.paidAlerts = [...this.paidAlerts, ...alerts];
            } else {
              console.log(`Setting ${alerts.length} alerts`);
              this.paidAlerts = [...alerts]; // Create a new array to trigger change detection
            }
            
            // Handle pagination
            this.hasMore = response.last === false || 
                         (response as any)?.hasNext || 
                         (response as any)?.has_next || 
                         (response.totalElements > this.paidAlerts.length);
            
            this.currentPage = (response as any)?.number !== undefined 
              ? (response as any).number + 1 
              : this.currentPage + 1;
            
            console.log(`Updated paidAlerts:`, this.paidAlerts);
            console.log('hasMore:', this.hasMore, 'currentPage:', this.currentPage);
            
            if (this.paidAlerts.length === 0 && !loadMore) {
              console.log('No paid alerts found');
              this.error = 'No premium alerts available at the moment. Please check back later.';
            }
            
            console.groupEnd();
          } catch (error) {
            console.error('Error processing paid alerts:', error);
            this.error = 'Error processing alerts data. ' + (error instanceof Error ? error.message : 'Please try again.');
            console.groupEnd();
          }
        },
        error: (err: any) => {
          console.group('Paid Alerts Error');
          console.error('Error loading premium alerts:', err);
          
          if (err.status === 401 || err.status === 403) {
            this.error = 'Authentication required. Please log in again.';
            this.authService.logout();
            this.router.navigate(['/login']);
          } else if (err.status === 0) {
            this.error = 'Unable to connect to the server. Please check your internet connection.';
          } else if (err.status === 404) {
            this.error = 'Premium alerts endpoint not found. Please contact support.';
          } else {
            this.error = err.error?.message || 'Failed to load premium alerts. Please try again later.';
          }
          
          this.paidAlerts = [];
          console.groupEnd();
        }
      });
      
    // Add subscription to cleanup list
    this.subscriptions.add(subscription);
  }

  setupWebSocket(): void {
    this.stockAlertService.connect();
    
    // Subscribe to real-time alerts
    const alertSub = this.stockAlertService.messages$.subscribe({
      next: (alert: StockAlert) => {
        this.processNewAlert(alert);
      },
      error: (err) => {
        console.error('WebSocket alert error:', err);
      }
    });
    
    // Subscribe to ticker data
    const tickerSub = this.stockAlertService.tickerData$.subscribe({
      next: (ticker: any) => {
        this.tickerData = ticker;
      },
      error: (err) => {
        console.error('WebSocket ticker error:', err);
      }
    });
    
    this.subscriptions.add(alertSub);
    this.subscriptions.add(tickerSub);
  }

  private processNewAlert(alert: StockAlert): void {
    try {
      console.log('Processing new alert:', alert);
      // Convert and add new alert to the beginning of the array
      const convertedAlert = {
        ...this.convertToStockAlert(alert),
        receivedAt: new Date().getTime(),
        isNew: true,
        isBlinking: true
      };
      
      console.log('Converted alert:', convertedAlert);
      
      // Ensure we're not adding duplicates
      const existingIndex = this.realTimeAlerts.findIndex(a => 
        a.symbol === convertedAlert.symbol && 
        a.alertTime === convertedAlert.alertTime
      );
      
      if (existingIndex === -1) {
        this.realTimeAlerts = [convertedAlert, ...this.realTimeAlerts].slice(0, 100);
        console.log('Added new alert to realTimeAlerts. Total alerts:', this.realTimeAlerts.length);
        
        // Stop blinking after 10 seconds
        setTimeout(() => {
          this.realTimeAlerts = this.realTimeAlerts.map(a => 
            a === convertedAlert ? { ...a, isBlinking: false } : a
          );
          this.cdr.detectChanges();
        }, 10000); // 10 seconds
        
        // Remove the 'new' class after 3 minutes
        setTimeout(() => {
          this.realTimeAlerts = this.realTimeAlerts.map(a => 
            a === convertedAlert ? { ...a, isNew: false } : a
          );
          this.cdr.detectChanges();
        }, 3 * 60 * 1000); // 3 minutes
      } else {
        console.log('Alert already exists, skipping duplicate');
      }
    } catch (error) {
      console.error('Error processing new alert:', error, 'Alert data:', alert);
    }
  }

  formatDateTime(timestamp: string | number | Date): string {
    if (!timestamp) return 'N/A';
    
    try {
      // If it's a Unix timestamp (in seconds), convert to milliseconds
      if (typeof timestamp === 'number') {
        // Check if it's in seconds (10 digits) or milliseconds (13 digits)
        const date = timestamp.toString().length === 10 
          ? new Date(timestamp * 1000) 
          : new Date(timestamp);
        return this.datePipe.transform(date, 'MMM d, y, h:mm:ss a') || 'Invalid date';
      }
      // If it's already a Date object or ISO string
      return this.datePipe.transform(timestamp, 'MMM d, y, h:mm:ss a') || 'Invalid date';
    } catch (e) {
      console.error('Error formatting date:', e);
      return 'Invalid date';
    }
  }

  getPriceChangeClass(alert: StockAlert): string {
    if (alert.percentChange > 0) return 'price-up';
    if (alert.percentChange < 0) return 'price-down';
    return '';
  }

  getVolumeStatus(alert: StockAlert): { class: string, text: string } {
    const volumeRatio = alert.volumeInWindow / alert.thresholdVolume;
    
    if (volumeRatio >= 2) return { class: 'volume-high', text: 'Very High' };
    if (volumeRatio >= 1.5) return { class: 'volume-medium', text: 'High' };
    if (volumeRatio >= 1) return { class: 'volume-low', text: 'Elevated' };
    
    return { class: '', text: 'Normal' };
  }

  toggleSubscription(): void {
    this.isPaidUser = !this.isPaidUser;
    if (this.isPaidUser) {
      this.loadPaidAlerts();
    } else {
      this.paidAlerts = [];
    }
  }

  setActiveTab(tab: 'realtime' | 'free' | 'premium'): void {
    console.log('Switching to tab:', tab, 'Current isPaidUser:', this.isPaidUser);
    
    // Only proceed if the tab is actually changing
    if (this.activeTab === tab) {
      console.log('Tab is already active, skipping...');
      return;
    }
    
    this.activeTab = tab;
    
    // Clear any previous errors
    this.error = null;
    
    // Load data based on the selected tab
    switch (tab) {
      case 'free':
        console.log('Loading free alerts...');
        this.loadFreeAlerts();
        break;
        
      case 'premium':
        if (this.isPaidUser) {
          console.log('Loading premium alerts...');
          this.loadPaidAlerts();
        } else {
          console.warn('User is not a paid user, cannot load premium alerts');
          this.error = 'Premium subscription required to view premium alerts';
        }
        break;
        
      case 'realtime':
        // No need to load data for realtime tab as it's handled by WebSocket
        console.log('Switched to real-time tab');
        break;
    }
  }

  onLogout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  getAlertValue(alert: StockAlert, key: string): any {
    if (!alert) return 'N/A';
    
    try {
      // Special handling for nested or renamed fields
      const fieldMap: Record<string, string> = {
        'symbol': 'symbol',
        'type': 'tradeType',
        'price': 'ltp',
        'change': 'percentChange',
        'volume': 'volumeInWindow',
        'time': 'exchangeTime'
      };
      
      // Get the actual field name from our mapping or use the key as is
      const fieldName = fieldMap[key] || key;
      
      // Get the value (case-insensitive)
      const value = (alert as any)[fieldName] ?? 
                  Object.entries(alert).find(([k]) => 
                    k.toLowerCase() === fieldName.toLowerCase()
                  )?.[1];
      
      // Handle null/undefined/empty values
      if (value === undefined || value === null || value === '') {
        return '—';
      }
      
      // Format numbers with appropriate decimal places
      if (typeof value === 'number') {
        // For prices, add ₹ symbol and 2 decimal places
        if (['ltp', 'atp', 'openPrice', 'highPrice', 'lowPrice', 'closePrice', 'week52High', 'week52Low'].includes(fieldName)) {
          return `₹${value.toFixed(2)}`;
        }
        
        // For percentages, add % symbol and 2 decimal places
        if (fieldName === 'percentChange' || fieldName === 'volumePercentile') {
          return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
        }
        
        // For volume and counts, add thousand separators
        if (fieldName.includes('volume') || fieldName.includes('Volume') || fieldName === 'thresholdVolume' || fieldName === 'volumeInWindow') {
          return value.toLocaleString();
        }
        
        // For delay in seconds, show as integer
        if (fieldName === 'delaySeconds') {
          return Math.round(value);
        }
        
        // Default number formatting with 2 decimal places
        return value.toFixed(2);
      }
      
      // Format dates
      if (fieldName.toLowerCase().includes('time') || fieldName.toLowerCase().includes('date')) {
        return this.formatDateTime(value);
      }
      
      // Handle URL fields
      if (fieldName.endsWith('Url')) {
        return value ? '🔗' : '—';
      }
      
      // Handle boolean values
      if (typeof value === 'boolean') {
        return value ? '✓' : '✗';
      }
      
      // Default case - return as is
      return value;
    } catch (error: any) {
      console.error(`Error getting value for ${key}:`, error);
      return '—';
    }
  }


  ngOnDestroy(): void {
    // Clean up subscriptions
    if (this.subscriptions) {
      this.subscriptions.unsubscribe();
    }
    
    // Disconnect WebSocket if connected
    if (this.stockAlertService) {
      this.stockAlertService.disconnect();
    }
  }

   /**
   * Redirects to an external URL while hiding the referrer.
   * @param url The external URL to navigate to.
   */
   redirectToExternalUrl(url: string): void {
    if (!url) return;
    
    // Create a temporary link element
    const link = document.createElement('a');
    link.href = url;
    
    // Set rel="noreferrer" to hide the referrer information
    link.rel = 'noreferrer';
    
    // Programmatically click the link to trigger navigation
    // This is a common technique to ensure the rel attribute is respected
    // and is more reliable than window.open with a blank target.
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

}
