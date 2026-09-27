/* =========================================================
   一、通用工具
   ========================================================= */
const STORAGE_KEY = 'mini_code_editor_projects_v4';
const THEME_KEY = 'mini_code_editor_theme';
const FONT_KEY = 'mini_code_editor_font_size';
const IDB_NAME = 'mini_code_editor_db';
const IDB_VERSION = 3;
const IDB_STORE = 'kv';
const IDB_KEY = 'projects';
const BACKUP_KEY = STORAGE_KEY + '_backup';

const FONT_MIN = 8;
const FONT_MAX = 28;
const FONT_DEFAULT = 14;

const HIGHLIGHT_LIMIT = 30000;
const LINE_NUMBER_LIMIT = 200000;
const PASTE_HIGHLIGHT_DELAY = 200;

const PASTE_CHUNK_SIZE = 30000;
const PASTE_MIN_TRIGGER = 5000;

const UPLOAD_CONCURRENCY = 15;
const TREE_MAX_RENDER = 300;

let storageWarned = false;
let editorFontSize = FONT_DEFAULT;

/* ===== OPFS 支持检测 ===== */
const OPFS_SUPPORTED = !!(navigator.storage && navigator.storage.getDirectory);
let _opfsRootPromise = null;

function getOpfsRoot() {
    if (_opfsRootPromise) return _opfsRootPromise;
    if (!OPFS_SUPPORTED) return Promise.reject(new Error('OPFS 不支持'));
    _opfsRootPromise = navigator.storage.getDirectory();
    return _opfsRootPromise;
}

async function opfsGetProjectDir(projectId, create) {
    const root = await getOpfsRoot();
    return root.getDirectoryHandle('proj_' + projectId, { create: !!create });
}

async function opfsWrite(projectId, fileId, blob) {
    const dir = await opfsGetProjectDir(projectId, true);
    const fh = await dir.getFileHandle(fileId, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
}

async function opfsRead(projectId, fileId) {
    const dir = await opfsGetProjectDir(projectId, false);
    const fh = await dir.getFileHandle(fileId);
    return fh.getFile();
}

async function opfsDelete(projectId, fileId) {
    try {
        const dir = await opfsGetProjectDir(projectId, false);
        await dir.removeEntry(fileId);
    } catch (e) {}
}

async function opfsDeleteProject(projectId) {
    try {
        const root = await getOpfsRoot();
        await root.removeEntry('proj_' + projectId, { recursive: true });
    } catch (e) {}
}

function genId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.textContent = msg;
    el.classList.add('show');
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1400);
}

let _saveIndicatorTimer = null;
function flashSaveIndicator() {
    const el = document.getElementById('saveIndicator');
    if (!el) return;
    el.classList.add('show');
    clearTimeout(_saveIndicatorTimer);
    _saveIndicatorTimer = setTimeout(function () {
        el.classList.remove('show');
    }, 800);
}

/* =========================================================
   二、IndexedDB（只存项目元数据）
   ========================================================= */
let _idbPromise = null;

function openIDB() {
    if (_idbPromise) return _idbPromise;
    _idbPromise = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('浏览器不支持 IndexedDB')); return; }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = function (e) {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function (e) { reject(e.target.error); };
    });
    return _idbPromise;
}

function idbGet(key) {
    return openIDB().then(function (db) {
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    });
}

function idbSet(key, value) {
    return openIDB().then(function (db) {
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            const req = tx.objectStore(IDB_STORE).put(value, key);
            req.onsuccess = function () { resolve(); };
            req.onerror = function () { reject(req.error); };
        });
    });
}

/* ===== 文件内容的读写（走 OPFS） ===== */
const _fileContentCache = Object.create(null);
const _blobUrlCache = Object.create(null);

async function loadFileContent(projectId, fileId) {
    if (fileId in _fileContentCache) return _fileContentCache[fileId];
    if (!OPFS_SUPPORTED) return null;
    try {
        const f = await opfsRead(projectId, fileId);
        const text = await f.text();
        _fileContentCache[fileId] = text;
        return text;
    } catch (e) {
        console.warn('OPFS 读失败：', fileId, e);
        return null;
    }
}

function getBlobUrl(projectId, fileId) {
    if (_blobUrlCache[fileId]) return _blobUrlCache[fileId];
    return null;
}

async function ensureBlobUrl(projectId, fileId) {
    if (_blobUrlCache[fileId]) return _blobUrlCache[fileId];
    if (!OPFS_SUPPORTED) return null;
    try {
        const f = await opfsRead(projectId, fileId);
        const url = URL.createObjectURL(f);
        _blobUrlCache[fileId] = url;
        return url;
    } catch (e) {
        console.warn('OPFS Blob URL 失败：', fileId, e);
        return null;
    }
}

function revokeBlobUrl(fileId) {
    if (_blobUrlCache[fileId]) {
        try { URL.revokeObjectURL(_blobUrlCache[fileId]); } catch (e) {}
        delete _blobUrlCache[fileId];
    }
}

/* =========================================================
   三、主题切换
   ========================================================= */
function initTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
    applyTheme(theme);
}

function applyTheme(theme) {
    if (theme === 'light') document.body.classList.add('light-theme');
    else document.body.classList.remove('light-theme');
    const menu = document.getElementById('themeMenu');
    if (menu) {
        const items = menu.querySelectorAll('.theme-menu-item');
        for (let i = 0; i < items.length; i++) {
            items[i].classList.toggle('active', items[i].dataset.theme === theme);
        }
    }
}

function setTheme(theme, e) {
    if (e) e.stopPropagation();
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) {}
    applyTheme(theme);
    closeThemeMenu();
}

function toggleThemeMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('themeMenu');
    if (!menu) return;
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
}

function closeThemeMenu() {
    const menu = document.getElementById('themeMenu');
    if (menu) menu.style.display = 'none';
}

document.addEventListener('click', function (e) {
    const menu = document.getElementById('themeMenu');
    const btn = document.getElementById('themeBtn');
    if (!menu || !btn) return;
    if (!menu.contains(e.target) && !btn.contains(e.target)) closeThemeMenu();
});

/* =========================================================
   四、运行日志系统
   ========================================================= */
let warnLogs = [];
let warnMissingSet = new Set();
let warnPanelVisible = false;

function addWarnLog(type, data) {
    if (type === 'error' && typeof data === 'string' && data.startsWith('缺失文件：')) {
        if (warnMissingSet.has(data)) return;
        warnMissingSet.add(data);
    }
    if (warnLogs.length > 500) warnLogs.shift();
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    warnLogs.push({ type: type, data: String(data), time: time });
    renderWarnList();
}

function renderWarnList() {
    const listEl = document.getElementById('warnList');
    const badgeEl = document.getElementById('warnBadge');
    const btnEl = document.getElementById('warnBtn');
    const countEl = document.getElementById('warnCount');
    if (!listEl) return;

    const errCount = warnLogs.filter(l => l.type === 'error').length;
    const total = warnLogs.length;

    if (total === 0) {
        listEl.innerHTML = '<div class="warn-empty"><span class="ok-icon">✓</span>暂无错误或警告</div>';
        badgeEl.classList.remove('show');
        btnEl.classList.remove('has-errors');
        if (countEl) countEl.textContent = '';
        return;
    }

    badgeEl.textContent = total > 99 ? '99+' : String(total);
    badgeEl.classList.add('show');
    if (errCount > 0) btnEl.classList.add('has-errors');
    else btnEl.classList.remove('has-errors');
    if (countEl) countEl.textContent = ' · ' + errCount + ' 个错误 / ' + total + ' 条';

    listEl.innerHTML = warnLogs.map(function (log) {
        const icon = log.type === 'error' ? '✕' : '⚠';
        return '<div class="warn-item ' + log.type + '">' +
            '<span class="warn-icon">' + icon + '</span>' +
            '<span class="warn-text">' + escapeHtml(log.data) + '</span>' +
            '<span class="warn-time">' + log.time + '</span></div>';
    }).join('');
    listEl.scrollTop = listEl.scrollHeight;
}

function clearWarnLog() {
    warnLogs = [];
    warnMissingSet.clear();
    renderWarnList();
}

function toggleWarnPanel() {
    const panel = document.getElementById('warnPanel');
    warnPanelVisible = !warnPanelVisible;
    if (warnPanelVisible) panel.classList.add('show');
    else panel.classList.remove('show');
}

function hideWarnPanel() {
    warnPanelVisible = false;
    document.getElementById('warnPanel').classList.remove('show');
}

window.addEventListener('message', function (e) {
    const data = e.data;
    if (!data || !data.__editorLog) return;
    addWarnLog(data.type || 'error', data.data || '');
});

/* =========================================================
   五、警告按钮拖动
   ========================================================= */
