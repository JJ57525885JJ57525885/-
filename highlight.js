/* =========================================================
   语法高亮引擎（O(n) 优化版）
   暴露全局：escapeHtml, highlight, getLangFromName

   ★ 修复要点
   - 所有 code.slice(i) 改为 code.slice(i, i + PEEK_LIMIT)
     原本每个 token 都从 i 切到整个代码末尾（O(n)），
     循环 n 次 → O(n²)。限制成固定窗口后变成 O(1) 每 token。
   - HTML 文本分支的 indexOf 从 i+1 开始，避免 '<x' 不匹配时无限循环。
   - 空白批量跳过，减少循环次数。
   ========================================================= */

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function _span(cls, text) {
    return '<span class="tok-' + cls + '">' + escapeHtml(text) + '</span>';
}

/* 向前窥视时最多看这么多字符，防止 O(n²) */
const PEEK_LIMIT = 300;

/* ---- HTML ---- */
function tokenizeHtml(code) {
    let out = '', i = 0;
    const n = code.length;
    while (i < n) {
        const c = code[i];
        if (c === '<') {
            // 注释
            if (code.startsWith('<!--', i)) {
                const end = code.indexOf('-->', i + 4);
                const j = end === -1 ? n : end + 3;
                out += _span('comment', code.slice(i, j));
                i = j; continue;
            }
            // doctype
            if (/^<!doctype/i.test(code.slice(i, i + 10))) {
                const end = code.indexOf('>', i);
                const j = end === -1 ? n : end + 1;
                out += _span('doctype', code.slice(i, j));
                i = j; continue;
            }
            // 标签 <tag ...> 或 </tag>
            if (/^<\/?[a-zA-Z]/.test(code.slice(i, i + 3))) {
                let j = i + 1;
                let open = '<';
                if (code[j] === '/') { open = '</'; j++; }
                out += _span('punct', open);
                i = j;

                const nameM = /^[a-zA-Z][\w:.-]*/.exec(code.slice(i, i + PEEK_LIMIT));
                if (nameM) { out += _span('tag', nameM[0]); i += nameM[0].length; }

                while (i < n && code[i] !== '>') {
                    // 批量跳空白
                    if (/\s/.test(code[i])) {
                        let j2 = i;
                        while (j2 < n && /\s/.test(code[j2])) j2++;
                        out += escapeHtml(code.slice(i, j2));
                        i = j2;
                        continue;
                    }
                    // 引号字符串
                    if (code[i] === '"' || code[i] === "'") {
                        const q = code[i];
                        const end = code.indexOf(q, i + 1);
                        const j2 = end === -1 ? n : end + 1;
                        out += _span('string', code.slice(i, j2));
                        i = j2; continue;
                    }
                    // 属性名
                    const attrM = /^[^\s=>"'/]+/.exec(code.slice(i, i + PEEK_LIMIT));
                    if (attrM) { out += _span('attr', attrM[0]); i += attrM[0].length; continue; }
                    out += escapeHtml(code[i]); i++;
                }
                if (i < n && code[i] === '>') { out += _span('punct', '>'); i++; }
                continue;
            }
        }
        // 文本：一次性跳到下一个 '<'
        const next = code.indexOf('<', i + 1);
        const j = next === -1 ? n : next;
        out += escapeHtml(code.slice(i, j));
        i = j;
    }
    return out;
}

/* ---- CSS ---- */
function tokenizeCss(code) {
    let out = '', i = 0;
    const n = code.length;
    while (i < n) {
        const c = code[i];

        // 注释
        if (c === '/' && code[i + 1] === '*') {
            const end = code.indexOf('*/', i + 2);
            const j = end === -1 ? n : end + 2;
            out += _span('comment', code.slice(i, j));
            i = j; continue;
        }
        // 字符串
        if (c === '"' || c === "'") {
            const q = c;
            let j = i + 1;
            while (j < n) {
                if (code[j] === '\\') { j += 2; continue; }
                if (code[j] === q) { j++; break; }
                j++;
            }
            j = Math.min(j, n);
            out += _span('string', code.slice(i, j));
            i = j; continue;
        }
        // 颜色 #xxx
        if (c === '#') {
            const hexM = /^#[0-9a-fA-F]{3,8}\b/.exec(code.slice(i, i + PEEK_LIMIT));
            if (hexM) { out += _span('color', hexM[0]); i += hexM[0].length; continue; }
        }
        // 数字
        if (c >= '0' && c <= '9') {
            const numM = /^\d+(\.\d+)?(px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|pt|cm|mm|in|ex|ch)?/.exec(code.slice(i, i + PEEK_LIMIT));
            if (numM) { out += _span('number', numM[0]); i += numM[0].length; continue; }
        }
        // 属性名 prop:
        const propM = /^-?[a-zA-Z][\w-]*(?=\s*:)/.exec(code.slice(i, i + PEEK_LIMIT));
        if (propM) { out += _span('property', propM[0]); i += propM[0].length; continue; }
        // 选择器 .xxx / #xxx
        if (c === '.' || c === '#') {
            const selM = /^[.#][\w-]+/.exec(code.slice(i, i + PEEK_LIMIT));
            if (selM) { out += _span('selector', selM[0]); i += selM[0].length; continue; }
        }
        if (c === '{' || c === '}' || c === '(' || c === ')' || c === ';' || c === ':' || c === ',') {
            out += _span('punct', c); i++; continue;
        }
        out += escapeHtml(c); i++;
    }
    return out;
}

/* ---- JavaScript ---- */
const JS_KEYWORDS = new Set([
    'var','let','const','function','return','if','else','for','while','do',
    'switch','case','break','continue','new','delete','typeof','instanceof',
    'in','of','this','class','extends','super','import','export','default',
    'from','as','try','catch','finally','throw','await','async','yield',
    'void','static','get','set','with','debugger'
]);
const JS_CONSTANTS = new Set(['true','false','null','undefined','NaN','Infinity']);

function tokenizeJs(code) {
    let out = '', i = 0;
    const n = code.length;
    while (i < n) {
        const c = code[i];

        // 行注释
        if (c === '/' && code[i + 1] === '/') {
            let j = code.indexOf('\n', i);
            j = j === -1 ? n : j;
            out += _span('comment', code.slice(i, j));
            i = j; continue;
        }
        // 块注释
        if (c === '/' && code[i + 1] === '*') {
            const end = code.indexOf('*/', i + 2);
            const j = end === -1 ? n : end + 2;
            out += _span('comment', code.slice(i, j));
            i = j; continue;
        }
        // 字符串
        if (c === '"' || c === "'" || c === '`') {
            const q = c;
            let j = i + 1;
            while (j < n) {
                if (code[j] === '\\') { j += 2; continue; }
                if (code[j] === q) { j++; break; }
                if (q !== '`' && code[j] === '\n') break;
                j++;
            }
            out += _span('string', code.slice(i, j));
            i = j; continue;
        }
        // 数字
        if ((c >= '0' && c <= '9') || (c === '.' && code[i + 1] >= '0' && code[i + 1] <= '9')) {
            const numM = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(\.\d+)?([eE][+-]?\d+)?)/.exec(code.slice(i, i + PEEK_LIMIT));
            if (numM) { out += _span('number', numM[0]); i += numM[0].length; continue; }
        }
        // 标识符
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$') {
            const idM = /^[a-zA-Z_$][\w$]*/.exec(code.slice(i, i + PEEK_LIMIT));
            const word = idM[0];
            if (JS_KEYWORDS.has(word)) out += _span('keyword', word);
            else if (JS_CONSTANTS.has(word)) out += _span('constant', word);
            else if (word[0] >= 'A' && word[0] <= 'Z') out += _span('class', word);
            else out += _span('ident', word);
            i += word.length;
            continue;
        }
        // 标点
        if (c === '{' || c === '}' || c === '(' || c === ')' || c === '[' || c === ']' ||
            c === ';' || c === ',' || c === '.') {
            out += _span('punct', c); i++; continue;
        }
        // 运算符
        if ('+-*/%=<>!&|^~?:'.indexOf(c) !== -1) {
            const opM = /^[+\-*/%=<>!&|^~?:]+/.exec(code.slice(i, i + 20));
            out += _span('op', opM[0]);
            i += opM[0].length; continue;
        }
        out += escapeHtml(c); i++;
    }
    return out;
}

