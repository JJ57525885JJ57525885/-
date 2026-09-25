/* =========================================================
   一、通用工具
   （escapeHtml 由 highlight.js 提供）
   ========================================================= */
const STORAGE_KEY = 'mini_code_editor_projects_v4';
let storageWarned = false;

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

/* =========================================================
   二、运行日志系统
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
            '<span class="warn-time">' + log.time + '</span>' +
            '</div>';
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
   ★ 三、警告按钮拖动
   
   拖动开始时通过 body.dragging-warn 让 iframe 的 pointer-events
   变为 none，指针物理上无法进入 iframe 文档，配合 pointer
   capture + capture 阶段监听，彻底解决跨 iframe 丢事件。
   同时锁定 html/body 滚动，防止竖屏拖动时坐标系错位。
   ========================================================= */
(function initWarnButton() {
    const btn = document.getElementById('warnBtn');
    if (!btn) return;

    let isDragging = false;
    let dragMoved = false;
    let startX = 0, startY = 0;
    let dragOffsetX = 0, dragOffsetY = 0;
    let savedPos = null;
    let activePointerId = null;
    let savedHtmlOverflow = '';
    let savedBodyOverflow = '';
    let savedHtmlTouch = '';
    let savedBodyTouch = '';

    function getViewportSize() {
        const de = document.documentElement;
        const w = (de && de.clientWidth) || window.innerWidth || 0;
        const h = (de && de.clientHeight) || window.innerHeight || 0;
        return { w: w, h: h };
    }

    function applyPos(x, y) {
        const vp = getViewportSize();
        const bw = btn.offsetWidth;
        const bh = btn.offsetHeight;
        const maxX = Math.max(0, vp.w - bw);
        const maxY = Math.max(0, vp.h - bh);
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
        if (e.touches && e.touches.length > 0) {
            cx = e.touches[0].clientX;
            cy = e.touches[0].clientY;
        } else {
            cx = e.clientX;
            cy = e.clientY;
        }
        if (cx === undefined || cy === undefined) return;

        if (!dragMoved) {
            if (Math.abs(cx - startX) < 4 && Math.abs(cy - startY) < 4) return;
            dragMoved = true;
        }
        if (e.cancelable) e.preventDefault();
        applyPos(cx - dragOffsetX, cy - dragOffsetY);
    }

    function lockScroll() {
        const html = document.documentElement;
        const body = document.body;
        savedHtmlOverflow = html.style.overflow;
        savedBodyOverflow = body.style.overflow;
        savedHtmlTouch = html.style.touchAction;
        savedBodyTouch = body.style.touchAction;
        html.style.overflow = 'hidden';
        body.style.overflow = 'hidden';
        html.style.touchAction = 'none';
        body.style.touchAction = 'none';
    }

    function unlockScroll() {
        const html = document.documentElement;
        const body = document.body;
        html.style.overflow = savedHtmlOverflow;
        body.style.overflow = savedBodyOverflow;
        html.style.touchAction = savedHtmlTouch;
        body.style.touchAction = savedBodyTouch;
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

        try {
            if (activePointerId !== null) btn.releasePointerCapture(activePointerId);
        } catch (err) {}
        activePointerId = null;

        document.body.classList.remove('dragging-warn');
        btn.style.zIndex = '';
        unlockScroll();

        setTimeout(function () { dragMoved = false; }, 100);
    }

    function startDrag(clientX, clientY, pointerId) {
        const rect = btn.getBoundingClientRect();
        dragOffsetX = clientX - rect.left;
        dragOffsetY = clientY - rect.top;
        startX = clientX;
        startY = clientY;
        isDragging = true;
        dragMoved = false;
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
        e.preventDefault();
        e.stopPropagation();
        startDrag(e.clientX, e.clientY, e.pointerId);
    });

    btn.addEventListener('click', function (e) {
        if (dragMoved) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        toggleWarnPanel();
    });

    window.addEventListener('resize', function () {
        if (!savedPos) return;
        applyPos(savedPos.x, savedPos.y);
    });
})();

/* =========================================================
   四、数据与持久化
   ========================================================= */