(function initWarnButton() {
    const btn = document.getElementById('warnBtn');
    if (!btn) return;

    let isDragging = false, dragMoved = false;
    let startX = 0, startY = 0, dragOffsetX = 0, dragOffsetY = 0;
    let savedPos = null, activePointerId = null;
    let savedHtmlOverflow = '', savedBodyOverflow = '';
    let savedHtmlTouch = '', savedBodyTouch = '';

    function getViewportSize() {
        const de = document.documentElement;
        const w = (de && de.clientWidth) || window.innerWidth || 0;
        const h = (de && de.clientHeight) || window.innerHeight || 0;
        return { w: w, h: h };
    }

    function applyPos(x, y) {
        const vp = getViewportSize();
        const bw = btn.offsetWidth, bh = btn.offsetHeight;
        const maxX = Math.max(0, vp.w - bw), maxY = Math.max(0, vp.h - bh);
        const nx = Math.max(4, Math.min(maxX - 4, x));
        const ny = Math.max(4, Math.min(maxY - 4, y));
        btn.style.left = nx + 'px';
        btn.style.top = ny + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
        savedPos = { x: nx, y: ny };
    }

    function onMove(e) {
        if (!isDragging) return;
        if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
        if (e.isPrimary === false) return;
        let cx, cy;
        if (e.touches && e.touches.length > 0) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
        else { cx = e.clientX; cy = e.clientY; }
        if (cx === undefined || cy === undefined) return;
        if (!dragMoved) {
            if (Math.abs(cx - startX) < 4 && Math.abs(cy - startY) < 4) return;
            dragMoved = true;
        }
        if (e.cancelable) e.preventDefault();
        applyPos(cx - dragOffsetX, cy - dragOffsetY);
    }

    function lockScroll() {
        const html = document.documentElement, body = document.body;
        savedHtmlOverflow = html.style.overflow; savedBodyOverflow = body.style.overflow;
        savedHtmlTouch = html.style.touchAction; savedBodyTouch = body.style.touchAction;
        html.style.overflow = 'hidden'; body.style.overflow = 'hidden';
        html.style.touchAction = 'none'; body.style.touchAction = 'none';
    }

    function unlockScroll() {
        const html = document.documentElement, body = document.body;
        html.style.overflow = savedHtmlOverflow; body.style.overflow = savedBodyOverflow;
        html.style.touchAction = savedHtmlTouch; body.style.touchAction = savedBodyTouch;
    }

    function onEnd(e) {
        if (!isDragging) return;
        if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
        isDragging = false;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onEnd, true);
        document.removeEventListener('pointercancel', onEnd, true);
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onEnd, true);
        document.removeEventListener('touchmove', onMove, true);
        document.removeEventListener('touchend', onEnd, true);
        document.removeEventListener('touchcancel', onEnd, true);
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onEnd, true);
        window.removeEventListener('pointercancel', onEnd, true);
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onEnd, true);
        window.removeEventListener('touchmove', onMove, true);
        window.removeEventListener('touchend', onEnd, true);
        try { if (activePointerId !== null) btn.releasePointerCapture(activePointerId); } catch (err) {}
        activePointerId = null;
        document.body.classList.remove('dragging-warn');
        btn.style.zIndex = '';
        unlockScroll();
        setTimeout(function () { dragMoved = false; }, 100);
    }

    function startDrag(clientX, clientY, pointerId) {
        const rect = btn.getBoundingClientRect();
        dragOffsetX = clientX - rect.left; dragOffsetY = clientY - rect.top;
        startX = clientX; startY = clientY;
        isDragging = true; dragMoved = false;
        activePointerId = (pointerId !== undefined) ? pointerId : null;
        document.body.classList.add('dragging-warn');
        btn.style.zIndex = '9999';
        lockScroll();
        if (pointerId !== undefined) {
            try { btn.setPointerCapture(pointerId); } catch (err) {}
        }
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onEnd, true);
        document.addEventListener('pointercancel', onEnd, true);
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onEnd, true);
        document.addEventListener('touchmove', onMove, { passive: false, capture: true });
        document.addEventListener('touchend', onEnd, true);
        document.addEventListener('touchcancel', onEnd, true);
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onEnd, true);
        window.addEventListener('pointercancel', onEnd, true);
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onEnd, true);
        window.addEventListener('touchmove', onMove, { passive: false, capture: true });
        window.addEventListener('touchend', onEnd, true);
    }

    btn.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.isPrimary === false) return;
        e.preventDefault(); e.stopPropagation();
        startDrag(e.clientX, e.clientY, e.pointerId);
    });

    btn.addEventListener('click', function (e) {
        if (dragMoved) { e.preventDefault(); e.stopPropagation(); return; }
        toggleWarnPanel();
    });

    window.addEventListener('resize', function () {
        if (!savedPos) return;
        applyPos(savedPos.x, savedPos.y);
    });
})();

/* =========================================================
   六、数据与持久化
   ========================================================= */
const DEFAULT_PROJECTS = [
    {
        id: 'default-project',
        name: '默认项目',
        fileTree: [
            { id: 'root', name: '项目根目录', type: 'folder', children: [] }
        ]
    }
];

let projects = [];
let currentProjectId = null;
let currentFileId = null;
let isTreeCollapsed = true;
let saveTimer = null;
let expandedFolderId = null;
let highlightPending = false;

function syncCurrentFileContent() {
    if (!currentProjectId || !currentFileId) return;
    const file = findFileById(currentFileId);
    const editor = document.getElementById('codeEditor');
    if (file && editor && file.editable !== false) {
        file.content = editor.value;
    }
}

function stringifyProjects() {
    return JSON.stringify(projects, function (key, value) {
        if (key === '_undoStack' || key === '_redoStack' || key === '_blobUrl') return undefined;
        if (key === 'content' && this && typeof this === 'object' && this.inOpfs === true) {
            return undefined;
        }
        return value;
    });
}

function saveProjects(silent) {
    syncCurrentFileContent();
    const json = stringifyProjects();
    idbSet(IDB_KEY, json)
        .then(flashSaveIndicator)
        .catch(function (err) {
            console.warn('IndexedDB 保存失败：', err);
            try { localStorage.setItem(STORAGE_KEY, json); } catch (e) {}
        });
    return true;
}

async function loadProjects() {
    let data = null;
    try {
        const raw = await idbGet(IDB_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) data = parsed;
        }
    } catch (e) { console.warn('IDB 读取失败：', e); }

    if (!data) {
        try {
            const raw = localStorage.getItem(BACKUP_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) data = parsed;
            }
        } catch (e) {}
    }

    if (!data) {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    data = parsed;
                    try { await idbSet(IDB_KEY, raw); } catch (e) {}
                    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
                }
            }
        } catch (e) {}
    }

    if (data) {
        data.forEach(function (proj) {
            (function cleanTree(nodes) {
                if (!nodes) return;
                nodes.forEach(function (n) {
                    delete n._undoStack;
                    delete n._redoStack;
                    if (n.children) cleanTree(n.children);
                });
            })(proj.fileTree);
        });
    }
    return data;
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveProjects(true); }, 600);
}

function getCurrentFileTree() {
    const proj = projects.find(p => p.id === currentProjectId);
    return proj ? proj.fileTree : [];
}

function setCurrentFileTree(tree) {
    const proj = projects.find(p => p.id === currentProjectId);
    if (proj) proj.fileTree = tree;
}

/* =========================================================
   七、编辑器 DOM 引用
   ========================================================= */
const codeEditorEl = document.getElementById('codeEditor');
const highlightLayerEl = document.getElementById('highlightLayer');
const gutterEl = document.getElementById('gutter');
const editorRootEl = document.getElementById('editor');

/* =========================================================
   八、字号缩放
   ========================================================= */
function loadFontSize() {
    let s = FONT_DEFAULT;
    try {
        const v = parseInt(localStorage.getItem(FONT_KEY), 10);
        if (!isNaN(v) && v >= FONT_MIN && v <= FONT_MAX) s = v;
    } catch (e) {}
    return s;
}

function applyFontSize(size) {
    size = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(size)));
    if (size === editorFontSize) return;
    editorFontSize = size;
    const lineHeight = Math.round(size * 1.45);
    const root = document.documentElement;
    root.style.setProperty('--editor-font-size', size + 'px');
    root.style.setProperty('--editor-line-height', lineHeight + 'px');
    try { localStorage.setItem(FONT_KEY, String(size)); } catch (e) {}
    updateHighlight();
    showToast('字号 ' + size + 'px');
}

function initFontSize() {
    editorFontSize = loadFontSize();
    const lineHeight = Math.round(editorFontSize * 1.45);
    const root = document.documentElement;
    root.style.setProperty('--editor-font-size', editorFontSize + 'px');
    root.style.setProperty('--editor-line-height', lineHeight + 'px');
}

codeEditorEl.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (e.deltaY < 0) applyFontSize(editorFontSize + 1);
    else applyFontSize(editorFontSize - 1);
}, { passive: false });

(function initPinchZoom() {
    let pinchActive = false, startDist = 0, startSize = FONT_DEFAULT;
    function distance(t1, t2) {
        const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    codeEditorEl.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
            pinchActive = true;
            startDist = distance(e.touches[0], e.touches[1]);
            startSize = editorFontSize;
        }
    }, { passive: true });
    codeEditorEl.addEventListener('touchmove', function (e) {
        if (!pinchActive || e.touches.length !== 2) return;
        e.preventDefault();
        const dist = distance(e.touches[0], e.touches[1]);
        if (startDist < 10) return;
        applyFontSize(startSize * (dist / startDist));
    }, { passive: false });
    codeEditorEl.addEventListener('touchend', function (e) {
        if (e.touches.length < 2) pinchActive = false;
    });
    codeEditorEl.addEventListener('touchcancel', function () { pinchActive = false; });
})();

/* =========================================================
   九、编辑器渲染
   ========================================================= */
function isImageMode() { return editorRootEl.classList.contains('image-mode'); }
function isAudioMode() { return editorRootEl.classList.contains('audio-mode'); }

let _lastLineCount = -1;
function buildLineNumbers(lineCount) {
    if (lineCount === _lastLineCount) return;
    _lastLineCount = lineCount;
    if (lineCount <= 0) { gutterEl.textContent = ''; return; }
    const arr = new Array(lineCount);
    for (let k = 0; k < lineCount; k++) arr[k] = k + 1;
    gutterEl.textContent = arr.join('\n');
}

function updateHighlight() {
    if (isImageMode() || isAudioMode()) {
        highlightLayerEl.textContent = '';
        gutterEl.textContent = '';
        _lastLineCount = -1;
        return;
    }
    const code = codeEditorEl.value;
    const len = code.length;
    if (len > LINE_NUMBER_LIMIT) {
        highlightLayerEl.textContent = code;
        gutterEl.textContent = '';
        _lastLineCount = -1;
        syncScroll();
        return;
    }
    if (len > HIGHLIGHT_LIMIT) {
        highlightLayerEl.textContent = code;
    } else {
        const file = currentFileId ? findFileById(currentFileId) : null;
        const lang = file ? getLangFromName(file.name) : 'plain';
        highlightLayerEl.innerHTML = highlight(code, lang);
    }
    requestAnimationFrame(function () {
        const cs = window.getComputedStyle(codeEditorEl);
        const lineHeight = parseFloat(cs.lineHeight) || 22;
        const paddingTop = parseFloat(cs.paddingTop) || 12;
        const contentH = highlightLayerEl.scrollHeight - paddingTop * 2;
        const lineCount = Math.max(1, Math.round(contentH / lineHeight));
        buildLineNumbers(lineCount);
        syncScroll();
    });
}

