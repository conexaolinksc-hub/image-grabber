/* ===================================================
   Image Grabber — High-Performance Application Logic
   =================================================== */

(function () {
  'use strict';

  // --- DOM Elements ---
  const searchForm = document.getElementById('searchForm');
  const urlInput = document.getElementById('urlInput');
  const searchBtn = document.getElementById('searchBtn');
  const saveCurrentBtn = document.getElementById('saveCurrentBtn');
  const statusArea = document.getElementById('statusArea');
  const errorArea = document.getElementById('errorArea');
  const errorText = document.getElementById('errorText');
  const resultsHeader = document.getElementById('resultsHeader');
  const resultsTitle = document.getElementById('resultsTitle');
  const resultsCount = document.getElementById('resultsCount');
  
  // Toolbar controls
  const vectorFilterBtn = document.getElementById('vectorFilterBtn');
  const vectorCountBadge = document.getElementById('vectorCountBadge');
  const keywordFilter = document.getElementById('keywordFilter');
  const sizeFilter = document.getElementById('sizeFilter');
  const formatFilter = document.getElementById('formatFilter');
  const sortFilter = document.getElementById('sortFilter');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const invertSelectionBtn = document.getElementById('invertSelectionBtn');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');

  const imageGrid = document.getElementById('imageGrid');
  const emptyState = document.getElementById('emptyState');
  const previewModal = document.getElementById('previewModal');
  const modalClose = document.getElementById('modalClose');
  const previewImage = document.getElementById('previewImage');
  const previewAlt = document.getElementById('previewAlt');
  const previewDimensions = document.getElementById('previewDimensions');
  const previewSource = document.getElementById('previewSource');
  const previewDownload = document.getElementById('previewDownload');
  const previewCopy = document.getElementById('previewCopy');
  const toastContainer = document.getElementById('toastContainer');

  // Context Menu
  const imageContextMenu = document.getElementById('imageContextMenu');
  const ctxCopyImage = document.getElementById('ctxCopyImage');
  const ctxDownloadImage = document.getElementById('ctxDownloadImage');
  const ctxCopyUrl = document.getElementById('ctxCopyUrl');
  const ctxPreviewImage = document.getElementById('ctxPreviewImage');
  let activeContextImage = null;

  // Theme
  const themeToggle = document.getElementById('themeToggle');

  // Library Sidebar
  const libraryToggle = document.getElementById('libraryToggle');
  const librarySidebar = document.getElementById('librarySidebar');
  const sidebarClose = document.getElementById('sidebarClose');
  const saveLinkInput = document.getElementById('saveLinkInput');
  const saveLinkBtn = document.getElementById('saveLinkBtn');
  const savedList = document.getElementById('savedList');
  const savedEmpty = document.getElementById('savedEmpty');
  const historyList = document.getElementById('historyList');
  const historyEmpty = document.getElementById('historyEmpty');
  const clearSaved = document.getElementById('clearSaved');
  const clearHistory = document.getElementById('clearHistory');
  const sidebarTabs = document.querySelectorAll('.sidebar__tab');

  // --- State ---
  let allImages = [];
  let filteredImages = [];
  let isExtracting = false;

  // =============================================
  //  THEME MANAGEMENT
  // =============================================
  function getStoredTheme() {
    return localStorage.getItem('ig-theme') || 'light';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ig-theme', theme);
  }

  // Restore theme on load
  setTheme(getStoredTheme());

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
    showToast(next === 'light' ? '☀️ Modo claro ativado' : '🌙 Modo escuro ativado', 'info');
  });

  // =============================================
  //  LIBRARY — localStorage persistence
  // =============================================
  const SAVED_KEY = 'ig-saved-links';
  const HISTORY_KEY = 'ig-search-history';

  function getSavedLinks() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
    catch { return []; }
  }

  function saveSavedLinks(links) {
    localStorage.setItem(SAVED_KEY, JSON.stringify(links));
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch { return []; }
  }

  function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  function addSavedLink(url) {
    if (!url) return;
    const links = getSavedLinks();
    if (links.some(l => l.url === url)) {
      showToast('Este link já está salvo.', 'info');
      return;
    }
    links.unshift({
      url,
      savedAt: new Date().toISOString(),
    });
    saveSavedLinks(links);
    renderSavedLinks();
    showToast('🔖 Link salvo na biblioteca!', 'success');
  }

  function removeSavedLink(url) {
    let links = getSavedLinks();
    links = links.filter(l => l.url !== url);
    saveSavedLinks(links);
    renderSavedLinks();
  }

  function addToHistory(url, imageCount, pageTitle) {
    const history = getHistory();
    const filtered = history.filter(h => h.url !== url);
    filtered.unshift({
      url,
      imageCount,
      pageTitle: pageTitle || '',
      searchedAt: new Date().toISOString(),
    });
    if (filtered.length > 50) filtered.length = 50;
    saveHistory(filtered);
    renderHistory();
  }

  function removeHistoryEntry(url) {
    let history = getHistory();
    history = history.filter(h => h.url !== url);
    saveHistory(history);
    renderHistory();
  }

  function isUrlSaved(url) {
    return getSavedLinks().some(l => l.url === url);
  }

  function formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) return 'Agora mesmo';
    if (diffMin < 60) return `${diffMin}min atrás`;
    if (diffHr < 24) return `${diffHr}h atrás`;
    if (diffDay < 7) return `${diffDay}d atrás`;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function shortenUrl(url) {
    try {
      const u = new URL(url);
      let display = u.hostname + u.pathname;
      if (display.length > 45) display = display.substring(0, 42) + '...';
      return display;
    } catch {
      return url.length > 45 ? url.substring(0, 42) + '...' : url;
    }
  }

  function renderSavedLinks() {
    const links = getSavedLinks();
    savedList.innerHTML = '';

    if (links.length === 0) {
      savedEmpty.style.display = '';
      return;
    }
    savedEmpty.style.display = 'none';

    links.forEach(link => {
      const item = document.createElement('div');
      item.className = 'sidebar__item';
      item.innerHTML = `
        <div class="sidebar__item-icon sidebar__item-icon--saved">🔖</div>
        <div class="sidebar__item-body">
          <div class="sidebar__item-url" title="${escapeHtml(link.url)}">${escapeHtml(shortenUrl(link.url))}</div>
          <div class="sidebar__item-meta">${formatDate(link.savedAt)}</div>
        </div>
        <div class="sidebar__item-actions">
          <button class="sidebar__item-btn sidebar__item-btn--search" title="Pesquisar imagens">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          <button class="sidebar__item-btn sidebar__item-btn--delete" title="Remover">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `;

      item.querySelector('.sidebar__item-url').addEventListener('click', () => {
        urlInput.value = link.url;
        closeSidebar();
        urlInput.focus();
      });

      item.querySelector('.sidebar__item-btn--search').addEventListener('click', () => {
        urlInput.value = link.url;
        closeSidebar();
        extractImages(link.url);
      });

      item.querySelector('.sidebar__item-btn--delete').addEventListener('click', () => {
        removeSavedLink(link.url);
        updateSaveCurrentBtn();
      });

      savedList.appendChild(item);
    });
  }

  function renderHistory() {
    const history = getHistory();
    historyList.innerHTML = '';

    if (history.length === 0) {
      historyEmpty.style.display = '';
      return;
    }
    historyEmpty.style.display = 'none';

    history.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'sidebar__item';
      item.innerHTML = `
        <div class="sidebar__item-icon sidebar__item-icon--history">🕐</div>
        <div class="sidebar__item-body">
          <div class="sidebar__item-url" title="${escapeHtml(entry.url)}">${escapeHtml(shortenUrl(entry.url))}</div>
          <div class="sidebar__item-meta">${entry.imageCount} imagens • ${formatDate(entry.searchedAt)}</div>
        </div>
        <div class="sidebar__item-actions">
          <button class="sidebar__item-btn sidebar__item-btn--save" title="Salvar link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button class="sidebar__item-btn sidebar__item-btn--search" title="Pesquisar novamente">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button class="sidebar__item-btn sidebar__item-btn--delete" title="Remover">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `;

      item.querySelector('.sidebar__item-url').addEventListener('click', () => {
        urlInput.value = entry.url;
        closeSidebar();
        urlInput.focus();
      });

      item.querySelector('.sidebar__item-btn--save').addEventListener('click', () => {
        addSavedLink(entry.url);
        updateSaveCurrentBtn();
      });

      item.querySelector('.sidebar__item-btn--search').addEventListener('click', () => {
        urlInput.value = entry.url;
        closeSidebar();
        extractImages(entry.url);
      });

      item.querySelector('.sidebar__item-btn--delete').addEventListener('click', () => {
        removeHistoryEntry(entry.url);
      });

      historyList.appendChild(item);
    });
  }

  function openSidebar() {
    librarySidebar.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderSavedLinks();
    renderHistory();
  }

  function closeSidebar() {
    librarySidebar.classList.remove('open');
    document.body.style.overflow = '';
  }

  libraryToggle.addEventListener('click', openSidebar);
  sidebarClose.addEventListener('click', closeSidebar);
  librarySidebar.querySelector('.sidebar__backdrop').addEventListener('click', closeSidebar);

  sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sidebarTabs.forEach(t => t.classList.remove('sidebar__tab--active'));
      tab.classList.add('sidebar__tab--active');

      const target = tab.dataset.tab;
      document.querySelectorAll('.sidebar__tab-content').forEach(c => c.classList.remove('sidebar__tab-content--active'));
      document.getElementById(target + 'Tab').classList.add('sidebar__tab-content--active');
    });
  });

  saveLinkBtn.addEventListener('click', () => {
    let url = saveLinkInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    addSavedLink(url);
    saveLinkInput.value = '';
    updateSaveCurrentBtn();
  });

  saveLinkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLinkBtn.click();
    }
  });

  function updateSaveCurrentBtn() {
    const url = urlInput.value.trim();
    if (url && isUrlSaved(url)) {
      saveCurrentBtn.classList.add('saved');
      saveCurrentBtn.title = 'Link já salvo';
    } else {
      saveCurrentBtn.classList.remove('saved');
      saveCurrentBtn.title = 'Salvar este link na biblioteca';
    }
  }

  saveCurrentBtn.addEventListener('click', () => {
    let url = urlInput.value.trim();
    if (!url) {
      showToast('Digite uma URL primeiro.', 'info');
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    if (isUrlSaved(url)) {
      removeSavedLink(url);
      showToast('Link removido da biblioteca.', 'info');
    } else {
      addSavedLink(url);
    }
    updateSaveCurrentBtn();
  });

  urlInput.addEventListener('input', updateSaveCurrentBtn);

  clearSaved.addEventListener('click', () => {
    if (!confirm('Tem certeza que deseja limpar todos os links salvos?')) return;
    saveSavedLinks([]);
    renderSavedLinks();
    updateSaveCurrentBtn();
    showToast('Links salvos limpos.', 'info');
  });

  clearHistory.addEventListener('click', () => {
    if (!confirm('Tem certeza que deseja limpar todo o histórico?')) return;
    saveHistory([]);
    renderHistory();
    showToast('Histórico limpo.', 'info');
  });

  // =============================================
  //  CORE — High-Performance Image Extraction
  // =============================================

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function showEl(el) { el.classList.remove('hidden'); }
  function hideEl(el) { el.classList.add('hidden'); }

  function isInstagramUrl(url) {
    return /^https?:\/\/(www\.)?instagram\.com\//i.test(url);
  }

  function setLoading(loading, url) {
    isExtracting = loading;
    if (loading) {
      showEl(statusArea);
      hideEl(errorArea);
      hideEl(resultsHeader);
      hideEl(emptyState);
      imageGrid.innerHTML = '';
      searchBtn.disabled = true;
      searchBtn.querySelector('.search-btn__text').textContent = 'Buscando...';
      const statusText = statusArea.querySelector('.status-text');
      if (url && isInstagramUrl(url)) {
        statusText.textContent = '📸 Extraindo imagens do Instagram em alta resolução...';
      } else {
        statusText.textContent = 'Analisando página e localizando imagens...';
      }
    } else {
      hideEl(statusArea);
      searchBtn.disabled = false;
      searchBtn.querySelector('.search-btn__text').textContent = 'Buscar Imagens';
    }
  }

  function showError(msg) {
    errorText.textContent = msg;
    showEl(errorArea);
    hideEl(resultsHeader);
    hideEl(emptyState);
    imageGrid.innerHTML = '';
  }

  function proxyUrl(originalUrl) {
    return `/api/proxy?url=${encodeURIComponent(originalUrl)}`;
  }

  function downloadUrl(originalUrl, filename) {
    return `/api/download?url=${encodeURIComponent(originalUrl)}&filename=${encodeURIComponent(filename || '')}`;
  }

  function getFilename(url) {
    try {
      const pathname = new URL(url).pathname;
      const base = pathname.split('/').pop();
      return base || 'imagem.jpg';
    } catch {
      return 'imagem.jpg';
    }
  }

  function getImageFormat(url) {
    if (!url) return 'jpg';
    if (url.startsWith('data:image/svg+xml') || url.includes('.svg')) return 'svg';
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      if (pathname.includes('.png')) return 'png';
      if (pathname.includes('.webp')) return 'webp';
      if (pathname.includes('.gif')) return 'gif';
      if (pathname.includes('.svg')) return 'svg';
      if (pathname.includes('.avif')) return 'avif';
      return 'jpg';
    } catch {
      return url.includes('.svg') ? 'svg' : 'jpg';
    }
  }

  function isVectorImage(img) {
    if (!img) return false;
    if (img.isVector) return true;
    if (img.url && (img.url.startsWith('data:image/svg+xml') || img.url.includes('.svg'))) return true;
    const ext = getImageFormat(img.url);
    if (ext === 'svg') return true;
    if (img.source && (img.source.includes('vector') || img.source.includes('svg'))) return true;
    return false;
  }

  function getQualityTag(width, height, isVec = false) {
    if (isVec) return { label: 'VETOR', cls: 'image-card__quality-tag--vector' };
    const maxDim = Math.max(width || 0, height || 0);
    if (maxDim >= 2560) return { label: '4K', cls: 'image-card__quality-tag--4k' };
    if (maxDim >= 1920) return { label: 'FHD', cls: 'image-card__quality-tag--fhd' };
    if (maxDim >= 1080) return { label: 'HD', cls: 'image-card__quality-tag--hd' };
    if (maxDim > 0 && maxDim < 600) return { label: 'SD', cls: 'image-card__quality-tag--sd' };
    return null;
  }

  // --- Image Extraction ---
  async function extractImages(pageUrl) {
    setLoading(true, pageUrl);
    hideEl(errorArea);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pageUrl }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erro desconhecido');
      }

      allImages = data.images || [];

      setLoading(false);
      addToHistory(pageUrl, allImages.length, data.pageTitle);

      if (allImages.length === 0) {
        showEl(emptyState);
        hideEl(resultsHeader);
        return;
      }

      resultsTitle.textContent = data.pageTitle || 'Resultados';
      
      // Instant Render: display cards immediately!
      applyFilter();
      showEl(resultsHeader);

      const vectorCount = allImages.filter(isVectorImage).length;
      if (data.isInstagram) {
        showToast(`📸 ${allImages.length} imagens do Instagram encontradas!`, 'success');
      } else if (vectorCount > 0) {
        showToast(`⚡ ${allImages.length} imagens encontradas (${vectorCount} vetores/SVG)!`, 'success');
      } else {
        showToast(`⚡ ${allImages.length} imagens encontradas instantaneamente!`, 'success');
      }

    } catch (err) {
      setLoading(false);
      showError(err.message);
      showToast('Falha ao extrair imagens', 'error');
    }
  }

  // --- Filtering & Sorting Engine ---
  function applyFilter() {
    const minSize = parseInt(sizeFilter.value, 10) || 0;
    const format = formatFilter.value;
    const query = (keywordFilter.value || '').trim().toLowerCase();
    const sort = sortFilter.value;

    // Update vector count badge
    const totalVectors = allImages.filter(img => !img.broken && isVectorImage(img)).length;
    if (vectorCountBadge) {
      vectorCountBadge.textContent = totalVectors;
    }

    // Synchronize 1-click vector button active state
    if (vectorFilterBtn) {
      if (format === 'svg') {
        vectorFilterBtn.classList.add('active');
      } else {
        vectorFilterBtn.classList.remove('active');
      }
    }

    filteredImages = allImages.filter(img => {
      if (img.broken) return false;

      const isVec = isVectorImage(img);

      // Min Size (ignored for SVGs so icons/logos remain visible)
      if (!isVec) {
        const maxDim = Math.max(img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0);
        if (minSize > 0 && maxDim > 0 && maxDim < minSize) return false;
      }

      // Format Filter / Vector Filter
      if (format === 'svg') {
        if (!isVec) return false;
      } else if (format !== 'all') {
        const ext = getImageFormat(img.url);
        if (format === 'jpg' && ext !== 'jpg' && ext !== 'jpeg') return false;
        if (format !== 'jpg' && ext !== format) return false;
      }

      // Keyword query
      if (query) {
        const text = `${img.alt || ''} ${img.url} ${img.source || ''}`.toLowerCase();
        if (!text.includes(query)) return false;
      }

      return true;
    });

    // Sorting
    if (sort === 'highest-res') {
      filteredImages.sort((a, b) => {
        const isVecA = isVectorImage(a);
        const isVecB = isVectorImage(b);
        if (isVecA && !isVecB) return -1;
        if (!isVecA && isVecB) return 1;
        const dimA = Math.max(a.naturalWidth || a.width || 0, a.naturalHeight || a.height || 0);
        const dimB = Math.max(b.naturalWidth || b.width || 0, b.naturalHeight || b.height || 0);
        return dimB - dimA;
      });
    } else if (sort === 'lowest-res') {
      filteredImages.sort((a, b) => {
        const dimA = Math.max(a.naturalWidth || a.width || 0, a.naturalHeight || a.height || 0);
        const dimB = Math.max(b.naturalWidth || b.width || 0, b.naturalHeight || b.height || 0);
        return dimA - dimB;
      });
    } else if (sort === 'name-asc') {
      filteredImages.sort((a, b) => {
        const nameA = (a.alt || getFilename(a.url)).toLowerCase();
        const nameB = (b.alt || getFilename(b.url)).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    }

    resultsCount.textContent = `${filteredImages.length} de ${allImages.length} imagem${allImages.length !== 1 ? 's' : ''}`;
    renderGrid(filteredImages);

    if (filteredImages.length === 0 && allImages.length > 0) {
      showEl(emptyState);
    } else {
      hideEl(emptyState);
    }
  }

  // --- High-Performance Grid Rendering ---
  function renderGrid(images) {
    imageGrid.innerHTML = '';
    const fragment = document.createDocumentFragment();

    images.forEach((img, index) => {
      const card = document.createElement('div');
      card.className = 'image-card';
      card.style.animationDelay = `${Math.min(index * 25, 400)}ms`;

      const isVec = isVectorImage(img);
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const dims = isVec ? '∞ Vetor' : ((w && h) ? `${w} × ${h}` : '');
      const quality = getQualityTag(w, h, isVec);

      card.innerHTML = `
        <input type="checkbox" class="image-card__checkbox" data-index="${index}" title="Selecionar para download" onclick="event.stopPropagation()">
        ${quality ? `<span class="image-card__quality-tag ${quality.cls}">${quality.label}</span>` : '<span class="image-card__quality-tag hidden"></span>'}
        <div class="image-card__img-wrapper">
          <img
            class="image-card__img"
            src="${proxyUrl(img.url)}"
            alt="${escapeHtml(img.alt)}"
            loading="lazy"
          >
          <div class="image-card__overlay">
            <div class="image-card__actions">
              <button class="image-card__action-btn image-card__action-btn--download" data-url="${escapeHtml(img.url)}" title="Baixar imagem" onclick="event.stopPropagation()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Baixar
              </button>
              <button class="image-card__action-btn image-card__action-btn--copy" data-url="${escapeHtml(img.url)}" title="Copiar imagem para Área de Transferência" onclick="event.stopPropagation()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copiar
              </button>
            </div>
          </div>
        </div>
        <div class="image-card__info">
          <p class="image-card__alt" title="${escapeHtml(img.alt || getFilename(img.url))}">${escapeHtml(img.alt) || getFilename(img.url)}</p>
          <div class="image-card__meta">
            <div class="image-card__meta-left">
              <span class="image-card__badge">${img.source || 'IMG'}</span>
              <span class="image-card__dimensions">${dims}</span>
            </div>
            <div class="image-card__quick-actions">
              <button class="image-card__quick-btn image-card__quick-btn--copy" title="Copiar para área de transferência" onclick="event.stopPropagation()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
              <button class="image-card__quick-btn image-card__quick-btn--download" title="Baixar imagem" onclick="event.stopPropagation()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;

      const cardImg = card.querySelector('.image-card__img');
      cardImg.addEventListener('load', () => {
        if (!img.naturalWidth && cardImg.naturalWidth) {
          img.naturalWidth = cardImg.naturalWidth;
          img.naturalHeight = cardImg.naturalHeight;
          const dimEl = card.querySelector('.image-card__dimensions');
          if (dimEl) dimEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;

          const q = getQualityTag(img.naturalWidth, img.naturalHeight);
          const qTag = card.querySelector('.image-card__quality-tag');
          if (q && qTag) {
            qTag.textContent = q.label;
            qTag.className = `image-card__quality-tag ${q.cls}`;
            qTag.classList.remove('hidden');
          }
        }
      });

      cardImg.addEventListener('error', () => {
        img.broken = true;
      });

      card.addEventListener('click', () => openPreview(img));

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenu(e, img);
      });

      const dlBtn = card.querySelector('.image-card__action-btn--download');
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload(img.url);
      });

      const cpBtn = card.querySelector('.image-card__action-btn--copy');
      cpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyImageToClipboard(img.url, cpBtn);
      });

      const quickCpBtn = card.querySelector('.image-card__quick-btn--copy');
      quickCpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyImageToClipboard(img.url, quickCpBtn);
      });

      const quickDlBtn = card.querySelector('.image-card__quick-btn--download');
      quickDlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload(img.url);
      });

      fragment.appendChild(card);
    });

    imageGrid.appendChild(fragment);
  }

  // --- Download Single Image ---
  function triggerDownload(url) {
    const filename = getFilename(url);
    const a = document.createElement('a');
    a.href = downloadUrl(url, filename);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download iniciado! 📥', 'success');
  }

  // --- Copy Image to Clipboard (High-Speed & Reliable) ---
  async function copyImageToClipboard(url, triggerBtn) {
    try {
      showToast('Copiando imagem...', 'info');
      const response = await fetch(proxyUrl(url));
      if (!response.ok) throw new Error('Falha ao buscar imagem');
      const blob = await response.blob();

      let pngBlob;
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        pngBlob = await new Promise((resolve, reject) => {
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('Erro ao gerar PNG')), 'image/png');
        });
      } else {
        pngBlob = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Erro ao converter imagem')), 'image/png');
          };
          img.onerror = () => reject(new Error('Falha ao carregar imagem'));
          img.src = URL.createObjectURL(blob);
        });
      }

      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob })
        ]);
        showToast('✓ Imagem copiada para a Área de Transferência! (Cole com Ctrl+V)', 'success');

        if (triggerBtn) {
          const originalHTML = triggerBtn.innerHTML;
          triggerBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            ${triggerBtn.classList.contains('image-card__quick-btn') ? '' : ' Copiado!'}`;
          setTimeout(() => {
            triggerBtn.innerHTML = originalHTML;
          }, 2000);
        }
      } else {
        throw new Error('Clipboard API indisponível');
      }
    } catch (err) {
      console.error('Erro ao copiar imagem:', err);
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link da imagem copiado para a Área de Transferência! 🔗', 'info');
      } catch {
        showToast('Não foi possível acessar a área de transferência.', 'error');
      }
    }
  }

  // --- Context Menu ---
  function openContextMenu(e, img) {
    activeContextImage = img;
    showEl(imageContextMenu);

    const x = Math.min(e.clientX, window.innerWidth - 270);
    const y = Math.min(e.clientY, window.innerHeight - 200);

    imageContextMenu.style.left = `${x}px`;
    imageContextMenu.style.top = `${y}px`;
  }

  function closeContextMenu() {
    hideEl(imageContextMenu);
    activeContextImage = null;
  }

  ctxCopyImage.addEventListener('click', () => {
    if (activeContextImage) {
      copyImageToClipboard(activeContextImage.url);
      closeContextMenu();
    }
  });

  ctxDownloadImage.addEventListener('click', () => {
    if (activeContextImage) {
      triggerDownload(activeContextImage.url);
      closeContextMenu();
    }
  });

  ctxCopyUrl.addEventListener('click', async () => {
    if (activeContextImage) {
      try {
        await navigator.clipboard.writeText(activeContextImage.url);
        showToast('Link copiado para a Área de Transferência! 🔗', 'success');
      } catch {
        showToast('Falha ao copiar link.', 'error');
      }
      closeContextMenu();
    }
  });

  ctxPreviewImage.addEventListener('click', () => {
    if (activeContextImage) {
      const img = activeContextImage;
      closeContextMenu();
      openPreview(img);
    }
  });

  document.addEventListener('click', (e) => {
    if (!imageContextMenu.contains(e.target)) {
      closeContextMenu();
    }
  });

  // --- Preview Modal ---
  function openPreview(img) {
    previewImage.src = proxyUrl(img.url);
    previewAlt.textContent = img.alt || getFilename(img.url);
    const isVec = isVectorImage(img);
    previewDimensions.textContent = isVec
      ? 'Vetorial SVG (Resolução Infinita ∞)'
      : ((img.naturalWidth && img.naturalHeight)
          ? `${img.naturalWidth} × ${img.naturalHeight} px`
          : 'Calculando dimensões...');
    previewSource.textContent = isVec ? 'VETOR SVG' : (img.source || 'WEB').toUpperCase();

    const filename = getFilename(img.url);
    previewDownload.href = downloadUrl(img.url, filename);
    previewDownload.download = filename;

    previewCopy.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <span>Copiar Imagem</span>
    `;

    previewCopy.onclick = () => copyImageToClipboard(img.url, previewCopy);

    previewImage.oncontextmenu = (e) => {
      e.preventDefault();
      openContextMenu(e, img);
    };

    showEl(previewModal);
    document.body.style.overflow = 'hidden';
  }

  function closePreview() {
    hideEl(previewModal);
    document.body.style.overflow = '';
    previewImage.src = '';
  }

  // --- Bulk Download (Individual) ---
  function downloadSelected() {
    const checkboxes = imageGrid.querySelectorAll('.image-card__checkbox:checked');
    if (checkboxes.length === 0) {
      showToast('Selecione ao menos uma imagem primeiro.', 'info');
      return;
    }

    checkboxes.forEach((cb, i) => {
      const idx = parseInt(cb.dataset.index, 10);
      const img = filteredImages[idx];
      if (img) {
        setTimeout(() => triggerDownload(img.url), i * 250);
      }
    });

    showToast(`Baixando ${checkboxes.length} imagem(ns)...`, 'success');
  }

  // --- Bulk Download (Single ZIP) ---
  async function downloadSelectedAsZip() {
    const checkboxes = imageGrid.querySelectorAll('.image-card__checkbox:checked');
    const targetImages = checkboxes.length > 0
      ? Array.from(checkboxes).map(cb => filteredImages[parseInt(cb.dataset.index, 10)]).filter(Boolean)
      : filteredImages;

    if (targetImages.length === 0) {
      showToast('Nenhuma imagem disponível para baixar.', 'info');
      return;
    }

    showToast(`📦 Compactando ${targetImages.length} imagens em um arquivo ZIP...`, 'info');
    downloadZipBtn.disabled = true;

    try {
      const res = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: targetImages.map((img, i) => ({
            url: img.url,
            filename: `${i + 1}_${getFilename(img.url)}`,
          })),
        }),
      });

      if (!res.ok) throw new Error('Falha ao gerar arquivo ZIP');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `imagens_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('✓ Arquivo ZIP baixado com sucesso!', 'success');
    } catch (err) {
      console.error('Erro no download ZIP:', err);
      showToast('Falha ao baixar arquivo ZIP.', 'error');
    } finally {
      downloadZipBtn.disabled = false;
    }
  }

  // --- Selection Tools ---
  selectAllBtn.addEventListener('click', () => {
    imageGrid.querySelectorAll('.image-card__checkbox').forEach(cb => cb.checked = true);
    showToast('Todas as imagens selecionadas.', 'info');
  });

  deselectAllBtn.addEventListener('click', () => {
    imageGrid.querySelectorAll('.image-card__checkbox').forEach(cb => cb.checked = false);
    showToast('Seleção limpa.', 'info');
  });

  invertSelectionBtn.addEventListener('click', () => {
    imageGrid.querySelectorAll('.image-card__checkbox').forEach(cb => cb.checked = !cb.checked);
  });

  // --- Escape HTML ---
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Event Listeners ---
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let url = urlInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
      urlInput.value = url;
    }
    extractImages(url);
  });

  // Debounced keyword filter
  let filterTimeout = null;
  keywordFilter.addEventListener('input', () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(applyFilter, 150);
  });

  // 1-Click Vector & SVG Filter Toggle
  if (vectorFilterBtn) {
    vectorFilterBtn.addEventListener('click', () => {
      if (formatFilter.value === 'svg') {
        formatFilter.value = 'all';
        vectorFilterBtn.classList.remove('active');
        applyFilter();
        showToast('Exibindo todos os formatos de imagem.', 'info');
      } else {
        formatFilter.value = 'svg';
        sizeFilter.value = '0'; // reset size filter so small vector icons/logos are not hidden
        vectorFilterBtn.classList.add('active');
        applyFilter();
        const total = vectorCountBadge ? vectorCountBadge.textContent : '0';
        showToast(`⚡ Filtrado com 1 clique: apenas Vetores e SVG (${total} encontrados)!`, 'success');
      }
    });
  }

  sizeFilter.addEventListener('change', applyFilter);
  formatFilter.addEventListener('change', applyFilter);
  sortFilter.addEventListener('change', applyFilter);

  downloadAllBtn.addEventListener('click', downloadSelected);
  downloadZipBtn.addEventListener('click', downloadSelectedAsZip);

  modalClose.addEventListener('click', closePreview);
  previewModal.querySelector('.modal__backdrop').addEventListener('click', closePreview);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!imageContextMenu.classList.contains('hidden')) {
        closeContextMenu();
      } else if (!previewModal.classList.contains('hidden')) {
        closePreview();
      } else if (librarySidebar.classList.contains('open')) {
        closeSidebar();
      }
    }
  });

  urlInput.focus();
  renderSavedLinks();
  renderHistory();
})();
