import { Routes } from '@angular/router';
import { StockAlerts } from './components/stock-alerts/stock-alerts';
import { authGuard, publicGuard } from './guards/auth.guard';

export const routes: Routes = [
  { 
    path: '', 
    redirectTo: '/alerts', 
    pathMatch: 'full' 
  },
  { 
    path: 'alerts', 
    component: StockAlerts,
    title: 'Stock Alerts',
    canActivate: [authGuard]
  },
  { 
    path: 'login', 
    loadComponent: () => import('./components/login/login').then(m => m.LoginComponent),
    title: 'Login',
    canActivate: [publicGuard]
  },
  { 
    path: 'subscription', 
    loadComponent: () => import('./components/subscription/subscription').then(m => m.Subscription),
    title: 'Subscription',
    canActivate: [authGuard]
  },
  { 
    path: '**', 
    redirectTo: '/alerts' 
  }
];