let _highlightTimer = null;
function requestHighlight() {
    if (highlightPending) return;
    highlightPending = true;
    requestAnimationFrame(function () { highlightPending = false; updateHighlight(); });
}

function requestHighlightSlow() {
    clearTimeout(_highlightTimer);
    _highlightTimer = setTimeout(updateHighlight, PASTE_HIGHLIGHT_DELAY);
}

function syncScroll() {
    highlightLayerEl.scrollTop = codeEditorEl.scrollTop;
    highlightLayerEl.scrollLeft = codeEditorEl.scrollLeft;
    gutterEl.scrollTop = codeEditorEl.scrollTop;
}

codeEditorEl.addEventListener('scroll', syncScroll);
codeEditorEl.addEventListener('keyup', syncScroll);
codeEditorEl.addEventListener('click', syncScroll);
codeEditorEl.addEventListener('focus', syncScroll);
document.addEventListener('selectionchange', function () {
    if (document.activeElement === codeEditorEl) syncScroll();
});
codeEditorEl.addEventListener('compositionupdate', syncScroll);
codeEditorEl.addEventListener('compositionend', function () {
    requestAnimationFrame(syncScroll);
});

/* =========================================================
   十、撤销 / 重做
   ========================================================= */
let snapshotTimer = null;

function ensureHistory(file) {
    if (!file) return;
    if (!file._undoStack) {
        file._undoStack = [file.content || ''];
        file._redoStack = [];
    }
}

function takeSnapshot() {
    if (!currentFileId) return;
    const file = findFileById(currentFileId);
    if (!file || file.editable === false) return;
    ensureHistory(file);
    const current = codeEditorEl.value;
    const stack = file._undoStack;
    if (stack[stack.length - 1] !== current) {
        stack.push(current);
        if (stack.length > 200) stack.shift();
        file._redoStack = [];
    }
    updateUndoRedoButtons();
}

function scheduleSnapshot() {
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(takeSnapshot, 400);
}

function undo() {
    if (!currentFileId) return;
    const file = findFileById(currentFileId);
    if (!file || file.editable === false) return;
    clearTimeout(snapshotTimer);
    ensureHistory(file);
    const stack = file._undoStack;
    const current = codeEditorEl.value;
    if (stack[stack.length - 1] !== current) {
        stack.push(current); file._redoStack = [];
    }
    if (stack.length <= 1) { showToast('没有可撤销的操作'); updateUndoRedoButtons(); return; }
    const cur = stack.pop(); file._redoStack.push(cur);
    const prev = stack[stack.length - 1];
    codeEditorEl.value = prev;
    file.content = prev;
    updateHighlight();
    updateUndoRedoButtons();
    scheduleSave();
    showToast('已撤销');
}

function redo() {
    if (!currentFileId) return;
    const file = findFileById(currentFileId);
    if (!file || file.editable === false) return;
    clearTimeout(snapshotTimer);
    ensureHistory(file);
    if (!file._redoStack || file._redoStack.length === 0) {
        showToast('没有可重做的操作'); updateUndoRedoButtons(); return;
    }
    const next = file._redoStack.pop();
    file._undoStack.push(next);
    codeEditorEl.value = next;
    file.content = next;
    updateHighlight();
    updateUndoRedoButtons();
    scheduleSave();
    showToast('已重做');
}

function updateUndoRedoButtons() {
    const btnUndo = document.getElementById('btnUndo');
    const btnRedo = document.getElementById('btnRedo');
    if (!btnUndo || !btnRedo) return;
    let canUndo = false, canRedo = false;
    if (currentFileId) {
        const file = findFileById(currentFileId);
        if (file && file.editable !== false) {
            const stack = file._undoStack || [];
            const redoStack = file._redoStack || [];
            const cur = codeEditorEl.value;
            canUndo = stack.length > 1 || (stack.length > 0 && stack[stack.length - 1] !== cur);
            canRedo = redoStack.length > 0;
        }
    }
    btnUndo.disabled = !canUndo;
    btnRedo.disabled = !canRedo;
}

codeEditorEl.addEventListener('input', function (e) {
    if (currentFileId) {
        const file = findFileById(currentFileId);
        if (file && file.editable !== false) file.content = this.value;
    }
    const isPaste = e && typeof e.inputType === 'string' &&
                    e.inputType.indexOf('insertFromPaste') === 0;
    if (isPaste || this.value.length > HIGHLIGHT_LIMIT) requestHighlightSlow();
    else requestHighlight();
    scheduleSnapshot();
    updateUndoRedoButtons();
    scheduleSave();
});

codeEditorEl.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.selectionStart, end = this.selectionEnd, val = this.value;
        this.value = val.slice(0, start) + '    ' + val.slice(end);
        this.selectionStart = this.selectionEnd = start + 4;
        if (currentFileId) {
            const file = findFileById(currentFileId);
            if (file) file.content = this.value;
        }
        requestHighlight();
        scheduleSnapshot();
        updateUndoRedoButtons();
        scheduleSave();
        return;
    }
    if (e.key === 'Enter') {
        const start = this.selectionStart, val = this.value;
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineText = val.slice(lineStart, start);
        const indentMatch = lineText.match(/^[ \t]*/);
        const indent = indentMatch ? indentMatch[0] : '';
        let extra = '';
        if (/[{\[(:>]\s*$/.test(lineText)) extra = '    ';
        if (indent || extra) {
            e.preventDefault();
            const ins = '\n' + indent + extra;
            const endPos = this.selectionEnd;
            this.value = val.slice(0, start) + ins + val.slice(endPos);
            this.selectionStart = this.selectionEnd = start + ins.length;
            if (currentFileId) {
                const file = findFileById(currentFileId);
                if (file) file.content = this.value;
            }
            requestHighlight();
            scheduleSnapshot();
            updateUndoRedoButtons();
            scheduleSave();
        }
    }
});

/* =========================================================
   十一、搜索
   ========================================================= */
let searchStatusTimer = null;

function showSearchStatus(msg, isError) {
    const el = document.getElementById('searchStatus');
    clearTimeout(searchStatusTimer);
    if (!msg) { el.classList.remove('show'); return; }
    el.textContent = msg;
    el.className = 'search-status ' + (isError ? 'error' : 'ok');
    void el.offsetWidth;
    el.classList.add('show');
    searchStatusTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
}

function onSearchInput() { showSearchStatus(''); }

let cachedCharWidth = null;
function getCharWidth() {
    if (cachedCharWidth !== null) return cachedCharWidth;
    const cs = window.getComputedStyle(codeEditorEl);
    const probe = document.createElement('span');
    probe.style.cssText =
        'position:absolute;visibility:hidden;white-space:pre;' +
        'font-family:' + cs.fontFamily + ';' +
        'font-size:' + cs.fontSize + ';' +
        'letter-spacing:' + cs.letterSpacing + ';';
    probe.textContent = 'MMMMMMMMMM';
    document.body.appendChild(probe);
    cachedCharWidth = probe.offsetWidth / 10;
    document.body.removeChild(probe);
    return cachedCharWidth;
}

function scrollEditorToSelection() {
    const text = codeEditorEl.value;
    const pos = codeEditorEl.selectionStart;
    const before = text.substring(0, pos);
    const lineIndex = before.split('\n').length - 1;
    const lastNL = before.lastIndexOf('\n');
    const col = pos - (lastNL + 1);

    const cs = window.getComputedStyle(codeEditorEl);
    const lineHeight = parseFloat(cs.lineHeight) || 22;
    const paddingTop = parseFloat(cs.paddingTop) || 12;
    const paddingLeft = parseFloat(cs.paddingLeft) || 12;

    const matchY = paddingTop + lineIndex * lineHeight;
    const targetTop = matchY - (codeEditorEl.clientHeight - lineHeight) / 2;
    codeEditorEl.scrollTop = Math.max(0, targetTop);

    const charWidth = getCharWidth();
    const matchX = paddingLeft + col * charWidth;
    const targetLeft = matchX - codeEditorEl.clientWidth / 2;
    codeEditorEl.scrollLeft = Math.max(0, targetLeft);
    syncScroll();
}

function doSearch() {
    if (isImageMode() || isAudioMode() || codeEditorEl.disabled) {
        showSearchStatus('当前文件不支持搜索', true); return;
    }
    const inputEl = document.getElementById('searchInput');
    const term = inputEl.value;
    if (!term) { showSearchStatus('请输入搜索内容', true); inputEl.focus(); return; }

    const text = codeEditorEl.value;
    const selStart = codeEditorEl.selectionStart;
    const selEnd = codeEditorEl.selectionEnd;
    const selectedText = text.substring(selStart, selEnd);

    let from = (selectedText === term) ? selEnd : selStart;
    let idx = text.indexOf(term, from);
    if (idx === -1 && from > 0) {
        idx = text.indexOf(term, 0);
        if (idx === selStart && selectedText === term) {
            showSearchStatus('没有更多匹配了', true); return;
        }
    }
    if (idx === -1) { showSearchStatus('没有找到「' + term + '」', true); return; }

    codeEditorEl.focus();
    codeEditorEl.setSelectionRange(idx, idx + term.length);
    scrollEditorToSelection();
    showSearchStatus('已找到', false);
}

/* =========================================================
   十二、文件树与项目
   ========================================================= */
async function init() {
    initTheme();
    initFontSize();
    const saved = await loadProjects();
    if (saved) projects = saved;
    else { projects = JSON.parse(JSON.stringify(DEFAULT_PROJECTS)); saveProjects(true); }

    renderProjectList();
    renderWarnList();
    isTreeCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('toolbar').style.display = 'none';
}

function renderProjectList() {
    const container = document.getElementById('projectCards');
    const emptyState = document.getElementById('emptyState');
    container.innerHTML = '';

    if (projects.length === 0) { emptyState.style.display = 'block'; return; }
    emptyState.style.display = 'none';

    projects.forEach(proj => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.onclick = () => enterProject(proj.id);

        const fileCount = countFiles(proj.fileTree);
        const folderCount = countFolders(proj.fileTree);

        card.innerHTML = `
            <div class="project-card-actions">
                <button class="proj-btn proj-rename" type="button" title="重命名项目">✏️</button>
                <button class="proj-btn proj-delete" type="button" title="删除项目">🗑️</button>
            </div>
            <div class="project-card-name">📁 ${escapeHtml(proj.name)}</div>
            <div class="project-card-info">${fileCount} 个文件 · ${folderCount} 个文件夹</div>
            <span class="project-card-badge">点击进入</span>
        `;

        card.querySelector('.proj-rename').addEventListener('click', function (e) {
            e.stopPropagation();
            renameProject(proj.id);
        });
        card.querySelector('.proj-delete').addEventListener('click', function (e) {
            e.stopPropagation();
            deleteProject(proj.id);
        });

        container.appendChild(card);
    });
}

