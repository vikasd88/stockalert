import { Component, OnInit, OnDestroy, HostListener, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { StockAlertService, StockAlert as BaseStockAlert, PaginatedResponse, TickerData } from '../../services/stock-alert.service';
import { AuthService } from '../../services/auth.service';
import { Subscription, finalize } from 'rxjs';
import { MarketTicker } from '../market-ticker/market-ticker';
import { GoogleAnalyticsService } from 'ngx-google-analytics';
// Extend the BaseStockAlert to properly handle index signatures
type StockAlert = {
  [K in keyof BaseStockAlert]: BaseStockAlert[K];
} & {
  [key: string]: any; // Allow any additional properties
};

// Default column settings
const DEFAULT_COLUMNS = [
  { key: 'symbol', label: 'Symbol', visible: true, order: 0, width: 'auto' },
  { key: 'tradeType', label: 'Type', visible: true, order: 1, width: '100px' },
  { key: 'ltp', label: 'Price', visible: true, order: 2, width: '100px' },
  { key: 'percentChange', label: 'Change %', visible: true, order: 3, width: '100px' },
  { key: 'volumeInWindow', label: 'Volume', visible: true, order: 4, width: '100px' },
  { key: 'thresholdVolume', label: 'Threshold', visible: true, order: 5, width: '80px' },
  { key: 'exchangeTime', label: 'Time', visible: true, order: 6, width: '150px' },
  // { key: 'openPrice', label: 'Open', visible: true, order: 7, width: '100px' },
  // { key: 'highPrice', label: 'High', visible: true, order: 8, width: '100px' },
  // { key: 'lowPrice', label: 'Low', visible: true, order: 9, width: '100px' },
  { key: 'volumePercentile', label: '%ile', visible: true, order: 11, width: '60px' },
  { key: 'delaySeconds', label: 'Delay (s)', visible: true, order: 12, width: '80px' },
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
  hoveredRow: { index: number, type: 'free' | 'premium' } | null = null;
  freeAlerts: StockAlert[] = [];
  paidAlerts: StockAlert[] = [];
  realTimeAlerts: StockAlert[] = [];
  currentTime: Date = new Date(); // Add current time for display
  tickerData: any = null;
  isPaidUser = false;
  isLoggedIn = false;
  activeTab: 'realtime' | 'free' | 'premium' = 'realtime';

  // Pagination
  private pageSize = 20; // Increased page size for better performance
  private _currentPage = 0;
  hasMore = true; // Made public for template access

  // Public getter for currentPage to be used in the template
  getCurrentPage(): number {
    return this._currentPage;
  }

  // Check if a row is being hovered
  isRowHovered(index: number, type: 'free' | 'premium'): boolean {
    return this.hoveredRow?.index === index && this.hoveredRow?.type === type;
  }

  // Handle row mouse enter
  onRowMouseEnter(index: number, type: 'free' | 'premium'): void {
    this.hoveredRow = { index, type };
  }

  // Handle row mouse leave
  onRowMouseLeave(): void {
    this.hoveredRow = null;
  }

  isLoading = false;
  private scrollDebounceTimer: any = null;
  private readonly SCROLL_DEBOUNCE = 100; // Reduced debounce time for more responsive scrolling
  private readonly SCROLL_THRESHOLD = 500; // Increased threshold to start loading earlier
  private lastLoadTime = 0;
  private readonly MIN_LOAD_INTERVAL = 1000; // Minimum time between loads in ms

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

  private ga = inject(GoogleAnalyticsService);

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
    this.isLoggedIn = this.authService.isAuthenticated();
    this.isPaidUser = this.isLoggedIn && this.authService.isSubscribed();
    // Set the default tab based on user type
    this.activeTab = this.isPaidUser ? 'premium' : 'free';
  }

  // Open chart for the given alert
  openChart(alert: StockAlert): void {
    let chartType = 'unknown';
    let url = '';

    if (alert.equityChartUrl) {
      chartType = 'equity';
      url = alert.equityChartUrl;
    } else if (alert.liveOptionChartUrl) {
      chartType = 'options';
      url = alert.liveOptionChartUrl;
    } else if (alert.futChartUrl) {
      chartType = 'futures';
      url = alert.futChartUrl;
    }

    if (url) {
      // Track the chart view event
      // this.ga.event('chart_view', 'user_interaction', 'Chart Viewed', chartType, {
      //   'symbol': alert.symbol,
      //   'chart_type': chartType
      // });

      this.redirectToExternalUrl(url);
    }
  }

  // Open screener for the given alert
  openScreener(alert: StockAlert): void {
    // Example URL - replace with your actual screener URL
    const screenerUrl = `https://www.screener.in/company/${alert.symbol}/`;

    // Track screener view event
    // this.ga.event('screener_view', 'user_interaction', 'Screener Viewed', alert.symbol, {
    //   'symbol': alert.symbol,
    //   'url': screenerUrl
    // });

    this.redirectToExternalUrl(screenerUrl);
  }

  // Open option chain for the given alert
  openOptionChain(alert: StockAlert): void {
    let url = '';

    if (alert.liveOptionChartUrl) {
      url = alert.liveOptionChartUrl;
    } else {
      // Fallback to a generic option chain URL if specific one is not available
      url = `https://www.nseindia.com/option-chain?symbol=${alert.symbol}`;
    }

    // Track option chain view event
    // this.ga.event('option_chain_view', 'user_interaction', 'Option Chain Viewed', alert.symbol, {
    //   'symbol': alert.symbol,
    //   'url': url
    // });

    this.redirectToExternalUrl(url);
  }

  // Add stock to watchlist
  addToWatchlist(alert: StockAlert): void {
    // Implement your watchlist logic here
    console.log('Adding to watchlist:', alert.symbol);

    // Track add to watchlist event
    // this.ga.event('add_to_watchlist', 'user_interaction', 'Added to Watchlist', alert.symbol, {
    //   'symbol': alert.symbol,
    //   'price': alert.ltp || 0,
    //   'change_percent': alert.percentChange || 0
    // });

    // You might want to show a toast/snackbar message
    // this.snackBar.open(`${alert.symbol} added to watchlist`, 'Close', { duration: 3000 });
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

    // Get initial auth state
    const currentUser = this.authService.getCurrentUser();
    this.isPaidUser = currentUser?.isSubscribed ?? false;

    // Set active tab based on user type
    this.activeTab = this.isPaidUser ? 'premium' : 'free';

    // Load initial data based on user subscription
    if (this.isPaidUser) {
      this.loadPaidAlerts().then(() => {
        // Setup WebSocket after initial data is loaded
        this.setupWebSocket();
      });
    } else {
      this.loadFreeAlerts(false);
      // Setup WebSocket for free users too
      this.setupWebSocket();
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

  onTableScroll(event: Event, tab: 'free' | 'premium'): void {
    // Only handle scroll events for the active tab
    if (this.isLoading || !this.hasMore || this.activeTab !== tab) {
      return;
    }

    // Prevent too frequent loading
    const now = Date.now();
    if (now - this.lastLoadTime < this.MIN_LOAD_INTERVAL) {
      return;
    }

    const table = event.target as HTMLElement;
    const scrollPosition = table.scrollTop + table.clientHeight;
    const scrollHeight = table.scrollHeight;
    const distanceFromBottom = scrollHeight - scrollPosition;

    // Clear any existing debounce timer
    if (this.scrollDebounceTimer) {
      clearTimeout(this.scrollDebounceTimer);
    }

    this.scrollDebounceTimer = setTimeout(() => {
      // Only load more if we're near the bottom of the table
      if (distanceFromBottom <= this.SCROLL_THRESHOLD) {
        console.log('Triggering load more for tab:', tab, 'distanceFromBottom:', distanceFromBottom);
        this.lastLoadTime = now;

        if (tab === 'free') {
          this.loadFreeAlerts(true);
        } else if (tab === 'premium' && this.isPaidUser) {
          this.loadPaidAlerts(true);
        }
      }
      this.scrollDebounceTimer = null;
    }, this.SCROLL_DEBOUNCE);
  }

  // Keep window scroll handler but make it less sensitive
  @HostListener('window:scroll', ['$event'])
  onWindowScroll(event: Event): void {
    // Only handle window scroll if we're near the bottom of the page and not in realtime tab
    if (this.activeTab === 'realtime') {
      return;
    }

    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollPosition = window.scrollY;
    const distanceFromBottom = documentHeight - (windowHeight + scrollPosition);

    if (distanceFromBottom > 1000) {
      return; // Only handle scrolls when near bottom of page
    }

    // Delegate to the main scroll handler with a higher threshold
    this.onTableScroll({
      target: {
        scrollTop: scrollPosition,
        clientHeight: windowHeight,
        scrollHeight: documentHeight
      }
    } as unknown as Event, this.activeTab as 'free' | 'premium');
  }

  // Scroll handler removed - infinite scroll disabled

  // Track the current page and load more when needed
  private handlePagination(response: any, loadMore: boolean): void {
    if (!response) {
      this.hasMore = false;
      return;
    }

    // Check if there are more pages
    this.hasMore = !response.last && response.content && response.content.length > 0;

    // Update current page if this is a new load
    if (!loadMore) {
      this._currentPage = response.number || 0;
    }

    console.log('Pagination - Has more:', this.hasMore, 'Current page:', this._currentPage);
  }

  private convertToStockAlert(alert: Record<string, any> & Partial<StockAlert>): StockAlert {
    console.group('Converting alert data');
    console.log('Raw API alert data:', alert);

    // Helper function to safely get numeric values
    const getNumber = (value: any, defaultValue = 0): number => {
      if (value === null || value === undefined || value === '') return defaultValue;
      const num = Number(value);
      return isNaN(num) ? defaultValue : num;
    };

    // Helper function to safely get string values
    const getString = (value: any, defaultValue = ''): string => {
      return value !== null && value !== undefined && value !== '' ? String(value) : defaultValue;
    };

    // Helper function to safely get date values
    const getDate = (value: any): string => {
      if (!value) return new Date().toISOString();
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'number') return new Date(value).toISOString();
      if (typeof value === 'string') {
        // Try to parse the date string
        const date = new Date(value);
        return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
      }
      return new Date().toISOString();
    };

    // Helper to get the first non-null/undefined value from multiple fields
    const firstValid = (...values: any[]): any => {
      return values.find(v => v !== null && v !== undefined && v !== '');
    };

    // Get current timestamp for fallback values
    const now = new Date();
    const timestamp = now.getTime();

    // Map the API response fields to our StockAlert interface
    const result: StockAlert = {
      // Required fields with fallbacks
      id: getNumber(firstValid(alert['id'], alert['alertId'], timestamp), timestamp),
      symbol: getString(firstValid(alert['symbol'], alert['stockSymbol'], 'N/A'), 'N/A').toUpperCase(),
      tradeType: getString(firstValid(alert['tradeType'], alert['type'], 'PREMIUM'), 'PREMIUM').toUpperCase(),

      // Price data with fallbacks - handle both camelCase and snake_case fields
      ltp: getNumber(firstValid(
        alert['ltp'],
        alert['lastPrice'],
        alert['last_price'],
        alert['price'],
        alert['closePrice'],
        alert['close_price']
      ), 0),

      atp: getNumber(firstValid(alert['atp'], alert['averageTradedPrice'], alert['avg_traded_price']), 0),
      openPrice: getNumber(firstValid(alert['openPrice'], alert['open_price'], alert['open']), 0),
      highPrice: getNumber(firstValid(alert['highPrice'], alert['high_price'], alert['high']), 0),
      lowPrice: getNumber(firstValid(alert['lowPrice'], alert['low_price'], alert['low']), 0),
      closePrice: getNumber(firstValid(
        alert['closePrice'],
        alert['close_price'],
        alert['close'],
        alert['prevClose'],
        alert['prev_close']
      ), 0),
      week52High: getNumber(firstValid(alert['week52High'], alert['week_52_high']), 0),
      week52Low: getNumber(firstValid(alert['week52Low'], alert['week_52_low']), 0),

      // Volume data with fallbacks - handle both camelCase and snake_case
      volumeInWindow: getNumber(firstValid(
        alert['volumeInWindow'],
        alert['volume_in_window'],
        alert['volume'],
        alert['tradedVolume'],
        alert['traded_volume']
      ), 0),

      thresholdVolume: getNumber(firstValid(alert['thresholdVolume'], alert['threshold_volume']), 0),
      volumePercentile: getNumber(firstValid(alert['volumePercentile'], alert['volume_percentile']), 0),

      // Market data with fallbacks
      exchange: getString(firstValid(alert['exchange'], alert['exchangeName'], 'NSE'), 'NSE'),
      marketCap: getNumber(firstValid(alert['marketCap'], alert['market_cap'], alert['mcap']), 0),
      peRatio: getNumber(firstValid(alert['peRatio'], alert['pe_ratio'], alert['pe']), 0),
      avgVolume: getNumber(firstValid(alert['avgVolume'], alert['average_volume'], alert['avg_volume']), 0),

      // Alert metadata with fallbacks
      percentChange: getNumber(firstValid(
        alert['percentChange'],
        alert['percent_change'],
        alert['changePercent'],
        alert['change_percent'],
        alert['pctChange'],
        alert['pct_change']
      ), 0),

      change: getNumber(firstValid(
        alert['change'],
        alert['priceChange'],
        alert['price_change']
      ), 0),

      datasource: getString(firstValid(alert['datasource'], alert['source'], 'free'), 'free'),
      alertTime: getDate(firstValid(
        alert['alertTime'],
        alert['alert_time'],
        alert['timestamp'],
        alert['time'],
        alert['createdAt'],
        alert['created_at'],
        timestamp
      )),

      exchangeTime: getDate(firstValid(
        alert['exchangeTime'],
        alert['exchange_time'],
        alert['timestamp'],
        alert['time'],
        timestamp
      )),

      delaySeconds: getNumber(firstValid(alert['delaySeconds'], alert['delay_seconds']), 0),

      // Map URLs with fallbacks
      analyzerUrl: getString(alert['analyzerUrl'], ''),
      liveOptionChartUrl: getString(alert['liveOptionChartUrl'], ''),
      futChartUrl: getString(alert['futChartUrl'], ''),
      equityChartUrl: getString(alert['equityChartUrl'], ''),
      newsUrl: getString(alert['newsUrl'], ''),
      oiUrl: getString(alert['oiUrl'], ''),

      // System fields
      createdAt: getNumber(alert['createdAt'] || alert['created_at'], timestamp),
      redisAlertKey: alert['redisAlertKey'] !== undefined ? getString(alert['redisAlertKey'], '') : null,
      redisKeyExpiry: getNumber(alert['redisKeyExpiry'] || alert['redis_key_expiry'], 0)
    };

    console.log('Converted StockAlert:', result);
    console.groupEnd();
    return result;
  }

  loadFreeAlerts(loadMore: boolean = false): void {
    console.group('loadFreeAlerts');
    console.log('loadMore:', loadMore, 'currentPage:', this._currentPage, 'hasMore:', this.hasMore);

    if (this.isLoading) {
      console.log('Skipping load - already loading');
      console.groupEnd();
      return;
    }

    // Determine the target page - increment only if we're loading more
    const targetPage = loadMore ? this._currentPage + 1 : 0;

    // Only reset the list on initial load
    if (!loadMore) {
      console.log('Initial load of free alerts');
      this._currentPage = 0;
      this.hasMore = true;
      this.freeAlerts = [];
      window.scrollTo(0, 0);
    } else {
      console.log('Loading more free alerts, page:', targetPage);
    }

    if (!this.hasMore) {
      console.log('No more free alerts to load');
      console.groupEnd();
      return;
    }

    this.isLoading = true;
    this.loading.free = true;
    this.error = null;

    console.log('Loading free alerts, page:', targetPage, 'size:', this.pageSize);

    // Store the current scroll position before loading
    const tableContainer = document.querySelector('.table-responsive');
    const scrollPosition = tableContainer ? tableContainer.scrollTop : 0;

    console.log('Calling stockAlertService.getFreeAlerts with page:', targetPage, 'size:', this.pageSize);

    // For debugging - log the current state
    console.log('Current state before API call:', {
      freeAlerts: this.freeAlerts,
      isLoading: this.isLoading,
      hasMore: this.hasMore,
      currentPage: this._currentPage
    });

    this.stockAlertService.getFreeAlerts(targetPage, this.pageSize)
      .pipe(
        finalize(() => {
          console.log('Finalizing request...');
          this.isLoading = false;
          this.loading.free = false;

          console.log('Final state:', {
            freeAlerts: this.freeAlerts,
            isLoading: this.isLoading,
            hasMore: this.hasMore,
            currentPage: this._currentPage
          });

          this.cdr.detectChanges();

          // Restore scroll position after update
          if (loadMore && tableContainer) {
            setTimeout(() => {
              tableContainer.scrollTop = scrollPosition;
            }, 0);
          }

          console.groupEnd(); // End the loadFreeAlerts group
        })
      )
      .subscribe({
        next: (response: PaginatedResponse<StockAlert>) => {
          console.group('Free Alerts Response');
          console.log('Raw response:', response);

          if (!response) {
            console.error('Empty response received');
            this.error = 'Received empty response from server';
            console.groupEnd();
            return;
          }

          // Handle case where response might be an array directly
          let alertsData = Array.isArray(response) ? response :
            (response.content || []);

          console.log('Alerts data:', alertsData);
          console.log('Number of alerts:', alertsData.length);

          if (!Array.isArray(alertsData)) {
            console.error('Invalid alerts data format:', alertsData);
            this.error = 'Invalid response format from server';
            console.groupEnd();
            return;
          }

          // Convert each alert to the correct format
          const alerts = alertsData.map(alert => {
            try {
              return this.convertToStockAlert(alert);
            } catch (error) {
              console.error('Error converting alert:', error, 'Raw alert:', alert);
              return null;
            }
          }).filter(Boolean) as StockAlert[];

          console.log('Processed alerts:', alerts);

          if (loadMore) {
            // Only append new alerts that don't already exist in the list
            const existingIds = new Set(this.freeAlerts.map(a => a.id));
            const newAlerts = alerts.filter(alert => !existingIds.has(alert.id));

            if (newAlerts.length === 0) {
              console.log('No new alerts to add');
              this.hasMore = false;
              console.groupEnd();
              return;
            }

            console.log(`Adding ${newAlerts.length} new alerts`);
            this.freeAlerts = [...this.freeAlerts, ...newAlerts];
          } else {
            console.log(`Setting ${alerts.length} alerts`);
            this.freeAlerts = alerts;
          }

          // Update pagination state based on server response
          this.hasMore = alerts.length === this.pageSize;
          this._currentPage = targetPage;

          console.log('Updated state:', {
            freeAlertsCount: this.freeAlerts.length,
            hasMore: this.hasMore,
            currentPage: this._currentPage
          });

          console.groupEnd();
        },
        error: (err: any) => {
          console.error('Error loading free alerts:', err);
          this.error = 'Failed to load free alerts. Please try again.';
          this.freeAlerts = [];
          console.groupEnd();
        }
      });
  }

  loadPaidAlerts(loadMore: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('loadPaidAlerts called, isPaidUser:', this.isPaidUser, 'loadMore:', loadMore, 'page:', this._currentPage);

      if (!this.isPaidUser) {
        console.warn('User is not a paid user, cannot load paid alerts');
        this.error = 'Premium access required to view these alerts';
        this.loading.paid = false;
        return resolve();
      }

      if (this.isLoading) {
        console.log('Already loading data, skipping...');
        return resolve();
      }

      if (loadMore && !this.hasMore) {
        console.log('No more paid alerts to load');
        return resolve();
      }

      const targetPage = loadMore ? this._currentPage + 1 : 0;

      // Only reset the list and scroll to top on initial load
      if (!loadMore) {
        console.log('Initial load of paid alerts');
        this._currentPage = 0;
        this.hasMore = true;
        this.paidAlerts = [];
        window.scrollTo(0, 0);
      } else {
        console.log('Loading more paid alerts, page:', targetPage);
      }

      this.isLoading = true;
      this.loading.paid = true;
      this.error = null;

      console.log('Loading paid alerts, page:', targetPage, 'size:', this.pageSize);

      // Store the current scroll position before loading
      const tableContainer = document.querySelector('.table-responsive');
      const scrollPosition = tableContainer ? tableContainer.scrollTop : 0;

      this.stockAlertService.getPaidAlerts(targetPage, this.pageSize)
        .pipe(
          finalize(() => {
            this.isLoading = false;
            this.loading.paid = false;
            this.cdr.detectChanges();

            // Restore scroll position after update
            if (loadMore && tableContainer) {
              setTimeout(() => {
                tableContainer.scrollTop = scrollPosition;
              }, 0);
            }
          })
        )
        .subscribe({
          next: (response: any) => {
            console.log('Received paid alerts response:', response);

            if (!response) {
              console.error('Empty response received from paid alerts API');
              this.error = 'Received empty response from server';
              return resolve();
            }

            try {
              // Handle different response formats
              let alertsArray: any[] = [];

              if (Array.isArray(response)) {
                alertsArray = response;
              } else if (response && Array.isArray(response.content)) {
                alertsArray = response.content;
              } else if (response && typeof response === 'object' && !Array.isArray(response)) {
                alertsArray = [response];
              }

              console.log('Alerts array to process:', alertsArray);

              if (alertsArray.length === 0) {
                console.warn('No alerts found in the response');
                this.hasMore = false;
                return resolve();
              }

              // Process each alert
              const alerts = alertsArray.map(alert => this.convertToStockAlert(alert));

              if (loadMore) {
                // Only append new alerts that don't already exist in the list
                const existingIds = new Set(this.paidAlerts.map(a => a.id));
                const newAlerts = alerts.filter(alert => !existingIds.has(alert.id));

                if (newAlerts.length === 0) {
                  console.log('No new paid alerts to add');
                  this.hasMore = false;
                  return resolve();
                }

                this.paidAlerts = [...this.paidAlerts, ...newAlerts];
              } else {
                this.paidAlerts = alerts;
              }

              // Update pagination state
              this.hasMore = alerts.length === this.pageSize;
              this._currentPage = targetPage;

              console.log('Updated paidAlerts count:', this.paidAlerts.length);
              console.log('hasMore:', this.hasMore, 'currentPage:', this._currentPage);

              resolve();
            } catch (error) {
              console.error('Error processing paid alerts:', error);
              this.error = 'Error processing alerts. Please try again.';
              reject(error);
            }
          },
          error: (error) => {
            console.error('Error loading paid alerts:', error);
            this.error = 'Failed to load paid alerts. Please try again.';
            reject(error);
          }
        });

      const subscription = this.stockAlertService.getPaidAlerts(this._currentPage, this.pageSize)
        .pipe(
          finalize(() => {
            this.isLoading = false;
            this.loading.paid = false;
            this.cdr.detectChanges();
          })
        )
        .subscribe({
          next: (response: any) => {
            console.group('Paid Alerts Response');
            console.log('Raw response:', response);

            if (!response) {
              console.error('Empty response received from paid alerts API');
              this.error = 'Received empty response from server';
              console.groupEnd();
              return resolve();
            }

            try {
              // Handle different response formats
              let alertsArray: any[] = [];

              if (Array.isArray(response)) {
                alertsArray = response;
              } else if (response && Array.isArray(response.content)) {
                alertsArray = response.content;
              } else if (response && typeof response === 'object' && !Array.isArray(response)) {
                alertsArray = [response];
              }

              console.log('Alerts array to process:', alertsArray);

              if (alertsArray.length === 0) {
                console.warn('No alerts found in the response');
                this.error = 'No premium alerts available at the moment. Please check back later.';
                this.paidAlerts = [];
                return resolve();
              }

              // Process each alert
              const alerts = alertsArray.map(alert => this.convertToStockAlert(alert));

              // Update the alerts array
              this.paidAlerts = loadMore
                ? [...this.paidAlerts, ...alerts]
                : [...alerts];

              // Handle pagination
              this.hasMore = response.last === false ||
                (response as any)?.hasNext ||
                (response as any)?.has_next ||
                (response.totalElements > this.paidAlerts.length);

              this._currentPage = (response as any)?.number !== undefined
                ? (response as any).number
                : this._currentPage + 1;

              console.log('Updated paidAlerts:', this.paidAlerts);
              console.log('hasMore:', this.hasMore, 'currentPage:', this._currentPage);

              if (this.paidAlerts.length === 0 && !loadMore) {
                console.log('No paid alerts found');
                this.error = 'No premium alerts available at the moment. Please check back later.';
              }

              console.groupEnd();
              resolve();
            } catch (error) {
              console.error('Error processing paid alerts:', error);
              this.error = 'Error processing alerts data. ' + (error instanceof Error ? error.message : 'Please try again.');
              console.groupEnd();
              reject(error);
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
            reject(err);
          }
        });

      // Add subscription to cleanup list
      this.subscriptions.add(subscription);
    });
  }

  setupWebSocket(): void {
    // Connect to WebSocket for both free and premium users
    this.stockAlertService.connect();

    // Subscribe to real-time alerts
    const alertSub = this.stockAlertService.messages$.subscribe({
      next: (alert: StockAlert) => {
        // Process the new alert with blinking effect for 3 minutes
        const processedAlert = this.processNewAlert(alert);

        // Add to the beginning of the premium alerts array if user is paid
        if (this.isPaidUser) {
          this.paidAlerts = [processedAlert, ...this.paidAlerts];

          // Auto-remove blinking effect after 3 minutes
          setTimeout(() => {
            const index = this.paidAlerts.findIndex(a => a.id === processedAlert.id);
            if (index !== -1) {
              this.paidAlerts = [
                ...this.paidAlerts.slice(0, index),
                { ...this.paidAlerts[index], isBlinking: false },
                ...this.paidAlerts.slice(index + 1)
              ];
              this.cdr.detectChanges();
            }
          }, 3 * 60 * 1000); // 3 minutes in milliseconds
        } else {
          // For free users, add to freeAlerts if not duplicate
          // Check if alert already exists in freeAlerts
          const exists = this.freeAlerts.some(a => a.id === processedAlert.id);

          if (!exists) {
            this.freeAlerts = [processedAlert, ...this.freeAlerts];

            // Auto-remove blinking effect after 3 minutes
            setTimeout(() => {
              const index = this.freeAlerts.findIndex(a => a.id === processedAlert.id);
              if (index !== -1) {
                this.freeAlerts = [
                  ...this.freeAlerts.slice(0, index),
                  { ...this.freeAlerts[index], isBlinking: false },
                  ...this.freeAlerts.slice(index + 1)
                ];
                this.cdr.detectChanges();
              }
            }, 3 * 60 * 1000); // 3 minutes in milliseconds
          }
        }
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

  private processNewAlert(alert: StockAlert): StockAlert {
    try {
      console.log('Processing new alert:', alert);
      const now = new Date();

      // Convert and process the alert
      const processedAlert: StockAlert = {
        ...this.convertToStockAlert(alert),
        receivedAt: now.getTime(),
        isNew: true,
        isBlinking: true
      };

      console.log('Processed alert:', processedAlert);

      // Add to realTimeAlerts if not already present
      const existingIndex = this.realTimeAlerts.findIndex(a =>
        a.symbol === processedAlert.symbol &&
        a.alertTime === processedAlert.alertTime
      );

      if (existingIndex === -1) {
        // Add to beginning of array and limit to 100 items
        this.realTimeAlerts = [processedAlert, ...this.realTimeAlerts].slice(0, 100);

        // Stop blinking after 10 seconds
        setTimeout(() => {
          this.realTimeAlerts = this.realTimeAlerts.map(a =>
            a === processedAlert ? { ...a, isBlinking: false } : a
          );
          this.cdr.detectChanges();
        }, 10000);

        // Remove 'new' status after 3 minutes
        setTimeout(() => {
          this.realTimeAlerts = this.realTimeAlerts.map(a =>
            a === processedAlert ? { ...a, isNew: false } : a
          );
          this.cdr.detectChanges();
        }, 3 * 60 * 1000);
      } else {
        console.log('Alert already exists, skipping duplicate');
      }

      return processedAlert;
    } catch (error) {
      console.error('Error processing alert:', error);
      return this.convertToStockAlert(alert);
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

  onLogin(): void {
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
