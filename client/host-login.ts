// ==========================================
// Host Login Page - PIN Authentication
// ==========================================

import { Logger } from './logger';

interface AuthResponse {
  success: boolean;
  token?: string;
  message?: string;
}

const form = document.getElementById('loginForm') as HTMLFormElement | null;
const pinInput = document.getElementById('pin') as HTMLInputElement | null;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement | null;
const errorMessage = document.getElementById('errorMessage');

form?.addEventListener('submit', async (e: Event) => {
  e.preventDefault();

  const pin = pinInput?.value.trim();
  if (!pin || !submitBtn || !pinInput) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying...';
  if (errorMessage) errorMessage.textContent = '';
  pinInput.classList.remove('error');

  try {
    const response = await fetch('/api/host/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });

    const data: AuthResponse = await response.json();

    if (data.success) {
      if (data.token) {
        document.cookie = `hostAuth=${data.token}; path=/; max-age=86400; SameSite=Lax`;
        window.location.href = `/host?auth=${encodeURIComponent(data.token)}`;
      } else {
        window.location.href = '/host';
      }
    } else {
      throw new Error(data.message || 'Invalid PIN');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    if (errorMessage) errorMessage.textContent = message;
    pinInput.classList.add('error');
    pinInput.value = '';
    pinInput.focus();
    Logger.warn('Auth failed:', message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '🚀 Access Host Panel';
  }
});

// Focus PIN input on load
pinInput?.focus();