function renameProject(id) {
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    const newName = prompt('重命名项目：', proj.name);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === proj.name) return;
    proj.name = trimmed;
    renderProjectList();
    saveProjects(true);
    showToast('已重命名');
}

function deleteProject(id) {
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    if (!confirm('确定删除项目「' + proj.name + '」吗？\n该项目下的所有文件都会被删除，操作不可撤销。')) return;

    if (currentProjectId === id) {
        currentProjectId = null;
        currentFileId = null;
        expandedFolderId = null;
        stopPreview();
        document.getElementById('editorArea').style.display = 'none';
        document.getElementById('toolbar').style.display = 'none';
        document.getElementById('fab').classList.remove('hidden');
        isTreeCollapsed = true;
        document.getElementById('sidebar').classList.add('collapsed');
        document.getElementById('fileTree').innerHTML = '';
        const themeBtn = document.getElementById('themeBtn');
        if (themeBtn) themeBtn.style.display = 'flex';
        /* ★ 恢复下载按钮 */
        const dlBtn = document.getElementById('downloadBtn');
        if (dlBtn) dlBtn.style.display = '';
    }

    opfsDeleteProject(id);

    projects = projects.filter(p => p.id !== id);
    renderProjectList();
    saveProjects(true);
    showToast('已删除项目');
}

function countFiles(nodes) {
    let count = 0;
    for (const node of nodes) {
        if (node.type === 'file') count++;
        if (node.children) count += countFiles(node.children);
    }
    return count;
}

function countFolders(nodes) {
    let count = 0;
    for (const node of nodes) {
        if (node.type === 'folder') count++;
        if (node.children) count += countFolders(node.children);
    }
    return count;
}

function findFirstFile(nodes) {
    for (const node of nodes) {
        if (node.type === 'file') return node;
        if (node.children) {
            const found = findFirstFile(node.children);
            if (found) return found;
        }
    }
    return null;
}

function enterProject(projectId) {
    currentProjectId = projectId;
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;

    document.getElementById('projectListView').style.display = 'none';
    document.getElementById('editorArea').style.display = 'flex';
    document.getElementById('fab').classList.add('hidden');

    const toolbar = document.getElementById('toolbar');
    toolbar.style.display = 'flex';
    document.getElementById('btnToggleTree').style.display = 'inline-block';
    document.getElementById('btnExit').style.display = 'inline-block';
    document.getElementById('btnRun').style.display = 'inline-block';
    document.getElementById('btnStop').style.display = 'none';
    document.getElementById('zipWrapper').style.display = 'inline-block';

    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.style.display = 'none';
    /* ★ 隐藏下载按钮 */
    const dlBtn = document.getElementById('downloadBtn');
    if (dlBtn) dlBtn.style.display = 'none';
    closeThemeMenu();

    document.getElementById('searchInput').value = '';
    showSearchStatus('');

    isTreeCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
    expandedFolderId = 'root';

    renderFileTree();

    const firstFile = findFirstFile(getCurrentFileTree());
    if (firstFile) selectFile(firstFile.id);
    else updateUndoRedoButtons();
}

function backToProjectList() {
    syncCurrentFileContent();
    saveProjects(true);
    currentProjectId = null;
    currentFileId = null;
    expandedFolderId = null;
    stopPreview();
    closeZipMenu();
    document.getElementById('projectListView').style.display = 'flex';
    document.getElementById('editorArea').style.display = 'none';
    document.getElementById('fab').classList.remove('hidden');
    document.getElementById('toolbar').style.display = 'none';
    isTreeCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('fileTree').innerHTML = '';
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.style.display = 'flex';
    /* ★ 恢复下载按钮 */
    const dlBtn = document.getElementById('downloadBtn');
    if (dlBtn) dlBtn.style.display = '';
    renderProjectList();
}

function exitProject() { backToProjectList(); }

function findFileById(id, nodes) {
    if (!nodes) nodes = getCurrentFileTree();
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children) {
            const found = findFileById(id, node.children);
            if (found) return found;
        }
    }
    return null;
}

function findFileByName(name, nodes) {
    if (!nodes) nodes = getCurrentFileTree();
    for (const node of nodes) {
        if (node.type === 'file' && node.name === name) return node;
        if (node.children) {
            const found = findFileByName(name, node.children);
            if (found) return found;
        }
    }
    return null;
}

function findParent(id, nodes, parent) {
    if (!nodes) nodes = getCurrentFileTree();
    if (parent === undefined) parent = null;
    for (const node of nodes) {
        if (node.id === id) return parent;
        if (node.children) {
            const found = findParent(id, node.children, node);
            if (found !== null) return found;
        }
    }
    return null;
}

/* =========================================================
   文件树渲染（带上限）
   ========================================================= */
function renderFileTree() {
    const treeEl = document.getElementById('fileTree');
    treeEl.innerHTML = '';
    const nodes = getCurrentFileTree();

    let renderedCount = 0;
    let totalCount = 0;

    function renderNodes(nodes, container) {
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            totalCount++;
            if (renderedCount >= TREE_MAX_RENDER) continue;

            if (node.type === 'folder') {
                const isExpanded = expandedFolderId === node.id;
                const folderEl = document.createElement('div');
                folderEl.className = 'folder' + (isExpanded ? ' expanded' : '');
                folderEl.innerHTML = `
                    <div class="file-item-row" onclick="toggleFolder('${node.id}')">
                        <div class="file-item">
                            <span class="icon">${isExpanded ? '📂' : '📁'}</span>
                            <span class="name">${escapeHtml(node.name)}</span>
                            <span class="actions">
                                <button onclick="event.stopPropagation(); renameItem('${node.id}')" title="重命名">✏️</button>
                                <button onclick="event.stopPropagation(); deleteItem('${node.id}')" title="删除">🗑️</button>
                            </span>
                        </div>
                    </div>
                    <div class="file-children"></div>
                `;
                const childrenContainer = folderEl.querySelector('.file-children');
                renderNodes(node.children, childrenContainer);
                container.appendChild(folderEl);
            } else {
                const fileEl = document.createElement('div');
                fileEl.className = 'file-item-row';
                let icon = '📄';
                if (node.uploaded) {
                    if (node.isImage) icon = '🖼️';
                    else if (node.isAudio) icon = '🎵';
                    else icon = '📎';
                }
                const tip = node.originalName && node.originalName !== node.name
                    ? ` title="原文件名：${escapeHtml(node.originalName)}"`
                    : '';
                fileEl.innerHTML = `
                    <div class="file-item ${currentFileId === node.id ? 'active' : ''}" onclick="selectFile('${node.id}')"${tip}>
                        <span class="icon">${icon}</span>
                        <span class="name">${escapeHtml(node.name)}</span>
                        <span class="actions">
                            <button onclick="event.stopPropagation(); renameItem('${node.id}')" title="重命名">✏️</button>
                            <button onclick="event.stopPropagation(); deleteItem('${node.id}')" title="删除">🗑️</button>
                        </span>
                    </div>
                `;
                container.appendChild(fileEl);
            }
            renderedCount++;
        }
    }
    renderNodes(nodes, treeEl);

    if (totalCount > TREE_MAX_RENDER) {
        const hint = document.createElement('div');
        hint.style.cssText = 'padding:14px;color:#888;font-size:12px;text-align:center;line-height:1.6;';
        hint.textContent = '共 ' + totalCount + ' 项，仅显示前 ' + TREE_MAX_RENDER + ' 项';
        treeEl.appendChild(hint);
    }
}

function toggleFolder(id) {
    expandedFolderId = (expandedFolderId === id) ? null : id;
    renderFileTree();
}

function toggleFileTree() {
    isTreeCollapsed = !isTreeCollapsed;
    const sidebar = document.getElementById('sidebar');
    if (isTreeCollapsed) sidebar.classList.add('collapsed');
    else sidebar.classList.remove('collapsed');
}

function getFileInfoText(file) {
    const isImage = file.isImage || (file.mime && file.mime.startsWith('image/'));
    const isAudio = file.isAudio || (file.mime && file.mime.startsWith('audio/'));
    let text = '';
    if (file.originalName && file.originalName !== file.name) {
        text += '📎 原始文件名：' + file.originalName + '\n';
    }
    text += '📎 当前名称：' + file.name + '\n';
    text += '类型：' + (file.mime || '未知') + '\n';
    text += '大小：' + (file.size ? formatSize(file.size) : '未知') + '\n\n';
    if (isImage) {
        text += '✅ 这个图片已经保存在项目中\n在 HTML 里这样引用它：\n\n  <img src="' + file.name + '" alt="">\n';
    } else if (isAudio) {
        text += '✅ 这个音频已经保存在项目中\n在 HTML 里这样引用它：\n\n  <audio src="' + file.name + '" controls></audio>\n';
    } else {
        text += '这是二进制文件，已保存到项目中，可以在 HTML 里通过文件名引用。';
    }
    return text;
}

