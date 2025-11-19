import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map(user => {
      if (user) {
        // If user is logged in, allow access
        return true;
      }
      // If not logged in, redirect to login page
      return router.createUrlTree(['/login']);
    })
  );
};

export const publicGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map(user => {
      if (!user) {
        // If not logged in, allow access to public routes
        return true;
      }
      // If already logged in, redirect to alerts
      return router.createUrlTree(['/alerts']);
    })
  );
};
