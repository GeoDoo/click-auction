// ==========================================
// Host Login Page - PIN Authentication
// ==========================================

const form = document.getElementById('loginForm');
const pinInput = document.getElementById('pin');
const submitBtn = document.getElementById('submitBtn');
const errorMessage = document.getElementById('errorMessage');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const pin = pinInput.value.trim();
  if (!pin) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying...';
  errorMessage.textContent = '';
  pinInput.classList.remove('error');

  try {
    const response = await fetch('/api/host/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });

    const data = await response.json();

    if (data.success) {
      // Cookie is set by server via Set-Cookie header
      // Just redirect - cookie is already in browser
      window.location.href = '/host';
    } else {
      throw new Error(data.message || 'Invalid PIN');
    }
  } catch (err) {
    errorMessage.textContent = err.message || 'Authentication failed';
    pinInput.classList.add('error');
    pinInput.value = '';
    pinInput.focus();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '🚀 Access Host Panel';
  }
});

// Focus PIN input on load
pinInput.focus();