function stopAudioViewer() {
    const audioPlayer = document.getElementById('audioViewerPlayer');
    if (!audioPlayer) return;
    try { audioPlayer.pause(); } catch (e) {}
    audioPlayer.removeAttribute('src');
    try { audioPlayer.load(); } catch (e) {}
}

async function selectFile(id) {
    const file = findFileById(id);
    if (!file || file.type === 'folder') return;

    stopAudioViewer();

    if (currentFileId && currentFileId !== id) {
        const cur = findFileById(currentFileId);
        if (cur && cur.editable !== false) cur.content = codeEditorEl.value;
        clearTimeout(snapshotTimer);
    }

    currentFileId = id;

    if (file.inOpfs && file.editable !== false && !file.content) {
        const text = await loadFileContent(currentProjectId, file.id);
        file.content = text || '';
    }

    ensureHistory(file);

    const imageViewer = document.getElementById('imageViewer');
    const imageViewerImg = document.getElementById('imageViewerImg');
    const imageViewerMeta = document.getElementById('imageViewerMeta');
    const audioViewer = document.getElementById('audioViewer');
    const audioViewerName = document.getElementById('audioViewerName');
    const audioViewerMeta = document.getElementById('audioViewerMeta');
    const audioPlayer = document.getElementById('audioViewerPlayer');

    const isImage = file.isImage;
    const isAudio = file.isAudio;

    imageViewer.classList.remove('active');
    audioViewer.classList.remove('active');
    editorRootEl.classList.remove('image-mode', 'audio-mode');

    if (isImage) {
        const url = await ensureBlobUrl(currentProjectId, file.id);
        imageViewerImg.src = url || '';
        let meta = file.name;
        if (file.size) meta += ' · ' + formatSize(file.size);
        if (file.originalName && file.originalName !== file.name) meta += ' · 原文件名：' + file.originalName;
        imageViewerMeta.textContent = meta;
        imageViewer.classList.add('active');
        editorRootEl.classList.add('image-mode');
        codeEditorEl.value = '';
        codeEditorEl.disabled = true;
        updateHighlight();
    } else if (isAudio) {
        const url = await ensureBlobUrl(currentProjectId, file.id);
        audioViewerName.textContent = file.name;
        let meta = '';
        if (file.size) meta += formatSize(file.size);
        if (file.originalName && file.originalName !== file.name) {
            if (meta) meta += ' · ';
            meta += '原文件名：' + file.originalName;
        }
        audioViewerMeta.textContent = meta;
        audioPlayer.src = url || '';
        audioViewer.classList.add('active');
        editorRootEl.classList.add('audio-mode');
        codeEditorEl.value = '';
        codeEditorEl.disabled = true;
        updateHighlight();
    } else {
        imageViewerImg.src = '';
        if (file.editable === false) {
            codeEditorEl.value = getFileInfoText(file);
            codeEditorEl.disabled = true;
        } else {
            codeEditorEl.value = file.content || '';
            codeEditorEl.disabled = false;
        }
        updateHighlight();
        codeEditorEl.scrollTop = 0;
        codeEditorEl.scrollLeft = 0;
        syncScroll();
    }

    document.getElementById('currentFileName').textContent = file.name;
    showSearchStatus('');
    updateUndoRedoButtons();
    renderFileTree();
}

function newFile() {
    const name = prompt('请输入文件名（如：newfile.html）', 'newfile.html');
    if (!name) return;
    const id = genId('file');
    const parent = findParent('root') || { children: getCurrentFileTree() };
    const newFileObj = { id: id, name: name, type: 'file', content: '' };
    if (parent.children) parent.children.push(newFileObj);
    else { const tree = getCurrentFileTree(); tree.push(newFileObj); setCurrentFileTree(tree); }
    renderFileTree();
    selectFile(id);
    saveProjects(true);
}

function newFolder() {
    const name = prompt('请输入文件夹名', '新文件夹');
    if (!name) return;
    const id = genId('folder');
    const newFolderObj = { id: id, name: name, type: 'folder', children: [] };
    const parent = findParent('root') || { children: getCurrentFileTree() };
    if (parent.children) parent.children.push(newFolderObj);
    else { const tree = getCurrentFileTree(); tree.push(newFolderObj); setCurrentFileTree(tree); }
    renderFileTree();
    saveProjects(true);
}

function renameItem(id) {
    const item = findFileById(id);
    if (!item) return;
    const newName = prompt('重命名：', item.name);
    if (!newName || newName === item.name) return;

    item.name = newName;
    renderFileTree();
    document.getElementById('currentFileName').textContent = item.name;
    updateHighlight();
    saveProjects(true);
}

function deleteItem(id) {
    if (!confirm('确定删除吗？')) return;

    const item = findFileById(id);

    (function removeOpfsContents(node) {
        if (!node) return;
        if (node.type === 'file' && node.inOpfs) {
            opfsDelete(currentProjectId, node.id);
            revokeBlobUrl(node.id);
        }
        if (node.children) node.children.forEach(removeOpfsContents);
    })(item);

    const parent = findParent(id);
    if (parent && parent.children) parent.children = parent.children.filter(c => c.id !== id);
    else { const tree = getCurrentFileTree(); setCurrentFileTree(tree.filter(c => c.id !== id)); }

    if (currentFileId === id) {
        stopAudioViewer();
        currentFileId = null;
        codeEditorEl.value = '';
        codeEditorEl.disabled = true;
        editorRootEl.classList.remove('image-mode', 'audio-mode');
        document.getElementById('imageViewer').classList.remove('active');
        document.getElementById('imageViewerImg').src = '';
        document.getElementById('audioViewer').classList.remove('active');
        document.getElementById('currentFileName').textContent = '未选择';
        updateHighlight();
        updateUndoRedoButtons();
    }
    if (expandedFolderId && !findFileById(expandedFolderId)) expandedFolderId = null;
    renderFileTree();
    saveProjects(true);
}

/* =========================================================
   十三、上传文件（OPFS 版）
   ========================================================= */
function getUploadTargetFolder() {
    if (expandedFolderId) {
        const folder = findFileById(expandedFolderId);
        if (folder && folder.type === 'folder') return folder;
    }
    const rootFolder = findFileById('root');
    if (rootFolder && rootFolder.type === 'folder') return rootFolder;
    return null;
}

function isTextFile(file) {
    const type = (file.type || '').toLowerCase();
    if (type.startsWith('text/')) return true;
    const textTypes = [
        'application/json', 'application/javascript', 'application/x-javascript',
        'application/xml', 'application/x-httpd-php', 'application/x-sh', 'application/sql'
    ];
    if (textTypes.includes(type)) return true;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const textExts = [
        'html','htm','xhtml','css','scss','sass','less',
        'js','mjs','cjs','jsx','ts','tsx','vue','svelte',
        'json','json5','xml','svg','yml','yaml','toml',
        'txt','md','markdown','csv','tsv','log',
        'py','java','c','cpp','cc','h','hpp','cs',
        'go','rs','rb','php','swift','kt','scala',
        'sh','bash','zsh','bat','cmd','ps1',
        'sql','ini','conf','cfg','env','gitignore',
        'dockerfile','makefile'
    ];
    return textExts.includes(ext);
}

function isImageFile(file) {
    if ((file.type || '').startsWith('image/')) return true;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return ['png','jpg','jpeg','gif','webp','bmp','ico','svg','avif'].includes(ext);
}

function isAudioFile(file) {
    if ((file.type || '').startsWith('audio/')) return true;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return [
        'mp3','ogg','oga','wav','m4a','aac','flac','opus','weba',
        'wma','amr','3gp','mid','midi','aiff','au'
    ].includes(ext);
}

function showUploadProgress(pct, label) {
    const el = document.getElementById('uploadProgress');
    const fill = document.getElementById('uploadProgressFill');
    const text = document.getElementById('uploadProgressText');
    if (!el || !fill || !text) return;
    el.classList.add('show');
    fill.style.width = pct + '%';
    text.textContent = label || ('上传中 ' + pct + '%');
}

function hideUploadProgress() {
    const el = document.getElementById('uploadProgress');
    if (!el) return;
    setTimeout(function () { el.classList.remove('show'); }, 260);
}

