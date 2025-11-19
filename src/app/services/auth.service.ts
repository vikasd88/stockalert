import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { User } from '../models/alert.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(this.getUserFromStorage());
  public currentUser$ = this.currentUserSubject.asObservable();
  
  // Alias for currentUser$ to maintain compatibility
  public authState$ = this.currentUser$;

  // Mock users database (simplified for Google-only)
  private mockUsers: User[] = [
    {
      id: 'user-001',
      email: 'free@example.com',
      name: 'Free User',
      isSubscribed: false,
      lastLogin: new Date()
    },
    {
      id: 'user-002',
      email: 'premium@example.com',
      name: 'Premium User',
      isSubscribed: true,
      subscriptionDate: new Date(Date.now() - 30 * 24 * 60 * 60000),
      lastLogin: new Date()
    }
  ];

  constructor() {
    // Load user from localStorage if exists
    const savedUser = this.getUserFromStorage();
    if (savedUser) {
      this.currentUserSubject.next(savedUser);
    }
  }

  /**
   * Google OAuth login/signup simulation (now the only login method)
   */
  login(): User | null {
    // Simulate Google OAuth response - in a real app, this would be a redirect to Google
    // and a callback to an API endpoint.
    const googleUser: User = {
      id: `google-${Date.now()}`,
      email: `user${Math.floor(Math.random() * 10000)}@gmail.com`,
      name: 'Google User',
      isSubscribed: false,
      lastLogin: new Date()
    };

    // Check if a user with this simulated email already exists (for persistence)
    let user = this.mockUsers.find(u => u.email === googleUser.email);
    if (!user) {
      user = googleUser;
      this.mockUsers.push(user);
    }
    
    user.lastLogin = new Date();
    this.saveUserToStorage(user);
    this.currentUserSubject.next(user);
    return user;
  }

  /**
   * Get current user
   */
  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.currentUserSubject.value !== null;
  }

  /**
   * Check if user is subscribed
   */
  isSubscribed(): boolean {
    const user = this.currentUserSubject.value;
    return user ? user.isSubscribed : false;
  }

  /**
   * Update subscription status
   */
  updateSubscription(isSubscribed: boolean): void {
    const user = this.currentUserSubject.value;
    if (user) {
      user.isSubscribed = isSubscribed;
      if (isSubscribed) {
        user.subscriptionDate = new Date();
      } else {
        user.subscriptionDate = undefined;
      }
      this.saveUserToStorage(user);
      this.currentUserSubject.next(user);
    }
  }

  /**
   * Logout
   */
  logout(): void {
    localStorage.removeItem('currentUser');
    this.currentUserSubject.next(null);
  }

  /**
   * Save user to localStorage
   */
  private saveUserToStorage(user: User): void {
    localStorage.setItem('currentUser', JSON.stringify(user));
  }

  /**
   * Get user from localStorage
   */
  private getUserFromStorage(): User | null {
    const userJson = localStorage.getItem('currentUser');
    if (userJson) {
      try {
        return JSON.parse(userJson);
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}