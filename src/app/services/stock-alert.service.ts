import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, Subject, throwError, BehaviorSubject, ReplaySubject, of, Subscription } from 'rxjs';
import { catchError, tap, retry, switchMap, delay, retryWhen, finalize, map } from 'rxjs/operators';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';

export interface PaginatedResponse<T> {
  content: T[];
  pageable: {
    sort: {
      empty: boolean;
      sorted: boolean;
      unsorted: boolean;
    };
    offset: number;
    pageNumber: number;
    pageSize: number;
    paged: boolean;
    unpaged: boolean;
  };
  last: boolean;
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
  sort: {
    empty: boolean;
    sorted: boolean;
    unsorted: boolean;
  };
  first: boolean;
  numberOfElements: number;
  empty: boolean;
}

// API URLs are now defined in the service class below

// Add CORS headers
const httpOptions = {
  headers: new HttpHeaders({
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  })
};

export interface StockAlert {
  // Core fields
  id: number;
  symbol: string;
  tradeType: string;
  
  // Price data
  ltp: number;
  lastPrice?: number;
  atp: number;
  openPrice: number;
  open?: number;
  highPrice: number;
  high?: number;
  lowPrice: number;
  low?: number;
  closePrice: number;
  close?: number;
  prevClose?: number;
  week52High: number | null;
  week52Low: number | null;
  
  // Volume data
  volumeInWindow: number;
  thresholdVolume: number;
  volumePercentile: number | string;
  
  // Market data
  exchange?: string;
  marketCap?: number;
  peRatio?: number;
  avgVolume?: number;
  
  // Alert metadata
  percentChange: number;
  change?: number;
  datasource: string;
  alertTime: number | string | Date;
  exchangeTime: number | string | Date;
  delaySeconds: number;
  
  // URLs
  analyzerUrl: string;
  liveOptionChartUrl: string;
  futChartUrl: string;
  equityChartUrl: string;
  newsUrl: string;
  oiUrl: string;
  
  // System fields
  createdAt?: number;
  redisAlertKey?: string | null;
  redisKeyExpiry?: number;
  
  // UI state
  isBlinking?: boolean;
  isNew?: boolean;
  receivedAt?: number;
  
  // Allow any other properties
  [key: string]: any;
}

export interface TickerData {
  title: string;
  type: string;
  lastPrice: number;
  changePercent: number;
  receivedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class StockAlertService {
  // Static WebSocket properties
  private static socketSubscription: Subscription | null = null;
  private static socket$: WebSocketSubject<any> | null = null;
  private static messageSubject = new ReplaySubject<StockAlert>(50);
  private static tickerSubject = new ReplaySubject<TickerData>(10);
  
  // Instance properties
  public messages$ = StockAlertService.messageSubject.asObservable();
  public tickerData$ = StockAlertService.tickerSubject.asObservable();
  
  // Reconnection properties
  private static reconnectAttempts = 0;
  private static maxReconnectAttempts = 5;
  private static isConnected = false;
  private static connectionInProgress = false;
  private static reconnectTimeout: any = null;
  private static connectionCallbacks: (() => void)[] = [];
  
  // Track active subscriptions
  private static activeSubscriptions = 0;

  // API base URLs
  private readonly API_BASE_URL = '/api';  // Using relative path for proxy
  private readonly WS_URL = '/ws';        // WebSocket relative path for proxy
  private pingInterval: any;
  private pingTimeout: any;
  private lastPingTime: number = 0;
  private lastPongTime: number = 0;
  private static instance: StockAlertService | null = null;
  
  constructor(private http: HttpClient) {
    // Return the existing instance if it exists
    if (StockAlertService.instance) {
      return StockAlertService.instance;
    }
    
    // Otherwise, create a new instance
    StockAlertService.instance = this;
  }
  // Implement OnDestroy interface
  ngOnDestroy(): void {
    // Clean up the singleton instance
    if (StockAlertService.instance === this) {
      StockAlertService.instance = null;
    }
    
    // Clean up intervals and timeouts
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
    
    this.disconnect();
  }

  // REST API Methods
  
  /**
   * Set an alert for a stock
   * @param alertData The alert data to set
   * @returns Observable with the created/updated alert
   */
  setAlert(alertData: { symbol: string; price: number; condition: string; isActive: boolean }): Observable<StockAlert> {
    const url = `${this.API_BASE_URL}/set`;
    return this.http.post<StockAlert>(url, alertData, httpOptions).pipe(
      catchError(this.handleError)
    );
  }

  getFreeAlerts(page: number = 0, size: number = 10): Observable<PaginatedResponse<StockAlert>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('size', size.toString());

    const url = `${this.API_BASE_URL}/free`;
    console.log('Fetching free alerts from:', url);
    
    return this.http.get<PaginatedResponse<StockAlert>>(url, {
      headers: new HttpHeaders({
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }),
      params,
      withCredentials: true
    }).pipe(
      tap(response => {
        console.log('Free alerts response received');
        if (!response) {
          throw new Error('Empty response received');
        }
      }),
      catchError(error => {
        console.error('Error in getFreeAlerts:', error);
        // Return an empty response to prevent breaking the UI
        const emptyResponse: PaginatedResponse<StockAlert> = {
          content: [],
          pageable: {
            sort: { empty: true, sorted: false, unsorted: true },
            offset: page * size,
            pageNumber: page,
            pageSize: size,
            paged: true,
            unpaged: false
          },
          last: true,
          totalPages: 0,
          totalElements: 0,
          size: size,
          number: page,
          sort: { empty: true, sorted: false, unsorted: true },
          first: page === 0,
          numberOfElements: 0,
          empty: true
        };
        return of(emptyResponse);
      }),
      retry(2)
    );
  }

