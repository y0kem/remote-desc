(() => {
  // DOM Elements
  const statusDot = document.getElementById('statusDot');
  const btnCursor = document.getElementById('btnCursor');
  const cursorLabel = document.getElementById('cursorLabel');
  const btnMagnifier = document.getElementById('btnMagnifier');
  const btnKeyboard = document.getElementById('btnKeyboard');
  const hiddenInput = document.getElementById('hiddenInput');
  const touchpad = document.getElementById('touchpad');
  const scrollStrip = document.getElementById('scrollStrip');
  const btnLeftClick = document.getElementById('btnLeftClick');
  const btnMiddleClick = document.getElementById('btnMiddleClick');
  const btnRightClick = document.getElementById('btnRightClick');

  // WebSocket connection
  let ws = null;
  let isConnected = false;
  let reconnectTimer = null;
  let pingInterval = null;

  function vibrate(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function connectWs() {
    clearTimeout(reconnectTimer);
    clearInterval(pingInterval);

    statusDot.className = 'status-dot connecting';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}`;

    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      isConnected = true;
      statusDot.className = 'status-dot connected';
      pingInterval = setInterval(() => {
        send({ t: 'ping' });
      }, 10000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.t === 'status') {
          if (msg.cursorSize) {
            cursorLabel.textContent = msg.cursorSize;
          }
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      isConnected = false;
      statusDot.className = 'status-dot disconnected';
      clearInterval(pingInterval);
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWs, 1500);
  }

  connectWs();

  // --- Quick Header Controls ---
  btnCursor.addEventListener('click', () => {
    vibrate(20);
    send({ t: 'cursor', scale: 'toggle' });
  });

  btnMagnifier.addEventListener('click', () => {
    vibrate(20);
    send({ t: 'magnifier', state: 'toggle' });
  });

  btnKeyboard.addEventListener('click', () => {
    vibrate(25);
    hiddenInput.focus();
  });

  // --- Keyboard & Voice Input Handling ---
  hiddenInput.addEventListener('input', (e) => {
    const val = hiddenInput.value;
    if (val.length > 0) {
      send({ t: 'text', text: val });
      hiddenInput.value = '';
    }
  });

  hiddenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
      send({ t: 'key', key: 'BACKSPACE' });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      send({ t: 'key', key: 'ENTER' });
      e.preventDefault();
    } else if (e.key === 'Tab') {
      send({ t: 'key', key: 'TAB' });
      e.preventDefault();
    } else if (e.key === 'Escape') {
      send({ t: 'key', key: 'ESC' });
      e.preventDefault();
    }
  });

  // --- Shortcut & Media Buttons ---
  document.querySelectorAll('[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      if (key) {
        vibrate(20);
        send({ t: 'key', key });
      }
    });
  });

  // --- Bottom Physical Buttons ---
  function setupButton(element, btnName) {
    element.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      vibrate(25);
      element.classList.add('active');
      send({ t: 'down', b: btnName });
    });

    const release = (e) => {
      e.preventDefault();
      if (element.classList.contains('active')) {
        element.classList.remove('active');
        send({ t: 'up', b: btnName });
      }
    };

    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
  }

  setupButton(btnLeftClick, 'left');
  setupButton(btnMiddleClick, 'middle');
  setupButton(btnRightClick, 'right');

  // --- Touchpad Gesture Engine ---
  let touchStartTime = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let prevTouchX = 0;
  let prevTouchY = 0;
  let prevTouchTime = 0;
  let isMoving = false;
  let isDragging = false;
  let dragTimer = null;

  // Two fingers
  let isTwoFinger = false;
  let twoFingerStartTime = 0;
  let prevTwoX = 0;
  let prevTwoY = 0;
  let twoFingerDisplacement = 0;

  // Nonlinear Ballistics Acceleration
  function applyBallistics(dx, dy, dt) {
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return { mx: 0, my: 0 };
    const dtSafe = Math.max(dt, 4);
    const speed = dist / dtSafe; // px / ms

    // Nonlinear multiplier: 1.0 at slow speeds, up to ~4.5x during flick
    let accel = 1.0;
    if (speed > 0.12) {
      accel = 1.0 + Math.min(Math.pow(speed * 2.0, 1.3), 3.5);
    }

    return {
      mx: dx * accel,
      my: dy * accel
    };
  }

  touchpad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touches = e.touches;
    const now = Date.now();

    if (touches.length === 1) {
      isTwoFinger = false;
      const t = touches[0];
      touchStartTime = now;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      prevTouchX = t.clientX;
      prevTouchY = t.clientY;
      prevTouchTime = now;
      isMoving = false;

      touchpad.classList.add('active');

      // Setup Long-press Drag & Drop timer (350 ms)
      clearTimeout(dragTimer);
      dragTimer = setTimeout(() => {
        if (!isMoving && touches.length === 1) {
          isDragging = true;
          vibrate(60);
          touchpad.classList.add('dragging');
          send({ t: 'down', b: 'left' });
        }
      }, 350);

    } else if (touches.length === 2) {
      clearTimeout(dragTimer);
      if (isDragging) {
        isDragging = false;
        touchpad.classList.remove('dragging');
        send({ t: 'up', b: 'left' });
      }

      isTwoFinger = true;
      twoFingerStartTime = now;
      twoFingerDisplacement = 0;

      const t1 = touches[0];
      const t2 = touches[1];
      prevTwoX = (t1.clientX + t2.clientX) / 2;
      prevTwoY = (t1.clientY + t2.clientY) / 2;
    }
  }, { passive: false });

  touchpad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touches = e.touches;
    const now = Date.now();

    if (touches.length === 1 && !isTwoFinger) {
      const t = touches[0];
      const totalDist = Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY);

      if (totalDist > 10) {
        isMoving = true;
        if (!isDragging) {
          clearTimeout(dragTimer);
        }
      }

      const rawDx = t.clientX - prevTouchX;
      const rawDy = t.clientY - prevTouchY;
      const dt = now - prevTouchTime;

      prevTouchX = t.clientX;
      prevTouchY = t.clientY;
      prevTouchTime = now;

      const { mx, my } = applyBallistics(rawDx, rawDy, dt);
      if (Math.abs(mx) > 0.1 || Math.abs(my) > 0.1) {
        send({ t: 'm', x: mx, y: my });
      }

    } else if (touches.length === 2) {
      const t1 = touches[0];
      const t2 = touches[1];
      const curX = (t1.clientX + t2.clientX) / 2;
      const curY = (t1.clientY + t2.clientY) / 2;

      const dx = curX - prevTwoX;
      const dy = curY - prevTwoY;

      twoFingerDisplacement += Math.hypot(dx, dy);

      prevTwoX = curX;
      prevTwoY = curY;

      // Natural scrolling: swipe up scrolls down (inverted wheel)
      const scrollY = -dy * 1.6;
      const scrollX = -dx * 1.6;

      if (Math.abs(scrollY) >= 1 || Math.abs(scrollX) >= 1) {
        send({ t: 'w', y: scrollY, x: scrollX });
      }
    }
  }, { passive: false });

  touchpad.addEventListener('touchend', (e) => {
    e.preventDefault();
    const now = Date.now();

    clearTimeout(dragTimer);

    if (isDragging) {
      isDragging = false;
      touchpad.classList.remove('dragging');
      send({ t: 'up', b: 'left' });
    } else if (isTwoFinger) {
      const duration = now - twoFingerStartTime;
      if (duration < 280 && twoFingerDisplacement < 16) {
        // Two-finger tap -> Right Click
        vibrate(35);
        send({ t: 'c', b: 'right' });
      }
      isTwoFinger = false;
    } else {
      const duration = now - touchStartTime;
      const totalDist = Math.hypot(prevTouchX - touchStartX, prevTouchY - touchStartY);

      if (duration < 250 && totalDist < 12) {
        // Single tap -> Left Click
        vibrate(25);
        send({ t: 'c', b: 'left' });
      }
    }

    if (e.touches.length === 0) {
      touchpad.classList.remove('active');
    }
  }, { passive: false });

  // --- Scroll Strip Handling ---
  let stripPrevY = 0;

  scrollStrip.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      stripPrevY = e.touches[0].clientY;
      scrollStrip.classList.add('active');
      vibrate(15);
    }
  }, { passive: false });

  scrollStrip.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const curY = e.touches[0].clientY;
      const dy = curY - stripPrevY;
      stripPrevY = curY;

      // Fast vertical scroll
      const scrollDelta = -dy * 2.8;
      if (Math.abs(scrollDelta) >= 1) {
        send({ t: 'w', y: scrollDelta, x: 0 });
      }
    }
  }, { passive: false });

  scrollStrip.addEventListener('touchend', (e) => {
    e.preventDefault();
    scrollStrip.classList.remove('active');
  }, { passive: false });

})();
