// Forbes Secrets — Landing Page Logic (MVP Validation)
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // Check if user is already registered, redirect immediately to dashboard
    const alreadyRegistered = localStorage.getItem('earlyAccessEmail');
    if (alreadyRegistered) {
      window.location.href = './dashboard.html';
      return;
    }

    initScarcitySimulation();
    setupFormHandler();
  });

  // Dynamic Scarcity & Social Proof Simulation
  function initScarcitySimulation() {
    const slotsEl = document.getElementById('slotsCount');
    const tradersEl = document.getElementById('traderCount');

    if (!slotsEl || !tradersEl) return;

    // Retrieve or initialize starting values
    let currentSlots = parseInt(localStorage.getItem('mvp_slots_today') || '14');
    let currentTraders = parseInt(localStorage.getItem('mvp_traders_waitlist') || '78');

    slotsEl.textContent = currentSlots;
    tradersEl.textContent = currentTraders;

    // Simulate registrations over time
    const interval = setInterval(() => {
      // Small random chance that someone else joins the list
      if (Math.random() > 0.7) {
        if (currentSlots > 3) {
          currentSlots--;
          currentTraders++;

          localStorage.setItem('mvp_slots_today', currentSlots);
          localStorage.setItem('mvp_traders_waitlist', currentTraders);

          // Animate counter update
          animateCounter(slotsEl, currentSlots);
          animateCounter(tradersEl, currentTraders);
        } else {
          clearInterval(interval);
        }
      }
    }, 15000); // Check every 15 seconds
  }

  function animateCounter(element, newValue) {
    element.style.transition = 'transform 0.2s, opacity 0.2s';
    element.style.transform = 'scale(1.2)';
    element.style.opacity = '0.5';

    setTimeout(() => {
      element.textContent = newValue;
      element.style.transform = 'scale(1)';
      element.style.opacity = '1';
    }, 200);
  }

  // Handle email registration, lead capture, and magnet download
  function setupFormHandler() {
    const form = document.getElementById('leadForm');
    const emailInput = document.getElementById('emailInput');
    const submitBtn = document.getElementById('submitBtn');

    if (!form || !emailInput || !submitBtn) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = emailInput.value.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        alert('Por favor ingresa un correo electrónico válido.');
        return;
      }

      // Visual feedback: loading state
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Procesando acceso... ⏳';

      try {
        // 1. Register lead in backend API
        let apiSuccess = false;
        try {
          const resp = await fetch('/api/register-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
          });

          if (resp.ok) {
            apiSuccess = true;
            console.log('Lead registered in backend.');
          } else {
            console.warn('Backend API registration failed, falling back to local simulation.');
          }
        } catch (apiErr) {
          console.warn('Backend connection failed. Registering locally to ensure seamless UX:', apiErr.message);
        }

        // 2. Persist email in client to bypass the gate next time
        localStorage.setItem('earlyAccessEmail', email);

        // 3. Trigger immediate download of the SMC Guide PDF (Lead Magnet)
        triggerPdfDownload();

        // 4. Success onboarding transition
        submitBtn.innerHTML = '¡Acceso Concedido! 📖';
        submitBtn.style.background = 'linear-gradient(135deg, #3fb950, #2ea043)';
        submitBtn.style.color = '#fff';

        // Add lead to scarcity count
        let currentSlots = parseInt(localStorage.getItem('mvp_slots_today') || '14');
        let currentTraders = parseInt(localStorage.getItem('mvp_traders_waitlist') || '78');
        if (currentSlots > 3) currentSlots--;
        currentTraders++;
        localStorage.setItem('mvp_slots_today', currentSlots);
        localStorage.setItem('mvp_traders_waitlist', currentTraders);

        // 5. Redirect to the live dashboard
        setTimeout(() => {
          window.location.href = './dashboard.html';
        }, 1800);

      } catch (err) {
        console.error('Registration flow error:', err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        alert('Ocurrió un problema de conexión al registrar tu correo. Por favor, intenta de nuevo.');
      }
    });
  }

  function triggerPdfDownload() {
    const link = document.createElement('a');
    link.href = './SMC_Guide_Forbes_Secrets.pdf';
    link.download = 'SMC_Guide_Forbes_Secrets.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

})();