function uploadFile(input) {
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    input.value = '';

    if (!OPFS_SUPPORTED) {
        alert('当前浏览器不支持 OPFS（Origin Private File System），请用最新版 Chrome / Edge / Firefox / Safari。');
        return;
    }

    const projectId = currentProjectId;
    const targetFolder = getUploadTargetFolder();
    const listEl = targetFolder ? targetFolder.children : getCurrentFileTree();
    const total = files.length;
    let completed = 0;
    let lastAddedId = null;
    let lastProgressAt = 0;

    const usedByExt = new Map();
    function ensureUsedSet(ext) {
        let s = usedByExt.get(ext);
        if (!s) { s = new Set(); usedByExt.set(ext, s); }
        return s;
    }
    (function collect(nodes) {
        if (!nodes) return;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.type === 'file') {
                const dot = node.name.lastIndexOf('.');
                if (dot > 0) {
                    const head = node.name.slice(0, dot);
                    if (/^\d+$/.test(head)) {
                        const num = parseInt(head, 10);
                        const ext = node.name.slice(dot + 1).toLowerCase();
                        ensureUsedSet(ext).add(num);
                    }
                }
            }
            if (node.children) collect(node.children);
        }
    })(listEl);

    function nextNameFor(rawExt) {
        const ext = (rawExt || 'bin').toLowerCase();
        const used = ensureUsedSet(ext);
        let n = 1;
        while (used.has(n)) n++;
        used.add(n);
        return n + '.' + ext;
    }

    function processOne(file, done) {
        const id = genId('upload');
        const isText = isTextFile(file);
        const isImg = isImageFile(file);
        const isAud = isAudioFile(file);
        const ext = (file.name.split('.').pop() || 'txt').toLowerCase();

        const newFileObj = {
            id: id,
            name: nextNameFor(ext),
            originalName: file.name,
            type: 'file',
            mime: file.type || '',
            size: file.size,
            uploaded: true,
            isImage: isImg,
            isAudio: isAud,
            editable: isText,
            inOpfs: true
        };

        opfsWrite(projectId, id, file).then(function () {
            if (isText) {
                file.text().then(function (text) {
                    _fileContentCache[id] = text;
                    listEl.push(newFileObj);
                    lastAddedId = id;
                    completed++;
                    done();
                }).catch(function () {
                    listEl.push(newFileObj);
                    lastAddedId = id;
                    completed++;
                    done();
                });
            } else {
                listEl.push(newFileObj);
                lastAddedId = id;
                completed++;
                done();
            }
        }).catch(function (err) {
            console.warn('OPFS 写失败：', file.name, err);
            completed++;
            done();
        });
    }

    let nextIndex = 0;
    let inFlight = 0;

    showUploadProgress(0, '准备上传 0/' + total);

    function pump() {
        while (inFlight < UPLOAD_CONCURRENCY && nextIndex < total) {
            const file = files[nextIndex++];
            inFlight++;
            processOne(file, function () {
                inFlight--;
                const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
                if (now - lastProgressAt > 100 || completed === total) {
                    lastProgressAt = now;
                    const pct = Math.round(completed / total * 100);
                    showUploadProgress(pct, '上传中 ' + completed + '/' + total);
                }
                pump();
            });
        }

        if (nextIndex >= total && inFlight === 0) {
            showUploadProgress(100, '已完成 ' + total + '/' + total);
            hideUploadProgress();
            renderFileTree();
            if (lastAddedId && total <= 50) selectFile(lastAddedId);
            scheduleSave();
        }
    }

    pump();
}

/* =========================================================
   十四、运行预览 + 错误捕获
   ========================================================= */
function isExternalUrl(url) {
    if (!url) return true;
    return /^(https?:)?\/\//i.test(url) ||
           url.startsWith('data:') ||
           url.startsWith('blob:') ||
           url.startsWith('#') ||
           url.startsWith('mailto:') ||
           url.startsWith('tel:') ||
           url.startsWith('javascript:');
}

function buildFileMap() {
    const map = new Map();
    (function walk(nodes, prefix) {
        for (const node of nodes) {
            const path = prefix ? prefix + '/' + node.name : node.name;
            if (node.type === 'file') {
                if (!map.has(path)) map.set(path, node);
                if (!map.has(node.name)) map.set(node.name, node);
            }
            if (node.children) walk(node.children, path);
        }
    })(findFileById('root') ? findFileById('root').children : [], '');
    return map;
}

async function resolveLocalRefAsync(url, fileMap) {
    if (!url || isExternalUrl(url)) return null;
    const clean = url.split('?')[0].split('#')[0].replace(/^\.\//, '').replace(/^\//, '');
    if (!clean) return null;
    let file = fileMap.get(clean);
    if (!file) {
        const name = clean.split('/').pop();
        file = fileMap.get(name);
    }
    if (!file) {
        addWarnLog('error', '缺失文件：' + clean);
        return null;
    }
    if (file.inOpfs) {
        if (file.editable !== false) {
            if (file.content != null) return file.content;
            const text = await loadFileContent(currentProjectId, file.id);
            file.content = text || '';
            return file.content;
        } else {
            const u = await ensureBlobUrl(currentProjectId, file.id);
            return u;
        }
    }
    return file.content;
}

async function resolveCssUrlsAsync(cssContent, fileMap) {
    if (!cssContent) return cssContent;
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
    const matches = [];
    let m;
    while ((m = re.exec(cssContent)) !== null) {
        matches.push({ match: m[0], url: m[2], index: m.index });
    }
    if (matches.length === 0) return cssContent;

    const replacements = await Promise.all(matches.map(async function (mm) {
        const resolved = await resolveLocalRefAsync(mm.url, fileMap);
        return resolved !== null ? 'url("' + resolved + '")' : null;
    }));

    let result = '';
    let lastIndex = 0;
    for (let i = 0; i < matches.length; i++) {
        const mm = matches[i];
        result += cssContent.slice(lastIndex, mm.index);
        result += replacements[i] != null ? replacements[i] : mm.match;
        lastIndex = mm.index + mm.match.length;
    }
    result += cssContent.slice(lastIndex);
    return result;
}

async function buildPreviewHtmlAsync(htmlContent) {
    if (!htmlContent) return '<!DOCTYPE html><html><body></body></html>';
    const fileMap = buildFileMap();
    let html = htmlContent;

    const srcRe = /(<(?:img|source|video|audio|embed|iframe|input)\b[^>]*?)\ssrc\s*=\s*(['"])([^'"]*)\2/gi;
    const srcMatches = [];
    let sm;
    while ((sm = srcRe.exec(html)) !== null) {
        srcMatches.push({ match: sm[0], before: sm[1], quote: sm[2], url: sm[3], index: sm.index });
    }

    const srcReplacements = await Promise.all(srcMatches.map(async function (mm) {
        const r = await resolveLocalRefAsync(mm.url, fileMap);
        return r !== null ? mm.before + ' src=' + mm.quote + r + mm.quote : null;
    }));

    let htmlOut = '';
    let lastIdx = 0;
    for (let i = 0; i < srcMatches.length; i++) {
        const mm = srcMatches[i];
        htmlOut += html.slice(lastIdx, mm.index);
        htmlOut += srcReplacements[i] != null ? srcReplacements[i] : mm.match;
        lastIdx = mm.index + mm.match.length;
    }
    htmlOut += html.slice(lastIdx);
    html = htmlOut;

    const linkRe = /<link\b[^>]*>/gi;
    const linkMatches = [];
    let lm;
    while ((lm = linkRe.exec(html)) !== null) {
        linkMatches.push({ match: lm[0], index: lm.index });
    }
    const linkReplacements = await Promise.all(linkMatches.map(async function (mm) {
        const tag = mm.match;
        if (!/rel\s*=\s*(['"])?stylesheet\1?/i.test(tag)) return null;
        const hrefM = tag.match(/href\s*=\s*(['"])([^'"]*)\1/i);
        if (!hrefM) return null;
        const r = await resolveLocalRefAsync(hrefM[2], fileMap);
        if (r === null) return null;
        const css = await resolveCssUrlsAsync(r, fileMap);
        return '<style>' + css + '</style>';
    }));

    htmlOut = '';
    lastIdx = 0;
    for (let i = 0; i < linkMatches.length; i++) {
        const mm = linkMatches[i];
        htmlOut += html.slice(lastIdx, mm.index);
        htmlOut += linkReplacements[i] != null ? linkReplacements[i] : mm.match;
        lastIdx = mm.index + mm.match.length;
    }
    htmlOut += html.slice(lastIdx);
    html = htmlOut;

    const scriptRe = /<script\b([^>]*?)\ssrc\s*=\s*(['"])([^'"]*)\2([^>]*?)>\s*<\/script>/gi;
    const scriptMatches = [];
    let scm;
    while ((scm = scriptRe.exec(html)) !== null) {
        scriptMatches.push({
            match: scm[0], before: scm[1], quote: scm[2], url: scm[3], after: scm[4], index: scm.index
        });
    }
    const scriptReplacements = await Promise.all(scriptMatches.map(async function (mm) {
        const r = await resolveLocalRefAsync(mm.url, fileMap);
        return r !== null ? '<script' + mm.before + mm.after + '>' + r + '<\/script>' : null;
    }));

    htmlOut = '';
    lastIdx = 0;
    for (let i = 0; i < scriptMatches.length; i++) {
        const mm = scriptMatches[i];
        htmlOut += html.slice(lastIdx, mm.index);
        htmlOut += scriptReplacements[i] != null ? scriptReplacements[i] : mm.match;
        lastIdx = mm.index + mm.match.length;
    }
    htmlOut += html.slice(lastIdx);
    html = htmlOut;

    const styleRe = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
    const styleMatches = [];
    let stm;
    while ((stm = styleRe.exec(html)) !== null) {
        styleMatches.push({ match: stm[0], attrs: stm[1], content: stm[2], index: stm.index });
    }
    const styleReplacements = await Promise.all(styleMatches.map(async function (mm) {
        const css = await resolveCssUrlsAsync(mm.content, fileMap);
        return '<style' + mm.attrs + '>' + css + '</style>';
    }));

    htmlOut = '';
    lastIdx = 0;
    for (let i = 0; i < styleMatches.length; i++) {
        const mm = styleMatches[i];
        htmlOut += html.slice(lastIdx, mm.index);
        htmlOut += styleReplacements[i] != null ? styleReplacements[i] : mm.match;
        lastIdx = mm.index + mm.match.length;
    }
    htmlOut += html.slice(lastIdx);
    html = htmlOut;

    return html;
}

function injectErrorScript(html) {
    const script =
'<script>(function(){' +
'function send(t,d){try{parent.postMessage({__editorLog:true,type:t,data:d},"*");}catch(e){}}' +
'window.addEventListener("error",function(e){' +
  'if(e&&e.target&&e.target.tagName){' +
    'var tg=e.target.tagName.toUpperCase();' +
    'if(tg==="IMG"||tg==="SCRIPT"||tg==="LINK"||tg==="SOURCE"||tg==="VIDEO"||tg==="AUDIO"||tg==="IFRAME"||tg==="EMBED"){' +
      'var u=e.target.src||e.target.href||"";' +
      'send("error","资源加载失败：<"+tg.toLowerCase()+(u?" src=\\""+u+"\\"":"")+">");' +
      'return;' +
    '}' +
  '}' +
  'send("error",(e&&e.message?e.message:"未知错误")+(e&&e.lineno?"  (行 "+e.lineno+")":""));' +
'},true);' +
'window.addEventListener("unhandledrejection",function(e){' +
  'var m=(e&&e.reason&&e.reason.message)?e.reason.message:String(e&&e.reason);' +
  'send("error","未处理的 Promise 拒绝："+m);' +
'});' +
'var _err=console.error;console.error=function(){send("error",Array.prototype.map.call(arguments,String).join(" "));_err.apply(console,arguments);};' +
'var _warn=console.warn;console.warn=function(){send("warn",Array.prototype.map.call(arguments,String).join(" "));_warn.apply(console,arguments);};' +
'})();<\/script>';

    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + script);
    if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, m => script + m);
    return script + html;
}

async function runCode() {
    if (!currentFileId) { alert('请先选择或创建一个 HTML 文件'); return; }
    const file = findFileById(currentFileId);
    if (!file) return;

    if (file.editable !== false) file.content = codeEditorEl.value;

    clearWarnLog();
    document.getElementById('btnRun').style.display = 'none';
    document.getElementById('btnStop').style.display = 'inline-block';
    document.getElementById('previewArea').classList.add('active');
    document.getElementById('warnBtn').classList.add('show');

    const iframe = document.getElementById('previewFrameFull');
    let html;

    if (file.isImage || file.isAudio) {
        const url = await ensureBlobUrl(currentProjectId, file.id);
        if (file.isImage) {
            html = '<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#2d2d2d;min-height:100vh;"><img src="' + url + '" style="max-width:100%;max-height:100vh;"></body></html>';
        } else {
            html = '<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#2d2d2d;min-height:100vh;"><audio src="' + url + '" controls autoplay style="width:80%;max-width:440px;"></audio></body></html>';
        }
    } else if (!file.name.endsWith('.html') && !file.name.endsWith('.htm')) {
        html = '<!DOCTYPE html><html><body style="margin:0;"><pre style="padding:20px;background:#f5f5f5;white-space:pre-wrap;word-break:break-all;font-family:monospace;">' + escapeHtml(file.content || '') + '</pre></body></html>';
    } else {
        html = await buildPreviewHtmlAsync(file.content || '');
    }

    iframe.srcdoc = injectErrorScript(html);
}

function stopPreview() {
    document.getElementById('previewArea').classList.remove('active');
    document.getElementById('btnRun').style.display = 'inline-block';
    document.getElementById('btnStop').style.display = 'none';
    document.getElementById('previewFrameFull').srcdoc = '';
    document.getElementById('warnBtn').classList.remove('show');
    hideWarnPanel();
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('previewArea').classList.contains('active')) {
        stopPreview();
    }
});

/* =========================================================
   十五、新建项目
   ========================================================= */
function showNewProjectModal() {
    document.getElementById('projectModal').style.display = 'flex';
    document.getElementById('projectName').value = '';
    document.getElementById('projectName').focus();
}

function hideNewProjectModal() {
    document.getElementById('projectModal').style.display = 'none';
}

function confirmNewProject() {
    const name = document.getElementById('projectName').value.trim();
    if (!name) { alert('请输入项目名称'); return; }
    const id = genId('proj');
    const newProject = {
        id: id,
        name: name,
        fileTree: [
            { id: 'root', name: name + ' 根目录', type: 'folder', children: [
                { id: genId('file'), name: 'index.html', type: 'file', content:
`<!DOCTYPE html>
<html>
<head>
  <title>${name}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 20px; text-align: center; }
    h1 { color: #0e639c; }
  </style>
</head>
<body>
  <h1>欢迎来到 ${name}</h1>
  <p>开始你的创作吧！</p>
</body>
</html>` }
            ]}
        ]
    };
    projects.push(newProject);
    hideNewProjectModal();
    renderProjectList();
    saveProjects(true);
    enterProject(id);
}

document.getElementById('projectName').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') confirmNewProject();
});

window.addEventListener('beforeunload', function () {
    syncCurrentFileContent();
    const json = stringifyProjects();
    try { localStorage.setItem(BACKUP_KEY, json); } catch (e) {}
    try { idbSet(IDB_KEY, json); } catch (e) {}
});

document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveProjects(true);
});

/* =========================================================
   十六、打包成 ZIP
   ========================================================= */
const _CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = _CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function textToBytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    const utf8 = unescape(encodeURIComponent(str));
    const arr = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) arr[i] = utf8.charCodeAt(i);
    return arr;
}

function buildZip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;

    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    for (const f of files) {
        const nameBytes = textToBytes(f.name);
        const crc = crc32(f.bytes);
        const size = f.bytes.length;

        const lfh = new Uint8Array(30 + nameBytes.length);
        const dv = new DataView(lfh.buffer);
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(6, 0x0800, true);
        dv.setUint16(8, 0, true);
        dv.setUint16(10, dosTime, true);
        dv.setUint16(12, dosDate, true);
        dv.setUint32(14, crc, true);
        dv.setUint32(18, size, true);
        dv.setUint32(22, size, true);
        dv.setUint16(26, nameBytes.length, true);
        dv.setUint16(28, 0, true);
        lfh.set(nameBytes, 30);

        chunks.push(lfh);
        chunks.push(f.bytes);

        const cdh = new Uint8Array(46 + nameBytes.length);
        const cdv = new DataView(cdh.buffer);
        cdv.setUint32(0, 0x02014b50, true);
        cdv.setUint16(4, 20, true);
        cdv.setUint16(6, 20, true);
        cdv.setUint16(8, 0x0800, true);
        cdv.setUint16(10, 0, true);
        cdv.setUint16(12, dosTime, true);
        cdv.setUint16(14, dosDate, true);
        cdv.setUint32(16, crc, true);
        cdv.setUint32(20, size, true);
        cdv.setUint32(24, size, true);
        cdv.setUint16(28, nameBytes.length, true);
        cdv.setUint16(30, 0, true);
        cdv.setUint16(32, 0, true);
        cdv.setUint16(34, 0, true);
        cdv.setUint16(36, 0, true);
        cdv.setUint32(38, 0, true);
        cdv.setUint32(42, offset, true);
        cdh.set(nameBytes, 46);
        central.push(cdh);

        offset += lfh.length + size;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const c of central) {
        chunks.push(c);
        cdSize += c.length;
    }

    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(4, 0, true);
    edv.setUint16(6, 0, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, cdStart, true);
    edv.setUint16(20, 0, true);
    chunks.push(eocd);

    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
        out.set(c, p);
        p += c.length;
    }
    return out;
}