/* ---- JSON ---- */
function tokenizeJson(code) {
    let out = '', i = 0;
    const n = code.length;
    while (i < n) {
        const c = code[i];

        if (c === '"') {
            let j = i + 1;
            while (j < n) {
                if (code[j] === '\\') { j += 2; continue; }
                if (code[j] === '"') { j++; break; }
                j++;
            }
            // 向前看是不是 key（后跟冒号）
            let k = j;
            while (k < n && (code[k] === ' ' || code[k] === '\t' || code[k] === '\n' || code[k] === '\r')) k++;
            if (code[k] === ':') out += _span('key', code.slice(i, j));
            else out += _span('string', code.slice(i, j));
            i = j; continue;
        }
        if ((c >= '0' && c <= '9') || c === '-') {
            const numM = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(code.slice(i, i + PEEK_LIMIT));
            if (numM) { out += _span('number', numM[0]); i += numM[0].length; continue; }
        }
        if (c >= 'a' && c <= 'z') {
            const wM = /^[a-z]+/.exec(code.slice(i, i + PEEK_LIMIT));
            out += _span('constant', wM[0]);
            i += wM[0].length; continue;
        }
        if (c === '{' || c === '}' || c === '[' || c === ']' || c === ',' || c === ':') {
            out += _span('punct', c); i++; continue;
        }
        out += escapeHtml(c); i++;
    }
    return out;
}

function getLangFromName(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['html', 'htm', 'xhtml', 'svg', 'vue', 'xml', 'svelte'].includes(ext)) return 'html';
    if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'css';
    if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(ext)) return 'js';
    if (['json', 'json5'].includes(ext)) return 'json';
    return 'plain';
}

function highlight(code, lang) {
    try {
        switch (lang) {
            case 'html': return tokenizeHtml(code);
            case 'css':  return tokenizeCss(code);
            case 'js':   return tokenizeJs(code);
            case 'json': return tokenizeJson(code);
            default:     return escapeHtml(code);
        }
    } catch (e) {
        return escapeHtml(code);
    }
}