const DEFAULT_PROJECTS = [
    {
        id: 'default-project',
        name: '默认项目',
        fileTree: [
            { id: 'root', name: '项目根目录', type: 'folder', children: [
                { id: 'index.html', name: 'index.html', type: 'file', content:
'<!DOCTYPE html>\n<html>\n<head>\n  <title>我的页面</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hello, World!</h1>\n  <p>上传图片后会自动命名为 1.png、2.png ...</p>\n  <img src="1.png" alt="我的图片">\n  <script src="app.js"><\/script>\n</body>\n</html>' },
                { id: 'style.css', name: 'style.css', type: 'file', content:
'body {\n  margin: 0;\n  padding: 20px;\n  font-family: system-ui, sans-serif;\n  background: #f5f5f5;\n  color: #333;\n  text-align: center;\n}\n\nh1 {\n  color: #0e639c;\n}\n\nimg {\n  max-width: 300px;\n  border-radius: 8px;\n}' },
                { id: 'app.js', name: 'app.js', type: 'file', content:
'// 简单的示例脚本\nconst title = document.querySelector("h1");\nif (title) {\n  title.addEventListener("click", () => {\n    alert("你好！");\n  });\n}' }
            ]}
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

function saveProjects(silent) {
    syncCurrentFileContent();
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
        return true;
    } catch (e) {
        console.warn('自动保存失败：', e);
        if (!silent && !storageWarned) {
            storageWarned = true;
            alert('自动保存失败：本地存储空间可能已满（上传的文件过大）。建议删除部分大文件。');
        }
        return false;
    }
}

function loadProjects() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {
        console.warn('读取本地数据失败：', e);
    }
    return null;
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
   五、编辑器渲染（高亮 + 行号）
   ========================================================= */
const codeEditorEl = document.getElementById('codeEditor');
const highlightLayerEl = document.getElementById('highlightLayer');
const gutterEl = document.getElementById('gutter');
const editorRootEl = document.getElementById('editor');

function isImageMode() {
    return editorRootEl.classList.contains('image-mode');
}

function updateHighlight() {
    if (isImageMode()) {
        highlightLayerEl.textContent = '';
        gutterEl.textContent = '';
        return;
    }

    const code = codeEditorEl.value;
    const file = currentFileId ? findFileById(currentFileId) : null;
    const lang = file ? getLangFromName(file.name) : 'plain';

    if (code.length > 200000) {
        highlightLayerEl.textContent = code;
    } else {
        highlightLayerEl.innerHTML = highlight(code, lang);
    }

    const lineCount = code.split('\n').length;
    let g = '';
    for (let k = 1; k <= lineCount; k++) g += k + '\n';
    gutterEl.textContent = g;

    syncScroll();
}

function requestHighlight() {
    if (highlightPending) return;
    highlightPending = true;
    requestAnimationFrame(function () {
        highlightPending = false;
        updateHighlight();
    });
}

function syncScroll() {
    highlightLayerEl.scrollTop = codeEditorEl.scrollTop;
    highlightLayerEl.scrollLeft = codeEditorEl.scrollLeft;
    gutterEl.scrollTop = codeEditorEl.scrollTop;
}

codeEditorEl.addEventListener('scroll', syncScroll);

/* =========================================================
   六、撤销 / 重做
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
        stack.push(current);
        file._redoStack = [];
    }

    if (stack.length <= 1) {
        showToast('没有可撤销的操作');
        updateUndoRedoButtons();
        return;
    }

    const cur = stack.pop();
    file._redoStack.push(cur);
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
        showToast('没有可重做的操作');
        updateUndoRedoButtons();
        return;
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
            canUndo = stack.length > 1 ||
                      (stack.length > 0 && stack[stack.length - 1] !== cur);
            canRedo = redoStack.length > 0;
        }
    }
    btnUndo.disabled = !canUndo;
    btnRedo.disabled = !canRedo;
}

codeEditorEl.addEventListener('input', function () {
    if (currentFileId) {
        const file = findFileById(currentFileId);
        if (file && file.editable !== false) {
            file.content = this.value;
        }
    }
    requestHighlight();
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
        const start = this.selectionStart;
        const end = this.selectionEnd;
        const val = this.value;
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
        const start = this.selectionStart;
        const val = this.value;
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
   七、搜索
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
    const lineHeight = parseFloat(cs.lineHeight) || 22.4;
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
    if (isImageMode() || codeEditorEl.disabled) {
        showSearchStatus('当前文件不支持搜索', true);
        return;
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
            showSearchStatus('没有更多匹配了', true);
            return;
        }
    }
    if (idx === -1) { showSearchStatus('没有找到「' + term + '」', true); return; }

    codeEditorEl.focus();
    codeEditorEl.setSelectionRange(idx, idx + term.length);
    scrollEditorToSelection();
    showSearchStatus('已找到', false);
}

/* =========================================================
   八、文件树与项目
   ========================================================= */
function init() {
    const saved = loadProjects();
    if (saved) projects = saved;
    else { projects = JSON.parse(JSON.stringify(DEFAULT_PROJECTS)); saveProjects(true); }

    renderProjectList();
    renderWarnList();
    isTreeCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('toolbar').style.display = 'none';
}

/* ★ 项目列表：卡片带重命名 / 删除按钮 */
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

/* ★ 重命名项目 */
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

/* ★ 删除项目 */
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
    }

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
    document.getElementById('btnPack').style.display = 'inline-block';

    document.getElementById('searchInput').value = '';
    showSearchStatus('');

    isTreeCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
    expandedFolderId = 'root';

    renderFileTree();

    const firstFile = findFileById('index.html') || findFirstFile(getCurrentFileTree());
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
    document.getElementById('projectListView').style.display = 'flex';
    document.getElementById('editorArea').style.display = 'none';
    document.getElementById('fab').classList.remove('hidden');
    document.getElementById('toolbar').style.display = 'none';
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

function renderFileTree() {
    const treeEl = document.getElementById('fileTree');
    treeEl.innerHTML = '';
    const nodes = getCurrentFileTree();

    function renderNodes(nodes, container) {
        for (const node of nodes) {
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
                if (node.uploaded) icon = node.isImage ? '🖼️' : '📎';
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
        }
    }
    renderNodes(nodes, treeEl);
}

function toggleFolder(id) {
    expandedFolderId = (expandedFolderId === id) ? null : id;
    renderFileTree();
}

function getFileInfoText(file) {
    const isImage = file.isImage || (file.mime && file.mime.startsWith('image/'));
    let text = '';
    if (file.originalName && file.originalName !== file.name) {
        text += '📎 原始文件名：' + file.originalName + '\n';
    }
    text += '📎 当前名称：' + file.name + '\n';
    text += '类型：' + (file.mime || '未知') + '\n';
    text += '大小：' + (file.size ? formatSize(file.size) : '未知') + '\n\n';
    if (isImage) {
        text += '✅ 这个图片已经保存在项目中\n';
        text += '在 HTML 里这样引用它：\n\n';
        text += '  <img src="' + file.name + '" alt="">\n';
    } else {
        text += '这是二进制文件，已保存到项目中，可以在 HTML 里通过文件名引用。';
    }
    return text;
}

function selectFile(id) {
    const file = findFileById(id);
    if (!file || file.type === 'folder') return;

    if (currentFileId && currentFileId !== id) {
        const cur = findFileById(currentFileId);
        if (cur && cur.editable !== false) cur.content = codeEditorEl.value;
        clearTimeout(snapshotTimer);
    }

    currentFileId = id;
    ensureHistory(file);

    const imageViewer = document.getElementById('imageViewer');
    const imageViewerImg = document.getElementById('imageViewerImg');
    const imageViewerMeta = document.getElementById('imageViewerMeta');

    const isImage = file.isImage && file.content && file.content.startsWith('data:image/');

    if (isImage) {
        imageViewerImg.src = file.content;
        let meta = file.name;
        if (file.size) meta += ' · ' + formatSize(file.size);
        if (file.originalName && file.originalName !== file.name) meta += ' · 原文件名：' + file.originalName;
        imageViewerMeta.textContent = meta;
        imageViewer.classList.add('active');
        editorRootEl.classList.add('image-mode');
        codeEditorEl.value = '';
        codeEditorEl.disabled = true;
        updateHighlight();
    } else {
        imageViewer.classList.remove('active');
        imageViewerImg.src = '';
        editorRootEl.classList.remove('image-mode');

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

    if (item.type === 'file') {
        const newId = genId('file');
        const oldId = item.id;
        item.id = newId;
        if (currentFileId === oldId) currentFileId = newId;
    }
    renderFileTree();
    document.getElementById('currentFileName').textContent = item.name;
    updateHighlight();
    saveProjects(true);
}

function deleteItem(id) {
    if (!confirm('确定删除吗？')) return;

    const parent = findParent(id);
    if (parent && parent.children) parent.children = parent.children.filter(c => c.id !== id);
    else { const tree = getCurrentFileTree(); setCurrentFileTree(tree.filter(c => c.id !== id)); }

    if (currentFileId === id) {
        currentFileId = null;
        codeEditorEl.value = '';
        codeEditorEl.disabled = true;
        editorRootEl.classList.remove('image-mode');
        document.getElementById('imageViewer').classList.remove('active');
        document.getElementById('imageViewerImg').src = '';
        document.getElementById('currentFileName').textContent = '未选择';
        updateHighlight();
        updateUndoRedoButtons();
    }
    if (expandedFolderId && !findFileById(expandedFolderId)) expandedFolderId = null;
    renderFileTree();
    saveProjects(true);
}

/* =========================================================
   九、上传文件
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

function getNextImageName(ext) {
    const used = new Set();
    const escExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^(\\d+)\\.' + escExt + '$', 'i');
    (function walk(nodes) {
        for (const node of nodes) {
            if (node.type === 'file') {
                const m = node.name.match(re);
                if (m) used.add(parseInt(m[1], 10));
            }
            if (node.children) walk(node.children);
        }
    })(getCurrentFileTree());
    let n = 1;
    while (used.has(n)) n++;
    return n + '.' + ext;
}

function uploadFile(input) {
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    input.value = '';

    const targetFolder = getUploadTargetFolder();
    let index = 0;
    const added = [];

    function processNext() {
        if (index >= files.length) {
            renderFileTree();
            if (added.length > 0) selectFile(added[added.length - 1].id);
            saveProjects();
            return;
        }
        const file = files[index++];
        const reader = new FileReader();
        const text = isTextFile(file);
        const image = isImageFile(file);

        reader.onload = function (e) {
            const id = genId('upload');
            const content = e.target.result;
            let finalName;
            if (image) {
                const ext = (file.name.split('.').pop() || 'png').toLowerCase();
                finalName = getNextImageName(ext);
            } else {
                finalName = file.name;
            }
            const newFileObj = {
                id: id,
                name: finalName,
                originalName: file.name,
                type: 'file',
                content: content,
                mime: file.type || '',
                size: file.size,
                uploaded: true,
                isImage: image,
                editable: text
            };
            if (targetFolder) targetFolder.children.push(newFileObj);
            else { const tree = getCurrentFileTree(); tree.push(newFileObj); setCurrentFileTree(tree); }
            added.push(newFileObj);
            processNext();
        };
        reader.onerror = function () { console.warn('读取失败：', file.name); processNext(); };
        if (text) reader.readAsText(file);
        else reader.readAsDataURL(file);
    }
    processNext();
}

function toggleFileTree() {
    isTreeCollapsed = !isTreeCollapsed;
    const sidebar = document.getElementById('sidebar');
    if (isTreeCollapsed) sidebar.classList.add('collapsed');
    else sidebar.classList.remove('collapsed');
}

/* =========================================================
   十、运行预览 + 错误捕获
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

function extractDataUrl(content) {
    if (!content) return null;
    if (/^data:[^,]+,/.test(content)) return content;
    const m = content.match(/src\s*=\s*(['"])(data:[^'"]+)\1/);
    return m ? m[2] : null;
}

function resolveLocalRef(url, fileMap) {
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
    if (file.uploaded && file.editable === false) {
        return extractDataUrl(file.content) || file.content;
    }
    return file.content;
}

function resolveCssUrls(cssContent, fileMap) {
    if (!cssContent) return cssContent;
    return cssContent.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, function (match, quote, url) {
        const resolved = resolveLocalRef(url, fileMap);
        return resolved !== null ? 'url("' + resolved + '")' : match;
    });
}

function buildPreviewHtml(htmlContent) {
    if (!htmlContent) return '<!DOCTYPE html><html><body></body></html>';
    const fileMap = buildFileMap();
    let html = htmlContent;

    html = html.replace(
        /(<(?:img|source|video|audio|embed|iframe|input)\b[^>]*?)\ssrc\s*=\s*(['"])([^'"]*)\2/gi,
        function (match, before, quote, url) {
            const r = resolveLocalRef(url, fileMap);
            return r !== null ? before + ' src=' + quote + r + quote : match;
        }
    );

    html = html.replace(/<link\b[^>]*>/gi, function (tag) {
        if (!/rel\s*=\s*(['"])?stylesheet\1?/i.test(tag)) return tag;
        const hrefM = tag.match(/href\s*=\s*(['"])([^'"]*)\1/i);
        if (!hrefM) return tag;
        const r = resolveLocalRef(hrefM[2], fileMap);
        return r !== null ? '<style>' + resolveCssUrls(r, fileMap) + '</style>' : tag;
    });

    html = html.replace(
        /<script\b([^>]*?)\ssrc\s*=\s*(['"])([^'"]*)\2([^>]*?)>\s*<\/script>/gi,
        function (match, before, quote, url, after) {
            const r = resolveLocalRef(url, fileMap);
            return r !== null ? '<script' + before + after + '>' + r + '<\/script>' : match;
        }
    );

    html = html.replace(
        /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
        function (match, attrs, content) {
            return '<style' + attrs + '>' + resolveCssUrls(content, fileMap) + '</style>';
        }
    );

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

function runCode() {
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

    if (file.isImage && file.content && file.content.startsWith('data:image/')) {
        html = '<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#2d2d2d;min-height:100vh;"><img src="' + file.content + '" style="max-width:100%;max-height:100vh;"></body></html>';
    } else if (!file.name.endsWith('.html') && !file.name.endsWith('.htm')) {
        html = '<!DOCTYPE html><html><body style="margin:0;"><pre style="padding:20px;background:#f5f5f5;white-space:pre-wrap;word-break:break-all;font-family:monospace;">' + escapeHtml(file.content || '') + '</pre></body></html>';
    } else {
        html = buildPreviewHtml(file.content || '');
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
   十一、新建项目
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
                { id: 'index.html', name: 'index.html', type: 'file', content:
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
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); } catch (e) {}
});

document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveProjects(true);
});

/* =========================================================
   ★ 十二、打包成 ZIP（手写 store 模式，无外部依赖）
   ========================================================= */

/* CRC32 查表 */
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
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(str);
    }
    const utf8 = unescape(encodeURIComponent(str));
    const arr = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) arr[i] = utf8.charCodeAt(i);
    return arr;
}

