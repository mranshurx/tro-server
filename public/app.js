/**
 * AirBeam P2P - Web Receiver Frontend Engine
 * 
 * Connects to signaling server via WebSocket, joins room with 6-digit code,
 * receives incoming 16KB file chunks, reassembles into Blob, and auto-downloads.
 */

(function () {
  'use strict';

  let ws = null;
  let currentRoomCode = null;

  // Receiver State
  let incomingFileMeta = null;
  let incomingChunks = [];
  let incomingBytesReceived = 0;
  let receivedFiles = [];

  // DOM Elements
  const elStatusDot = document.getElementById('statusDot');
  const elStatusText = document.getElementById('statusText');
  const elReceiverConnectCard = document.getElementById('receiverConnectCard');
  const elDigitInputs = document.querySelectorAll('.code-input-char');
  const elBtnConnectCode = document.getElementById('btnConnectCode');
  const elReceiverActiveBanner = document.getElementById('receiverActiveBanner');
  const elReceiverRoomBadge = document.getElementById('receiverRoomBadge');
  const elBtnDisconnectReceiver = document.getElementById('btnDisconnectReceiver');
  const elReceiverTransferCard = document.getElementById('receiverTransferCard');
  const elReceiverActiveFileName = document.getElementById('receiverActiveFileName');
  const elReceiverActiveFileDetails = document.getElementById('receiverActiveFileDetails');
  const elToggleAutoDownload = document.getElementById('toggleAutoDownload');
  const elReceiverProgressBar = document.getElementById('receiverProgressBar');
  const elReceiverProgressPercent = document.getElementById('receiverProgressPercent');
  const elReceiverChunkStatus = document.getElementById('receiverChunkStatus');
  const elReceiverSpeed = document.getElementById('receiverSpeed');
  const elReceivedFilesGrid = document.getElementById('receivedFilesGrid');
  const elReceivedCountBadge = document.getElementById('receivedCountBadge');
  const elReceivedEmptyPlaceholder = document.getElementById('receivedEmptyPlaceholder');
  const elToast = document.getElementById('toast');
  const elToastMsg = document.getElementById('toastMsg');

  function showToast(message, type = 'info') {
    if (!elToast) return;
    elToastMsg.textContent = message;
    elToast.classList.remove('translate-y-24', 'opacity-0');
    setTimeout(() => {
      elToast.classList.add('translate-y-24', 'opacity-0');
    }, 3500);
  }

  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function initSignaling() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (elStatusDot) elStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
      if (elStatusText) elStatusText.textContent = 'Server Online';

      // Auto join if ?join=CODE in URL
      const params = new URLSearchParams(window.location.search);
      const code = params.get('join');
      if (code && /^\d{6}$/.test(code)) {
        setDigitInputs(code);
        joinRoom(code);
      }
    };

    ws.onmessage = async (event) => {
      // 1. Binary ArrayBuffer chunk
      if (event.data instanceof ArrayBuffer) {
        if (!incomingFileMeta) return;
        incomingChunks.push(event.data);
        incomingBytesReceived += event.data.byteLength;

        const percent = Math.min(100, Math.round((incomingBytesReceived / incomingFileMeta.size) * 100));
        if (elReceiverProgressBar) elReceiverProgressBar.style.width = `${percent}%`;
        if (elReceiverProgressPercent) elReceiverProgressPercent.textContent = `${percent}%`;
        if (elReceiverActiveFileDetails) {
          elReceiverActiveFileDetails.textContent = `${formatBytes(incomingBytesReceived)} / ${formatBytes(incomingFileMeta.size)} (${percent}%)`;
        }
        if (elReceiverChunkStatus) {
          elReceiverChunkStatus.textContent = `Chunk ${incomingChunks.length} / ${incomingFileMeta.totalChunks}`;
        }
        return;
      }

      // 2. JSON message
      try {
        const msg = JSON.parse(event.data);
        handleSignalingMessage(msg);
      } catch (err) {
        console.error('Parse error', err);
      }
    };

    ws.onclose = () => {
      if (elStatusDot) elStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
      if (elStatusText) elStatusText.textContent = 'Disconnected';
      setTimeout(initSignaling, 3000);
    };
  }

  function sendSignaling(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function joinRoom(code) {
    if (!code || code.length !== 6) {
      showToast('Enter a valid 6-digit code', 'error');
      return;
    }
    sendSignaling({ type: 'join-room', code });
  }

  function handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'room-joined': {
        currentRoomCode = msg.code;
        if (elReceiverRoomBadge) elReceiverRoomBadge.textContent = `Room: #${currentRoomCode}`;
        if (elReceiverConnectCard) elReceiverConnectCard.classList.add('hidden');
        if (elReceiverActiveBanner) elReceiverActiveBanner.classList.remove('hidden');
        showToast(`Connected to Room #${currentRoomCode}`, 'success');
        break;
      }

      case 'file-meta': {
        incomingFileMeta = msg;
        incomingChunks = [];
        incomingBytesReceived = 0;

        if (elReceiverTransferCard) elReceiverTransferCard.classList.remove('hidden');
        if (elReceiverActiveFileName) elReceiverActiveFileName.textContent = msg.name;
        if (elReceiverProgressBar) elReceiverProgressBar.style.width = '0%';
        if (elReceiverProgressPercent) elReceiverProgressPercent.textContent = '0%';
        if (elReceiverActiveFileDetails) elReceiverActiveFileDetails.textContent = `0 KB / ${formatBytes(msg.size)} (0%)`;
        if (elReceiverChunkStatus) elReceiverChunkStatus.textContent = `Chunk 0 / ${msg.totalChunks}`;
        break;
      }

      case 'file-end': {
        if (!incomingFileMeta) return;

        const blob = new Blob(incomingChunks, { type: incomingFileMeta.mimeType });
        const url = URL.createObjectURL(blob);
        const record = {
          id: incomingFileMeta.id,
          name: incomingFileMeta.name,
          size: incomingFileMeta.size,
          mimeType: incomingFileMeta.mimeType,
          url: url,
          timestamp: new Date().toLocaleTimeString()
        };

        receivedFiles.unshift(record);
        renderReceivedFiles();

        if (elToggleAutoDownload && elToggleAutoDownload.checked) {
          triggerDownload(record);
        }

        showToast(`Received: ${incomingFileMeta.name}`, 'success');
        incomingFileMeta = null;
        incomingChunks = [];
        setTimeout(() => {
          if (elReceiverTransferCard) elReceiverTransferCard.classList.add('hidden');
        }, 3000);
        break;
      }

      case 'peer-disconnected': {
        showToast(msg.message || 'Sender disconnected', 'error');
        break;
      }

      case 'error': {
        showToast(msg.message, 'error');
        break;
      }
    }
  }

  function triggerDownload(record) {
    const a = document.createElement('a');
    a.href = record.url;
    a.download = record.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function renderReceivedFiles() {
    if (!elReceivedCountBadge || !elReceivedEmptyPlaceholder || !elReceivedFilesGrid) return;
    elReceivedCountBadge.textContent = `${receivedFiles.length} items`;
    if (receivedFiles.length === 0) {
      elReceivedEmptyPlaceholder.classList.remove('hidden');
      elReceivedFilesGrid.innerHTML = '';
      return;
    }

    elReceivedEmptyPlaceholder.classList.add('hidden');
    elReceivedFilesGrid.innerHTML = '';

    receivedFiles.forEach((file) => {
      const card = document.createElement('div');
      card.className = 'p-3 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between gap-3';
      card.innerHTML = `
        <div class="min-w-0">
          <h4 class="font-medium text-xs text-white truncate max-w-[180px]">${file.name}</h4>
          <span class="text-[10px] text-slate-400 font-mono">${formatBytes(file.size)} • ${file.timestamp}</span>
        </div>
        <button class="btn-dl px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium">Save</button>
      `;
      card.querySelector('.btn-dl').addEventListener('click', () => triggerDownload(file));
      elReceivedFilesGrid.appendChild(card);
    });
  }

  function setupDigitInputs() {
    if (!elDigitInputs.length) return;
    elDigitInputs.forEach((input, index) => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = val;
        if (val && index < elDigitInputs.length - 1) {
          elDigitInputs[index + 1].focus();
        }
        const code = Array.from(elDigitInputs).map(i => i.value).join('');
        if (code.length === 6) joinRoom(code);
      });
    });
  }

  function setDigitInputs(code) {
    const chars = code.split('');
    elDigitInputs.forEach((input, i) => {
      input.value = chars[i] || '';
    });
  }

  if (elBtnConnectCode) {
    elBtnConnectCode.addEventListener('click', () => {
      const code = Array.from(elDigitInputs).map(i => i.value).join('');
      joinRoom(code);
    });
  }

  if (elBtnDisconnectReceiver) {
    elBtnDisconnectReceiver.addEventListener('click', () => {
      window.location.reload();
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    setupDigitInputs();
    initSignaling();
  });

})();

