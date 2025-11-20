import { ApplicationConfig, provideZoneChangeDetection, PLATFORM_ID } from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideGoogleAnalytics, GoogleAnalyticsService } from 'ngx-google-analytics';
import { isPlatformBrowser } from '@angular/common';

import { routes } from './app.routes';

// Your Google Analytics Measurement ID (starts with 'G-' or 'UA-')
const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'; // Replace with your actual Measurement ID

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ 
      eventCoalescing: true 
    }),
    provideHttpClient(
      withInterceptorsFromDi()
    ),
    provideRouter(routes, withViewTransitions()),
    provideAnimations(),
    
    // Provide Google Analytics
    isPlatformBrowser(PLATFORM_ID) ? provideGoogleAnalytics(GA_MEASUREMENT_ID) : [],
    GoogleAnalyticsService
  ]
};