function dataUrlToBytes(dataUrl) {
    const idx = dataUrl.indexOf(',');
    if (idx === -1) return textToBytes(dataUrl);
    const meta = dataUrl.slice(0, idx);
    const data = dataUrl.slice(idx + 1);
    if (meta.indexOf('base64') !== -1) {
        const bin = atob(data);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
    }
    return textToBytes(decodeURIComponent(data));
}

/* 生成 ZIP 字节流（store 模式，无压缩） */
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

        /* Local file header */
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

        /* Central directory header */
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

    /* End of central directory */
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

/* ★ 打包当前项目为 zip 并下载 */
function packProject() {
    if (!currentProjectId) {
        alert('请先进入一个项目');
        return;
    }
    const proj = projects.find(p => p.id === currentProjectId);
    if (!proj) return;

    syncCurrentFileContent();

    const rootName = sanitizeFileName(proj.name);
    const files = [];

    (function walk(nodes, prefix) {
        for (const node of nodes) {
            if (node.type === 'folder') {
                const nextPrefix = prefix ? prefix + '/' + node.name : node.name;
                walk(node.children, nextPrefix);
            } else {
                const path = prefix ? prefix + '/' + node.name : node.name;
                let bytes;

                if (node.uploaded && node.editable === false) {
                    const dataUrl = extractDataUrl(node.content) || node.content;
                    if (dataUrl && dataUrl.indexOf('data:') === 0) {
                        bytes = dataUrlToBytes(dataUrl);
                    } else {
                        bytes = textToBytes(node.content || '');
                    }
                } else {
                    bytes = textToBytes(node.content || '');
                }

                files.push({ name: rootName + '/' + path, bytes: bytes });
            }
        }
    })(proj.fileTree, '');

    if (files.length === 0) {
        alert('项目里还没有文件，无法打包');
        return;
    }

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
   启动
   ========================================================= */
init();