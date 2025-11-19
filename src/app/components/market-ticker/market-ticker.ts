import { Component, Input, OnDestroy, AfterViewInit, ViewChild, ElementRef, SimpleChanges, OnChanges } from '@angular/core';
import { CommonModule, NgFor, NgIf, DecimalPipe, DatePipe } from '@angular/common';
import { StockAlertService, TickerData } from '../../services/stock-alert.service';

@Component({
  selector: 'app-market-ticker',
  standalone: true,
  imports: [CommonModule, NgFor, NgIf, DecimalPipe, DatePipe],
  template: `
    <div class="market-ticker" *ngIf="tickerItems.length > 0">
      <div class="ticker-wrapper">
        <div class="ticker-track">
          <div class="ticker-content" #tickerContent>
            <div class="ticker-item" *ngFor="let item of displayItems; let i = index">
              <span class="ticker-label">{{ item.title }}:</span>
              <span class="ticker-value" [class.positive]="item.changePercent >= 0" [class.negative]="item.changePercent < 0">
                {{ item.lastPrice | number:'1.2-2' }}
                <span class="change" *ngIf="item.changePercent !== undefined">
                  ({{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent | number:'1.2-2' }}%)
                </span>
              </span>
              <span class="ticker-time" *ngIf="item.receivedAt">
                {{ item.receivedAt | date:'HH:mm:ss' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    @keyframes ticker-scroll {
      0% { transform: translateX(0); }
      100% { transform: translateX(-100%); } /* Scroll the full width of the duplicated content */
    }

    .market-ticker {
      width: 100%;
      background-color: #1a1a2e;
      padding: 0; /* Remove vertical padding from here */
      margin-bottom: 16px;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }

    .ticker-wrapper {
      width: 100%;
      overflow: hidden;
      position: relative;
      background-color: #1a1a2e;
      padding: 8px 0; /* Add vertical padding here */
    }

    .ticker-track {
      display: flex;
      white-space: nowrap;
      /* The animation duration will be set dynamically in the component */
      animation: ticker-scroll var(--ticker-duration, 30s) linear infinite;
      padding: 4px 0;
      will-change: transform; /* Performance optimization */
    }

    .ticker-content {
      display: flex;
      flex-shrink: 0; /* Important: prevents content from shrinking */
      align-items: center;
      /* No animation here, it's on the track */
    }

    .market-ticker:hover .ticker-track {
      animation-play-state: paused;
    }

    .ticker-item {
      display: inline-flex;
      align-items: center;
      padding: 0 15px;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 14px;
      color: #fff;
      height: 100%;
      white-space: nowrap;
    }

    .ticker-item:last-child {
      border-right: none;
    }

    .ticker-label {
      font-weight: 500;
      color: #a0a0a0;
      margin-right: 8px;
    }

    .ticker-value {
      font-weight: 600;
      font-family: 'Roboto Mono', monospace;
      color: #ffffff;
      margin-right: 4px;
    }

    .positive {
      color: #4caf50 !important;
    }

    .negative {
      color: #f44336 !important;
    }

    .ticker-time {
      font-size: 0.85em;
      color: #a0a0a0;
      margin: 0 8px;
    }

    .ticker-separator {
      color: rgba(255, 255, 255, 0.2);
      margin: 0 10px;
      font-weight: bold;
    }

    .change {
      margin-left: 4px;
    }

    @media (max-width: 768px) {
      .ticker-item {
        padding: 0 12px;
      }

      .ticker-label, .ticker-time {
        font-size: 0.85em;
      }
    }
  `]
})
export class MarketTicker implements OnChanges, OnDestroy, AfterViewInit {
  @Input() tickerData: TickerData | null = null;
  @ViewChild('tickerTrack', { static: false }) private tickerTrack!: ElementRef<HTMLDivElement>;
  @ViewChild('tickerContent', { static: false }) private tickerContent!: ElementRef<HTMLDivElement>;

  displayItems: TickerData[] = [];
  tickerItems: TickerData[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private isInitialized = false;
  private animationFrameId: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tickerData']?.currentValue) {
      this.addTickerItem(changes['tickerData'].currentValue);
      this.updateDisplayItems();
    }
  }

  ngAfterViewInit(): void {
    this.initializeTicker();
    this.setupResizeObserver();
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private initializeTicker(): void {
    if (this.isInitialized) return;

    if (this.tickerItems.length === 0) {
      // Initialize with some mock data if empty to ensure the track has content to measure
      // In a real app, this would wait for the first data from the WebSocket
      // For now, we rely on the input data
    }

    this.updateDisplayItems();
    this.isInitialized = true;
  }

  private addTickerItem(item: TickerData): void {
    // Check if the item already exists (e.g., same symbol) and update it
    const existingIndex = this.tickerItems.findIndex(i => i.title === item.title);
    if (existingIndex > -1) {
      this.tickerItems[existingIndex] = item;
    } else {
      this.tickerItems = [...this.tickerItems, item];
    }

    // Keep only the last 50 items to prevent memory issues
    if (this.tickerItems.length > 50) {
      this.tickerItems = this.tickerItems.slice(-50);
    }

    this.updateDisplayItems();
  }

  private updateDisplayItems(): void {
    // Double the items for seamless looping (marquee effect)
    // We only do this if we have content
    if (this.tickerItems.length > 0) {
      this.displayItems = [...this.tickerItems, ...this.tickerItems];
      // Recalculate animation duration after the DOM updates
      setTimeout(() => this.calculateAnimationDuration(), 0);
    } else {
      this.displayItems = [];
    }
  }

  private calculateAnimationDuration(): void {
    if (this.tickerContent?.nativeElement && this.tickerTrack?.nativeElement) {
      // The content is duplicated, so we take the width of the first half
      const contentWidth = this.tickerContent.nativeElement.scrollWidth / 2;

      // A speed of 50 pixels per second is a good starting point
      const speed = 50; // pixels per second
      const duration = contentWidth / speed; // seconds

      // Apply the duration to the CSS variable
      this.tickerTrack.nativeElement.style.setProperty('--ticker-duration', `${duration}s`);
    }
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;

    // Observe the content element to recalculate duration if its size changes
    this.resizeObserver = new ResizeObserver(() => {
      this.calculateAnimationDuration();
    });

    if (this.tickerContent?.nativeElement) {
      this.resizeObserver.observe(this.tickerContent.nativeElement);
    }
  }

  private cleanup(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}