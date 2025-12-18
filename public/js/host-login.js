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
      // Store token in cookie
      if (data.token) {
        // Add Secure flag on HTTPS to ensure cookie is sent
        const isSecure = window.location.protocol === 'https:';
        const secureFlag = isSecure ? '; Secure' : '';
        document.cookie = `hostAuth=${data.token}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax${secureFlag}`;
        Logger.debug('Cookie set, redirecting to /host');
      }
      // Redirect to host panel
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