function sanitizeFileName(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, '_').trim() || 'project';
}

async function packProject() {
    if (!currentProjectId) { alert('请先进入一个项目'); return; }
    const proj = projects.find(p => p.id === currentProjectId);
    if (!proj) return;

    syncCurrentFileContent();
    showToast('正在打包...');

    const entries = [];
    (function walk(nodes, prefix) {
        for (const node of nodes) {
            if (node.type === 'folder') {
                const nextPrefix = prefix ? prefix + '/' + node.name : node.name;
                walk(node.children, nextPrefix);
            } else {
                const path = prefix ? prefix + '/' + node.name : node.name;
                entries.push({ node: node, path: path });
            }
        }
    })(proj.fileTree, '');

    if (entries.length === 0) { alert('项目里还没有文件，无法打包'); return; }

    const rootName = sanitizeFileName(proj.name);
    const files = [];

    const CONC = 8;
    let idx = 0;
    const tasks = [];

    async function readOne(entry) {
        let bytes;
        if (entry.node.inOpfs) {
            try {
                const f = await opfsRead(currentProjectId, entry.node.id);
                const ab = await f.arrayBuffer();
                bytes = new Uint8Array(ab);
            } catch (e) {
                console.warn('读取 OPFS 失败：', entry.path, e);
                bytes = textToBytes('');
            }
        } else {
            bytes = textToBytes(entry.node.content || '');
        }
        files.push({ name: rootName + '/' + entry.path, bytes: bytes });
    }

    async function worker() {
        while (idx < entries.length) {
            const cur = entries[idx++];
            await readOne(cur);
        }
    }
    for (let i = 0; i < CONC; i++) tasks.push(worker());
    await Promise.all(tasks);

    try {
        const zipBytes = buildZip(files);
        const blob = new Blob([zipBytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = rootName + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        showToast('已打包 ' + files.length + ' 个文件');
    } catch (e) {
        console.error('打包失败：', e);
        alert('打包失败：' + e.message);
    }
}

/* =========================================================
   十七、ZIP 菜单 / 导入 ZIP
   ========================================================= */
function toggleZipMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('zipMenu');
    if (!menu) return;
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
}

function closeZipMenu() {
    const menu = document.getElementById('zipMenu');
    if (menu) menu.style.display = 'none';
}

function onZipMenuPack(e) {
    if (e) e.stopPropagation();
    closeZipMenu();
    packProject();
}

function onZipMenuUpload(e) {
    if (e) e.stopPropagation();
    closeZipMenu();
    document.getElementById('zipInput').click();
}

document.addEventListener('click', function (e) {
    const wrapper = document.getElementById('zipWrapper');
    if (!wrapper) return;
    if (!wrapper.contains(e.target)) closeZipMenu();
});

function guessMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
        'html': 'text/html', 'htm': 'text/html', 'xhtml': 'application/xhtml+xml',
        'css': 'text/css', 'scss': 'text/x-scss', 'sass': 'text/x-sass', 'less': 'text/x-less',
        'js': 'application/javascript', 'mjs': 'application/javascript', 'cjs': 'application/javascript',
        'json': 'application/json', 'json5': 'application/json',
        'xml': 'application/xml', 'svg': 'image/svg+xml',
        'txt': 'text/plain', 'md': 'text/markdown', 'markdown': 'text/markdown',
        'csv': 'text/csv', 'tsv': 'text/tab-separated-values',
        'yml': 'text/yaml', 'yaml': 'text/yaml',
        'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
        'ico': 'image/x-icon', 'avif': 'image/avif',
        'mp3': 'audio/mpeg', 'ogg': 'audio/ogg', 'oga': 'audio/ogg',
        'wav': 'audio/wav', 'm4a': 'audio/mp4', 'aac': 'audio/aac',
        'flac': 'audio/flac', 'opus': 'audio/opus', 'weba': 'audio/webm',
        'wma': 'audio/x-ms-wma', 'amr': 'audio/amr', 'mid': 'audio/midi',
        'midi': 'audio/midi', 'aiff': 'audio/aiff', 'au': 'audio/basic'
    };
    return map[ext] || '';
}

