import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  

  
  loading = false;
  errorMessage = '';

    onLogin(): void {
    this.loading = true;
    this.errorMessage = '';
    
    setTimeout(() => {
      // Simulate Google OAuth login
      const user = this.authService.login();
      this.loading = false;

      if (user) {
        this.router.navigate(['/subscription']);
      } else {
        this.errorMessage = 'Login failed. Please try again.';
      }
    }, 1500);
  }
}