  getPaidAlerts(page: number = 0, size: number = 20, sort: string = 'alertTime,desc'): Observable<PaginatedResponse<StockAlert>> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('size', size.toString())
      .set('sort', sort);

    console.log(`Fetching paid alerts - Page: ${page}, Size: ${size}, Sort: ${sort}`);

    return this.http.get<any>(
      `${this.API_BASE_URL}/paid`,
      {
        ...httpOptions,
        params,
        headers: new HttpHeaders({
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        })
      }
    ).pipe(
      map(response => {
        console.log('Raw paid alerts response:', response);
        
        // Handle case where response is the array directly
        if (Array.isArray(response)) {
          console.log('Response is an array, converting to paginated format');
          return this.createPaginatedResponse(response, page, size);
        }
        
        // Handle case where response is an object with a data property containing the array
        if (response && Array.isArray(response.data)) {
          console.log('Response contains data array, converting to paginated format');
          return this.createPaginatedResponse(response.data, page, size);
        }
        
        // Handle case where response is already in PaginatedResponse format
        if (response && Array.isArray(response.content)) {
          console.log('Response is in PaginatedResponse format');
          return response as PaginatedResponse<StockAlert>;
        }
        
        console.warn('Unexpected response format, returning empty result');
        return this.createPaginatedResponse([], page, size);
      }),
      retry(2),
      catchError(error => {
        console.error('Error in getPaidAlerts:', error);
        if (error.status === 401 || error.status === 403) {
          console.warn('Authentication/Authorization failed');
        }
        return throwError(() => error);
      })
    );
  }

  private createPaginatedResponse(alerts: any[], page: number, size: number): PaginatedResponse<StockAlert> {
    return {
      content: alerts,
      pageable: {
        sort: { empty: true, sorted: false, unsorted: true },
        offset: page * size,
        pageNumber: page,
        pageSize: size,
        paged: true,
        unpaged: false
      },
      last: alerts.length < size,
      totalPages: Math.ceil(alerts.length / size) || 1,
      totalElements: alerts.length,
      size: size,
      number: page,
      sort: { empty: true, sorted: false, unsorted: true },
      first: page === 0,
      numberOfElements: alerts.length,
      empty: alerts.length === 0
    };
  }

  // WebSocket Methods
  connect(): void {
    if (StockAlertService.connectionInProgress) {
      console.log('WebSocket connection already in progress');
      return;
    }

    if (StockAlertService.socket$ && !StockAlertService.socket$.closed) {
      console.log('WebSocket already connected');
      return;
    }

    StockAlertService.connectionInProgress = true;
    console.log('Attempting to connect to WebSocket...');

    try {
      // Close existing connection if any
      if (StockAlertService.socket$ && !StockAlertService.socket$.closed) {
        StockAlertService.socket$.complete();
        StockAlertService.socket$ = null;
      }

      // Clear any existing reconnect timeout
      if (StockAlertService.reconnectTimeout) {
        clearTimeout(StockAlertService.reconnectTimeout);
        StockAlertService.reconnectTimeout = null;
      }

      // Configure WebSocket with custom serializer/deserializer to handle raw messages
      StockAlertService.socket$ = webSocket({
        url: this.WS_URL,
        // Disable automatic JSON parsing
        deserializer: (e: MessageEvent) => e.data,
        // Send raw messages as is
        serializer: (value: any) => {
          if (typeof value === 'string') return value;
          return JSON.stringify(value);
        },
        openObserver: {
          next: () => {
            console.log('WebSocket connection established');
            StockAlertService.isConnected = true;
            StockAlertService.connectionInProgress = false;
            StockAlertService.reconnectAttempts = 0;
            
            // Start ping interval
            this.setupPing();
            
            // Notify all pending callbacks
            const callbacks = [...StockAlertService.connectionCallbacks];
            StockAlertService.connectionCallbacks = [];
            callbacks.forEach(callback => {
              try {
                callback();
              } catch (err) {
                console.error('Error in WebSocket connection callback:', err);
              }
            });
          }
        },
        closeObserver: {
          next: (event: CloseEvent) => {
            console.log('WebSocket connection closed', event);
            StockAlertService.isConnected = false;
            StockAlertService.connectionInProgress = false;
            this.handleWebSocketClose();
          }
        },
        binaryType: 'arraybuffer'
      });

      // Unsubscribe from previous subscription if exists
      if (StockAlertService.socketSubscription) {
        StockAlertService.socketSubscription.unsubscribe();
      }

      StockAlertService.socketSubscription = StockAlertService.socket$.subscribe({
        next: (data) => {
          try {
            this.handleWebSocketMessage(data);
          } catch (err) {
            console.error('Error handling WebSocket message:', err);
          }
        },
        error: (error) => {
          console.error('WebSocket error:', error);
          this.handleWebSocketError(error);
        },
        complete: () => {
          console.log('WebSocket connection completed');
          StockAlertService.isConnected = false;
          StockAlertService.connectionInProgress = false;
          
          // Clear ping interval on connection close
          if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
          }
          
          // Attempt to reconnect if not explicitly disconnected
          if (StockAlertService.activeSubscriptions > 0) {
            console.log('WebSocket connection lost, will attempt to reconnect...');
            this.attemptReconnect();
          }
        }
      });

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      StockAlertService.connectionInProgress = false;
      this.handleWebSocketError(error);
      
      // Attempt to reconnect on error
      if (StockAlertService.activeSubscriptions > 0) {
        this.attemptReconnect();
      }
    }
  }

  private formatAlertData(data: any): StockAlert {
    if (!data) {
      throw new Error('No data provided to formatAlertData');
    }

    // Helper function to safely parse timestamps
    const parseTimestamp = (ts: any): number => {
      if (ts === undefined || ts === null) return Date.now();
      // If it's a number, assume it's a Unix timestamp in seconds
      if (typeof ts === 'number') {
        return ts.toString().length === 10 ? ts * 1000 : ts;
      }
      // If it's a string that can be parsed as a number
      if (typeof ts === 'string' && /^\d+$/.test(ts)) {
        return ts.length === 10 ? parseInt(ts) * 1000 : parseInt(ts);
      }
      // If it's a date string, parse it
      const date = new Date(ts);
      return isNaN(date.getTime()) ? Date.now() : date.getTime();
    };

    // Parse timestamps
    const alertTime = parseTimestamp(data.alertTime);
    const exchangeTime = parseTimestamp(data.exchangeTime);
    const createdAt = parseTimestamp(data.createdAt);

    return {
      id: data.id || 0,
      symbol: data.symbol || '',
      tradeType: data.tradeType || 'BUY',
      volumeInWindow: Number(data.volumeInWindow) || 0,
      thresholdVolume: Number(data.thresholdVolume) || 0,
      percentChange: Number(data.percentChange) || 0,
      delaySeconds: Number(data.delaySeconds) || 0,
      alertTime,
      exchangeTime,
      ltp: Number(data.ltp) || 0,
      atp: Number(data.atp) || 0,
      openPrice: Number(data.openPrice) || 0,
      highPrice: Number(data.highPrice) || 0,
      lowPrice: Number(data.lowPrice) || 0,
      closePrice: Number(data.closePrice) || 0,
      week52High: data.week52High ? Number(data.week52High) : null,
      week52Low: data.week52Low ? Number(data.week52Low) : null,
      volumePercentile: data.volumePercentile || '0%',
      analyzerUrl: data.analyzerUrl || '',
      liveOptionChartUrl: data.liveOptionChartUrl || '',
      futChartUrl: data.futChartUrl || '',
      equityChartUrl: data.equityChartUrl || '',
      newsUrl: data.newsUrl || '',
      oiUrl: data.oiUrl || '',
      datasource: data.datasource || 'NSE',
      createdAt,
      redisAlertKey: data.redisAlertKey || null,
      redisKeyExpiry: Number(data.redisKeyExpiry) || 0,
      // Include any additional fields from the original data
      ...data
    };
  }

  private handlePing(timestamp?: number): void {
    if (StockAlertService.socket$ && !StockAlertService.socket$.closed) {
      try {
        const pongMsg = {
          type: 'pong',
          timestamp: timestamp || Date.now(),
          serverTime: new Date().toISOString()
        };
        // Use the WebSocketSubject's next method to send the message
        StockAlertService.socket$.next(pongMsg);
        console.log('Ping received, pong sent at', pongMsg.serverTime);
      } catch (err) {
        console.error('Error sending pong:', err);
        this.handleWebSocketError(err);
      }
    }
  }


  private handlePong(timestamp?: number): void {
    this.lastPongTime = timestamp || Date.now();
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
    const latency = timestamp ? `Latency: ${Date.now() - timestamp}ms` : '';
    console.log('Pong received at', new Date().toISOString(), latency);
  }

  private setupPing(): void {
    // Clear any existing intervals and timeouts
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }

    // Reset last pong time
    this.lastPongTime = Date.now();

    // Send ping every 15 seconds
    const PING_INTERVAL = 15000; // 15 seconds
    const PONG_TIMEOUT = 10000;  // 10 seconds
    const STALE_CONNECTION_THRESHOLD = 15000; // 15 seconds

    this.pingInterval = setInterval(() => {
      if (StockAlertService.socket$ && !StockAlertService.socket$.closed && StockAlertService.isConnected) {
        try {
          const pingTime = Date.now();
          const pingMsg = { type: 'ping', timestamp: pingTime };
          
          // Send ping using the WebSocketSubject's next method
          StockAlertService.socket$.next(pingMsg);
          console.log(`[${new Date().toISOString()}] Ping sent`);
          
          // Set a timeout to check for pong response
          this.pingTimeout = setTimeout(() => {
            const timeSinceLastPong = Date.now() - this.lastPongTime;
            if (timeSinceLastPong > STALE_CONNECTION_THRESHOLD) {
              console.warn(`[${new Date().toISOString()}] No pong received in time. Last pong was ${timeSinceLastPong}ms ago`);
              this.handleWebSocketError(new Error(`Ping timeout - no pong received in ${timeSinceLastPong}ms`));
            }
          }, PONG_TIMEOUT);
          
        } catch (err) {
          console.error(`[${new Date().toISOString()}] Error in ping mechanism:`, err);
          this.handleWebSocketError(err);
        }
      }
    }, PING_INTERVAL);
  }

  private attemptReconnect(): void {
    if (StockAlertService.reconnectAttempts < StockAlertService.maxReconnectAttempts) {
      StockAlertService.reconnectAttempts++;
      const delay = 1000 * Math.pow(1.5, StockAlertService.reconnectAttempts - 1);
      
      console.log(`Attempting to reconnect (${StockAlertService.reconnectAttempts}/${StockAlertService.maxReconnectAttempts}) in ${delay}ms...`);
      
      setTimeout(() => {
        this.connect();
      }, Math.min(delay, 30000)); // Max 30 seconds delay
    } else {
      console.error('Max reconnection attempts reached. Please refresh the page to try again.');
    }
  }

  sendMessage(message: any): void {
    if (StockAlertService.socket$ && !StockAlertService.socket$.closed) {
      try {
        // The WebSocketSubject will handle the serialization based on our custom serializer
        StockAlertService.socket$.next(message);
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        this.handleWebSocketError(error);
      }
    } else {
      console.warn('WebSocket is not connected. Message not sent:', message);
      this.connect(); // Try to reconnect if not connected
    }
  }

  private handleError = (error: HttpErrorResponse | ErrorEvent | any): Observable<never> => {
    let errorMessage = 'An unexpected error occurred';
    let errorDetails: any = {};
    
    // Log the full error for debugging
    console.error('API Error:', error);
    
    if (error instanceof HttpErrorResponse) {
      // Server-side error
      errorMessage = `Server returned code ${error.status}: ${error.statusText}`;
      errorDetails = {
        status: error.status,
        message: error.message,
        error: error.error
      };
      
      // Handle specific HTTP error codes
      if (error.status === 0) {
        errorMessage = 'Unable to connect to the server. Please check your internet connection.';
      } else if (error.status === 401) {
        errorMessage = 'Authentication required. Please log in again.';
      } else if (error.status === 403) {
        errorMessage = 'You do not have permission to access this resource.';
      } else if (error.status === 404) {
        errorMessage = 'The requested resource was not found.';
      } else if (error.status >= 500) {
        errorMessage = 'A server error occurred. Please try again later.';
      }
    } else if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Error: ${error.error.message}`;
      errorDetails = {
        type: 'Client-side error',
        message: error.error.message
      };
    } else {
      // Other errors
      errorMessage = error.message || 'An unknown error occurred';
      errorDetails = error;
    }
    
    // Log detailed error information
    console.error('Error details:', {
      message: errorMessage,
      details: errorDetails,
      timestamp: new Date().toISOString()
    });

    if (error instanceof HttpErrorResponse) {
      // Server-side error
      errorDetails = {
        status: error.status,
        message: error.message,
        url: error.url,
        error: error.error
      };

      switch (error.status) {
        case 0:
          errorMessage = 'Unable to connect to the server. Please check your internet connection.';
          break;
        case 401:
          errorMessage = 'Authentication required. Please log in again.';
          break;
        case 403:
          errorMessage = 'You do not have permission to access this resource.';
          break;
        case 404:
          errorMessage = 'The requested resource was not found.';
          break;
        case 500:
          errorMessage = 'Internal server error. Please try again later.';
          break;
        default:
          errorMessage = `Server returned code ${error.status}: ${error.statusText}`;
      }
    } else if (error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `An error occurred: ${error.message}`;
      errorDetails = { message: error.message };
    } else if (error.message) {
      // Other error types with message
      errorMessage = error.message;
      errorDetails = error;
    }

    console.error('Error details:', errorDetails);
    return throwError(() => new Error(errorMessage));
  }

  private handleWebSocketClose(): void {
    console.log('WebSocket connection closed');
    StockAlertService.isConnected = false;
    
    // Clear ping interval and timeout
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
    
    // Attempt to reconnect if we have active subscriptions
    if (StockAlertService.activeSubscriptions > 0) {
      console.log('Attempting to reconnect...');
      this.reconnect();
    }
  }

  private handleWebSocketError(error: any): void {
    console.error('WebSocket error:', error);
    
    // If we're not already trying to reconnect, attempt to reconnect
    if (!StockAlertService.connectionInProgress && StockAlertService.activeSubscriptions > 0) {
      console.log('Attempting to reconnect after error...');
      this.reconnect();
    }
  }

  private handleTickerMessage(tickerData: unknown): void {
    if (!tickerData) {
      console.warn('Received empty ticker data');
      return;
    }

    try {
      const data = (typeof tickerData === 'object' && tickerData !== null && 'data' in tickerData)
        ? (tickerData as { data: unknown }).data
        : tickerData;

      if (data && typeof data === 'object') {
        const ticker: TickerData = {
          title: (data as any).title || 'N/A',
          type: (data as any).type || 'unknown',
          lastPrice: Number((data as any).lastPrice) || 0,
          changePercent: Number((data as any).changePercent) || 0,
          receivedAt: new Date().toISOString()
        };
        StockAlertService.tickerSubject.next(ticker);
      }
    } catch (error) {
      console.error('Error processing ticker message:', error, 'Raw data:', tickerData);
    }
  }

  private handleWebSocketMessage(data: any): void {
    try {
      // Handle string messages (raw WebSocket messages)
      if (typeof data === 'string') {
        if (data.trim() === 'ping') {
          this.handlePong();
          return;
        }

        // Try to parse as JSON if it's not a simple ping/pong
        try {
          const parsedData = JSON.parse(data);
          this.processParsedMessage(parsedData);
          return;
        } catch (parseError) {
          console.warn('Failed to parse WebSocket message as JSON:', parseError, 'Raw data:', data);
          return;
        }
      } else if (data && typeof data === 'object') {
        // Handle already-parsed JSON
        this.processParsedMessage(data);
        return;
      }
      
      console.warn('Unhandled WebSocket message format:', data);
    } catch (error) {
      console.error('Error processing WebSocket message:', error, 'Raw data:', data);
      this.handleWebSocketError(error);
    }
  }

  private processParsedMessage(parsedData: any): void {
    if (!parsedData) {
      console.warn('Received empty or invalid message data');
      return;
    }
    
    // Handle ping/pong messages
    if (parsedData.type === 'ping') {
      const timestamp = 'timestamp' in parsedData ? parsedData.timestamp : undefined;
      this.handlePing(timestamp);
      return;
    }

    if (parsedData.type === 'pong') {
      const timestamp = 'timestamp' in parsedData ? parsedData.timestamp : undefined;
      this.handlePong(timestamp);
      return;
    }

    // Handle other message types
    if (parsedData.type) {
      switch (parsedData.type) {
        case 'alert':
          this.handleAlertMessage(parsedData);
          break;
        case 'ticker':
          this.handleTickerMessage(parsedData);
          break;
        default:
          console.warn('Unknown message type:', parsedData.type, 'Data:', parsedData);
      }
    } else {
      console.warn('Received message without type:', parsedData);
    }
  }

  // ... (rest of the code remains the same)

  private handleAlertMessage(alertData: unknown): void {
    if (!alertData) {
      console.warn('Received empty alert data');
      return;
    }

    try {
      const data = (typeof alertData === 'object' && alertData !== null && 'data' in alertData)
        ? (alertData as { data: unknown }).data
        : alertData;

      const alert = this.formatAlertData(data as Record<string, unknown>);
      StockAlertService.messageSubject.next(alert);
    } catch (error) {
      console.error('Error processing alert message:', error, 'Raw data:', alertData);
    }
  }

  // ... (rest of the code remains the same)

  private reconnect(): void {
    if (StockAlertService.reconnectAttempts >= StockAlertService.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached. Please refresh the page to try again.');
      return;
    }

    // Don't try to reconnect if we don't have active subscriptions
    if (StockAlertService.activeSubscriptions <= 0) {
      console.log('No active subscriptions, not reconnecting');
      return;
    }

    // Close existing connection if any
    if (StockAlertService.socket$) {
      if (!StockAlertService.socket$.closed) {
        StockAlertService.socket$.complete();
      }
      StockAlertService.socket$ = null;
    }

    // Increment reconnect attempts
    const attempt = ++StockAlertService.reconnectAttempts;
    const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // Exponential backoff with max 30s

    console.log(`Attempting to reconnect (${attempt}/${StockAlertService.maxReconnectAttempts}) in ${delayMs}ms`);

    // Clear any existing timeout
    if (StockAlertService.reconnectTimeout) {
      clearTimeout(StockAlertService.reconnectTimeout);
      StockAlertService.reconnectTimeout = null;
    }

    // Set new timeout
    StockAlertService.reconnectTimeout = window.setTimeout(() => {
      StockAlertService.connectionInProgress = false;
      this.connect();
    }, delayMs);
  }

  // ... (rest of the code remains the same)

  /**
   * Disconnects the WebSocket and cleans up resources
   */
  public disconnect(): void {
    console.log('Disconnecting WebSocket...');

    // Clear ping interval and timeout
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }

    // Clear any pending reconnect attempt
    if (StockAlertService.reconnectTimeout) {
      clearTimeout(StockAlertService.reconnectTimeout);
      StockAlertService.reconnectTimeout = null;
    }

    // Unsubscribe and clean up socket subscription
    if (StockAlertService.socketSubscription) {
      try {
        const subscription = StockAlertService.socketSubscription;
        if (!subscription.closed) {
          subscription.unsubscribe();
        }
      } catch (e) {
        const error = e as Error;
        console.error('Error unsubscribing from WebSocket:', error.message);
      } finally {
        StockAlertService.socketSubscription = null;
      }
    }

    // Close the WebSocket connection
    if (StockAlertService.socket$) {
      try {
        if (!StockAlertService.socket$.closed) {
          StockAlertService.socket$.complete();
        }
      } catch (e) {
        const error = e as Error;
        console.error('Error completing WebSocket during disconnect:', error.message);
      } finally {
        StockAlertService.socket$ = null;
      }
    }

    // Reset connection state
    StockAlertService.isConnected = false;
    StockAlertService.connectionInProgress = false;
    StockAlertService.reconnectAttempts = 0;
    
    console.log('WebSocket disconnected and cleaned up');
  }
}