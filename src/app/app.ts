import { Component, OnInit, signal, inject } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { GoogleAnalyticsService } from 'ngx-google-analytics';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('stock-alerts');
  private ga = inject(GoogleAnalyticsService);
  private router = inject(Router);

  ngOnInit() {
    // Track page views
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.ga.pageView(event.url, document.title);
    });

    // Track app initialization
    this.ga.event('app_initialized', 'app', 'App Initialized');
  }
}
