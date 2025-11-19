import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models/alert.model';

@Component({
  selector: 'app-subscription',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subscription.html',
  styleUrl: './subscription.scss'
})
export class Subscription implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);

  currentUser: User | null = null;
  selectedPlan: 'free' | 'premium' | null = null;
  loading = false;

  plans = [
    {
      name: 'Free',
      price: '$0',
      period: 'Forever',
      description: 'Perfect for getting started',
      features: [
        'Limited alerts (5 per day)',
        'Basic market data',
        'Email notifications',
        'Mobile app access',
        'Community support'
      ],
      limitations: [
        'No advanced analytics',
        'Ads included',
        'Limited historical data',
        'No API access'
      ],
      color: 'primary',
      id: 'free'
    },
    {
      name: 'Premium',
      price: '$9.99',
      period: 'Per month',
      description: 'For serious traders',
      features: [
        'Unlimited alerts',
        'Advanced analytics',
        'Priority support',
        'Real-time data',
        'Historical data access',
        'API access',
        'Custom alerts',
        'No ads',
        'Portfolio tracking',
        'Advanced charts'
      ],
      limitations: [],
      color: 'success',
      id: 'premium',
      popular: true
    }
  ];

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    if (!this.currentUser) {
      this.router.navigate(['/login']);
    }
  }

  selectPlan(planId: string): void {
    this.selectedPlan = planId as 'free' | 'premium';
  }

  confirmSelection(): void {
    if (!this.selectedPlan || !this.currentUser) {
      return;
    }

    this.loading = true;

    setTimeout(() => {
      const isSubscribed = this.selectedPlan === 'premium';
      this.authService.updateSubscription(isSubscribed);
      this.loading = false;

      // Redirect to dashboard
      this.router.navigate(['/alerts']);
    }, 1000);
  }

  skipForNow(): void {
    this.router.navigate(['/alerts']);
  }

  getPlanById(id: string) {
    return this.plans.find(p => p.id === id);
  }
}