function isTextByExt(ext) {
    return [
        'html','htm','xhtml','css','scss','sass','less',
        'js','mjs','cjs','jsx','ts','tsx','vue','svelte',
        'json','json5','xml','svg','yml','yaml','toml',
        'txt','md','markdown','csv','tsv','log',
        'py','java','c','cpp','cc','h','hpp','cs',
        'go','rs','rb','php','swift','kt','scala',
        'sh','bash','zsh','bat','cmd','ps1',
        'sql','ini','conf','cfg','env','gitignore',
        'dockerfile','makefile'
    ].includes(ext);
}

async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('当前浏览器不支持 DecompressionStream，无法解压');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
}

async function parseZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);

    let eocdOffset = -1;
    const minPos = Math.max(0, bytes.length - 22 - 65536);
    for (let i = bytes.length - 22; i >= minPos; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) throw new Error('不是有效的 ZIP 文件');

    const totalEntries = dv.getUint16(eocdOffset + 10, true);
    const cdOffset = dv.getUint32(eocdOffset + 16, true);

    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (p + 46 > bytes.length) break;
        if (dv.getUint32(p, true) !== 0x02014b50) break;

        const flags = dv.getUint16(p + 8, true);
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const localOffset = dv.getUint32(p + 42, true);

        const nameBytes = bytes.slice(p + 46, p + 46 + nameLen);
        let name = '';
        try {
            name = new TextDecoder('utf-8', { fatal: (flags & 0x0800) !== 0 }).decode(nameBytes);
        } catch (e) {
            name = new TextDecoder('utf-8').decode(nameBytes);
        }

        entries.push({
            name: name.replace(/\\/g, '/'),
            method: method,
            compSize: compSize,
            localOffset: localOffset
        });
        p += 46 + nameLen + extraLen + commentLen;
    }

    const files = [];
    for (const entry of entries) {
        if (entry.name.endsWith('/')) continue;
        if (entry.name.startsWith('__MACOSX/')) continue;
        const baseName = entry.name.split('/').pop();
        if (baseName === '.DS_Store' || baseName === 'Thumbs.db') continue;

        const lhOff = entry.localOffset;
        if (lhOff + 30 > bytes.length) continue;
        if (dv.getUint32(lhOff, true) !== 0x04034b50) continue;

        const lhNameLen = dv.getUint16(lhOff + 26, true);
        const lhExtraLen = dv.getUint16(lhOff + 28, true);
        const dataStart = lhOff + 30 + lhNameLen + lhExtraLen;
        const compData = bytes.slice(dataStart, dataStart + entry.compSize);

        let data;
        if (entry.method === 0) data = compData;
        else if (entry.method === 8) {
            try { data = await inflateRaw(compData); }
            catch (err) { console.warn('解压失败：', entry.name, err); continue; }
        } else continue;

        files.push({ name: entry.name, data: data });
    }
    return files;
}

function findCommonTopDir(files) {
    if (files.length === 0) return '';
    const firstPart = files[0].name.split('/')[0];
    if (!firstPart || files[0].name.indexOf('/') === -1) return '';
    for (const f of files) {
        const parts = f.name.split('/');
        if (parts.length < 2) return '';
        if (parts[0] !== firstPart) return '';
    }
    return firstPart + '/';
}

async function applyZipEntriesAsync(files) {
    const rootFolder = findFileById('root');
    if (!rootFolder) return 0;

    const prefix = findCommonTopDir(files);
    if (prefix) for (const f of files) f.name = f.name.slice(prefix.length);

    let count = 0;
    const projectId = currentProjectId;

    const CONC = 8;
    let idx = 0;

    async function writeOne(entry) {
        const parts = entry.name.split('/').filter(p => p && p !== '.');
        if (parts.length === 0) return;

        const fileName = parts[parts.length - 1];
        const folderPath = parts.slice(0, -1);

        let current = rootFolder;
        for (const folderName of folderPath) {
            let sub = current.children.find(c => c.type === 'folder' && c.name === folderName);
            if (!sub) {
                sub = { id: genId('folder'), name: folderName, type: 'folder', children: [] };
                current.children.push(sub);
            }
            current = sub;
        }

        const mime = guessMime(fileName);
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        const isText = mime.startsWith('text/') ||
                       mime === 'application/javascript' ||
                       mime === 'application/json' ||
                       mime === 'application/xml' ||
                       isTextByExt(ext);
        const isImage = mime.startsWith('image/');
        const isAudio = mime.startsWith('audio/');

        const id = genId('upload');
        const blob = new Blob([entry.data], { type: mime || 'application/octet-stream' });

        try {
            await opfsWrite(projectId, id, blob);
        } catch (e) {
            console.warn('OPFS 写失败：', fileName, e);
        }

        const newFileObj = {
            id: id,
            name: fileName,
            originalName: fileName,
            type: 'file',
            mime: mime || '',
            size: entry.data.length,
            uploaded: true,
            isImage: isImage,
            isAudio: isAudio,
            editable: isText,
            inOpfs: true
        };

        if (isText) {
            try { _fileContentCache[id] = new TextDecoder('utf-8').decode(entry.data); }
            catch (e) {}
        }

        const existing = current.children.findIndex(c => c.type === 'file' && c.name === fileName);
        if (existing !== -1) {
            const old = current.children[existing];
            if (old.inOpfs) {
                opfsDelete(projectId, old.id);
                revokeBlobUrl(old.id);
                delete _fileContentCache[old.id];
            }
            current.children[existing] = newFileObj;
        } else {
            current.children.push(newFileObj);
        }

        count++;
    }

    async function worker() {
        while (idx < files.length) {
            const cur = files[idx++];
            await writeOne(cur);
        }
    }

    const tasks = [];
    for (let i = 0; i < CONC; i++) tasks.push(worker());
    await Promise.all(tasks);

    return count;
}

async function importZip(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = '';

    if (!currentProjectId) { alert('请先进入一个项目'); return; }
    if (!OPFS_SUPPORTED) { alert('当前浏览器不支持 OPFS'); return; }

    showToast('正在解压 ZIP ...');

    try {
        const arrayBuffer = await file.arrayBuffer();
        const entries = await parseZip(arrayBuffer);
        if (entries.length === 0) { alert('ZIP 文件为空'); return; }

        const count = await applyZipEntriesAsync(entries);

        expandedFolderId = 'root';
        renderFileTree();
        scheduleSave();
        showToast('已导入 ' + count + ' 个文件');
    } catch (e) {
        console.error('解压失败：', e);
        alert('解压失败：' + e.message);
    }
}

/* =========================================================
   十八、粘贴分块处理 + 进度条
   ========================================================= */
function showPasteProgress(pct) {
    const el = document.getElementById('pasteProgress');
    const fill = document.getElementById('pasteProgressFill');
    const text = document.getElementById('pasteProgressText');
    if (!el || !fill || !text) return;
    el.classList.add('show');
    fill.style.width = pct + '%';
    text.textContent = '粘贴中 ' + pct + '%';
}

function hidePasteProgress() {
    const el = document.getElementById('pasteProgress');
    if (!el) return;
    setTimeout(function () { el.classList.remove('show'); }, 220);
}

codeEditorEl.addEventListener('paste', function (e) {
    const clip = e.clipboardData || window.clipboardData;
    if (!clip) return;
    const pasted = clip.getData('text');
    if (!pasted) return;
    if (pasted.length < PASTE_MIN_TRIGGER) return;

    e.preventDefault();

    if (currentFileId) {
        const file = findFileById(currentFileId);
        if (file && file.editable !== false) {
            ensureHistory(file);
            const stack = file._undoStack;
            const cur = codeEditorEl.value;
            if (stack[stack.length - 1] !== cur) {
                stack.push(cur);
                if (stack.length > 200) stack.shift();
                file._redoStack = [];
            }
        }
    }

    const startPos = this.selectionStart;
    const endPos = this.selectionEnd;
    const before = this.value.slice(0, startPos);
    const after = this.value.slice(endPos);
    this.value = before + after;

    const total = pasted.length;
    let offset = 0;
    let inserted = '';

    showPasteProgress(0);

    function step() {
        if (offset >= total) {
            const finalPos = startPos + total;
            codeEditorEl.value = before + inserted + after;
            codeEditorEl.selectionStart = codeEditorEl.selectionEnd = finalPos;
            if (currentFileId) {
                const file = findFileById(currentFileId);
                if (file && file.editable !== false) {
                    file.content = codeEditorEl.value;
                    if (file.inOpfs) {
                        const blob = new Blob([codeEditorEl.value], { type: 'text/plain;charset=utf-8' });
                        opfsWrite(currentProjectId, file.id, blob).catch(function (e) {
                            console.warn('OPFS 回写失败：', e);
                        });
                        _fileContentCache[file.id] = codeEditorEl.value;
                    }
                }
            }
            requestHighlightSlow();
            scheduleSnapshot();
            updateUndoRedoButtons();
            scheduleSave();
            showPasteProgress(100);
            hidePasteProgress();
            return;
        }
        const chunk = pasted.slice(offset, offset + PASTE_CHUNK_SIZE);
        inserted += chunk;
        offset += chunk.length;
        codeEditorEl.value = before + inserted + after;
        codeEditorEl.selectionStart = codeEditorEl.selectionEnd = startPos + offset;
        const pct = Math.min(100, Math.round(offset / total * 100));
        showPasteProgress(pct);
        requestAnimationFrame(step);
    }
    step();
});

/* =========================================================
   启动
   ========================================================= */
init();