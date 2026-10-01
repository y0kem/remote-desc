(() => {
  const btnMinimize = document.getElementById('btnMinimize');
  const btnClose = document.getElementById('btnClose');
  const liveDot = document.getElementById('liveDot');
  const statusTitle = document.getElementById('statusTitle');
  const statusSubtitle = document.getElementById('statusSubtitle');
  const clientsBadge = document.getElementById('clientsBadge');
  const qrImage = document.getElementById('qrImage');
  const qrLoading = document.getElementById('qrLoading');
  const ipSelect = document.getElementById('ipSelect');
  const urlInput = document.getElementById('urlInput');
  const btnCopyUrl = document.getElementById('btnCopyUrl');
  const btnOpenBrowser = document.getElementById('btnOpenBrowser');
  const btnScaleCursor = document.getElementById('btnScaleCursor');
  const cursorVal = document.getElementById('cursorVal');
  const btnToggleMagnifier = document.getElementById('btnToggleMagnifier');

  let serverPort = 3000;

  // Window control buttons
  btnMinimize.addEventListener('click', () => {
    window.api.minimizeWindow();
  });

  btnClose.addEventListener('click', () => {
    window.api.closeWindow();
  });

  // Copy URL
  btnCopyUrl.addEventListener('click', async () => {
    await window.api.copyToClipboard(urlInput.value);
    const original = btnCopyUrl.textContent;
    btnCopyUrl.textContent = '✓';
    setTimeout(() => { btnCopyUrl.textContent = original; }, 1200);
  });

  // Open in default browser
  btnOpenBrowser.addEventListener('click', () => {
    window.api.openExternalUrl(urlInput.value);
  });

  // Toggle cursor
  btnScaleCursor.addEventListener('click', async () => {
    const res = await window.api.toggleCursor();
    updateCursorUI(res.cursorSize);
  });

  // Toggle magnifier
  btnToggleMagnifier.addEventListener('click', () => {
    window.api.toggleMagnifier();
  });

  // Change selected IP
  ipSelect.addEventListener('change', async () => {
    const chosenIp = ipSelect.value;
    const url = `http://${chosenIp}:${serverPort}`;
    urlInput.value = url;
    loadQr(chosenIp);
  });

  async function loadQr(ip) {
    qrLoading.style.display = 'block';
    qrImage.style.display = 'none';
    const qrData = await window.api.getQrCode(ip);
    if (qrData && qrData.dataUrl) {
      qrImage.src = qrData.dataUrl;
      qrImage.style.display = 'block';
      qrLoading.style.display = 'none';
    }
  }

  function updateCursorUI(size) {
    if (size === 72 || size === 96) {
      cursorVal.textContent = `${size} px (Большой)`;
    } else {
      cursorVal.textContent = `32 px (Обычный)`;
    }
  }

  function updateClientsUI(count) {
    clientsBadge.textContent = `${count} устр.`;
    if (count > 0) {
      statusSubtitle.textContent = `Подключено: ${count} клиент(ов)`;
      liveDot.style.background = '#10b981';
    } else {
      statusSubtitle.textContent = 'Ожидание подключения смартфона...';
    }
  }

  // Initialize UI with server info
  async function init() {
    const info = await window.api.getServerInfo();
    serverPort = info.port || 3000;

    ipSelect.innerHTML = '';
    const ips = info.ips || [];
    ips.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.address;
      opt.textContent = `${item.address} (${item.name})`;
      if (item.address === info.primaryIp) {
        opt.selected = true;
      }
      ipSelect.appendChild(opt);
    });

    const activeIp = info.primaryIp || '127.0.0.1';
    urlInput.value = `http://${activeIp}:${serverPort}`;
    loadQr(activeIp);

    updateCursorUI(info.cursorSize);
    updateClientsUI(info.clientCount || 0);
  }

  // Live status update listener from Electron main
  window.api.onStatusUpdate((data) => {
    if (data.clientCount !== undefined) {
      updateClientsUI(data.clientCount);
    }
    if (data.cursorSize !== undefined) {
      updateCursorUI(data.cursorSize);
    }
  });

  init();
})();
