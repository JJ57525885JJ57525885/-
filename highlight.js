/* =========================================================
   语法高亮引擎
   暴露全局：escapeHtml, highlight, getLangFromName
   ========================================================= */

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function _span(cls, text) {
    return '<span class="tok-' + cls + '">' + escapeHtml(text) + '</span>';
}

/* ---- HTML ---- */
function tokenizeHtml(code) {
    let out = '', i = 0;
    const n = code.length;
    while (i < n) {
        if (code.startsWith('<!--', i)) {
            const end = code.indexOf('-->', i + 4);
            const j = end === -1 ? n : end + 3;
            out += _span('comment', code.slice(i, j));
            i = j; continue;
        }
        if (/^<!doctype/i.test(code.slice(i, i + 10))) {
            const end = code.indexOf('>', i);
            const j = end === -1 ? n : end + 1;
            out += _span('doctype', code.slice(i, j));
            i = j; continue;
        }
        if (code[i] === '<' && /^<\/?[a-zA-Z]/.test(code.slice(i, i + 3))) {
            let j = i + 1;
            let open = '<';
            if (code[j] === '/') { open = '</'; j++; }
            out += _span('punct', open);
            i = j;
            const nameM = /^[a-zA-Z][\w:.-]*/.exec(code.slice(i));
            if (nameM) { out += _span('tag', nameM[0]); i += nameM[0].length; }
            while (i < n && code[i] !== '>') {
                const ws = /^\s+/.exec(code.slice(i));
                if (ws) { out += escapeHtml(ws[0]); i += ws[0].length; continue; }
                if (code[i] === '"' || code[i] === "'") {
                    const q = code[i];
                    const end = code.indexOf(q, i + 1);
                    const j2 = end === -1 ? n : end + 1;
                    out += _span('string', code.slice(i, j2));
                    i = j2; continue;
                }
                const attrM = /^[^\s=>"'/]+/.exec(code.slice(i));
                if (attrM) { out += _span('attr', attrM[0]); i += attrM[0].length; continue; }
                out += escapeHtml(code[i]); i++;
            }
            if (i < n && code[i] === '>') { out += _span('punct', '>'); i++; }
            continue;
        }
        const next = code.indexOf('<', i);
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
        if (code.startsWith('/*', i)) {
            const end = code.indexOf('*/', i + 2);
            const j = end === -1 ? n : end + 2;
            out += _span('comment', code.slice(i, j));
            i = j; continue;
        }
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
        if (c === '#') {
            const hexM = /^#[0-9a-fA-F]{3,8}\b/.exec(code.slice(i));
            if (hexM) { out += _span('color', hexM[0]); i += hexM[0].length; continue; }
        }
        if (/[0-9]/.test(c)) {
            const numM = /^\d+(\.\d+)?(px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|pt|cm|mm|in|ex|ch)?/.exec(code.slice(i));
            if (numM) { out += _span('number', numM[0]); i += numM[0].length; continue; }
        }
        const propM = /^-?[a-zA-Z][\w-]*(?=\s*:)/.exec(code.slice(i));
        if (propM) { out += _span('property', propM[0]); i += propM[0].length; continue; }
        if (c === '.' || c === '#') {
            const selM = /^[.#][\w-]+/.exec(code.slice(i));
            if (selM) { out += _span('selector', selM[0]); i += selM[0].length; continue; }
        }
        if ('{}();:,'.includes(c)) { out += _span('punct', c); i++; continue; }
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
        if (code.startsWith('//', i)) {
            let j = code.indexOf('\n', i);
            j = j === -1 ? n : j;
            out += _span('comment', code.slice(i, j));
            i = j; continue;
        }
        if (code.startsWith('/*', i)) {
            const end = code.indexOf('*/', i + 2);
            const j = end === -1 ? n : end + 2;
            out += _span('comment', code.slice(i, j));
            i = j; continue;
        }
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
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(code[i + 1] || ''))) {
            const numM = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(\.\d+)?([eE][+-]?\d+)?)/.exec(code.slice(i));
            if (numM) { out += _span('number', numM[0]); i += numM[0].length; continue; }
        }
        if (/[a-zA-Z_$]/.test(c)) {
            const idM = /^[a-zA-Z_$][\w$]*/.exec(code.slice(i));
            const word = idM[0];
            if (JS_KEYWORDS.has(word)) out += _span('keyword', word);
            else if (JS_CONSTANTS.has(word)) out += _span('constant', word);
            else if (/^[A-Z]/.test(word)) out += _span('class', word);
            else out += _span('ident', word);
            i += word.length;
            continue;
        }
        if ('{}()[];,.'.includes(c)) { out += _span('punct', c); i++; continue; }
        if ('+-*/%=<>!&|^~?:'.includes(c)) {
            const opM = /^[+\-*/%=<>!&|^~?:]+/.exec(code.slice(i));
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
            let k = j;
            while (k < n && /\s/.test(code[k])) k++;
            if (code[k] === ':') out += _span('key', code.slice(i, j));
            else out += _span('string', code.slice(i, j));
            i = j; continue;
        }
        if (/[0-9-]/.test(c)) {
            const numM = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(code.slice(i));
            if (numM) { out += _span('number', numM[0]); i += numM[0].length; continue; }
        }
        if (/[a-z]/.test(c)) {
            const wM = /^[a-z]+/.exec(code.slice(i));
            out += _span('constant', wM[0]);
            i += wM[0].length; continue;
        }
        if ('{}[],:'.includes(c)) { out += _span('punct', c); i++; continue; }
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