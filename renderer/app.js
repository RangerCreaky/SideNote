/**
 * SideNote – Main Application Logic
 * Uses IPC to communicate with electron-store in the main process.
 */

// ===== State =====
let state = {
    folders: [],
    currentView: 'folders',
    currentFolderId: null,
    searchQuery: '',
    activeNoteId: null,
    editingNoteIds: new Set() // tracks which notes are in edit mode
};

let dragSourceNoteId = null;

// ===== Storage via IPC =====
async function loadData() {
    state.folders = (await window.electronAPI.storeGet('folders')) || [];
}

async function save() {
    await window.electronAPI.storeSet('folders', state.folders);
}

let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => save(), 500);
}

// ===== Helpers =====
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function formatDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function wordCount(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).length;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMarkdown(text) {
    if (!text || !text.trim()) return '<p style="color:var(--text-muted);font-style:italic">Empty note — click to edit</p>';
    try {
        // Configure marked for task lists
        marked.setOptions({ breaks: true, gfm: true });

        let html = marked.parse(text);

        // Remove 'disabled' from checkboxes so they're clickable
        html = html.replace(/<input\s+type="checkbox"\s*disabled\s*/gi, '<input type="checkbox" ');
        html = html.replace(/<input\s+disabled\s+type="checkbox"\s*/gi, '<input type="checkbox" ');
        html = html.replace(/<input\s+checked=""\s+disabled\s*/gi, '<input checked="" ');
        html = html.replace(/<input\s+disabled\s+checked=""\s*/gi, '<input checked="" ');

        // Fallback: if marked didn't render checkboxes, manually convert them
        // This handles `- [ ] text` and `- [x] text` patterns
        html = html.replace(
            /<li>\s*\[\s*\]\s*/gi,
            '<li><input type="checkbox" /> '
        );
        html = html.replace(
            /<li>\s*\[x\]\s*/gi,
            '<li><input type="checkbox" checked="" /> '
        );

        return html;
    } catch (e) {
        return escapeHtml(text);
    }
}

// ===== Color Palettes =====
const NOTE_COLORS = [
    '#e94560', '#533483', '#58a6ff', '#3fb950', '#d29922',
    '#bc8cff', '#f778ba', '#79c0ff', '#56d364', '#e3b341'
];

const FOLDER_COLORS = [
    { bg: 'rgba(233, 69, 96, 0.15)', fg: '#e94560' },
    { bg: 'rgba(88, 166, 255, 0.15)', fg: '#58a6ff' },
    { bg: 'rgba(63, 185, 80, 0.15)', fg: '#3fb950' },
    { bg: 'rgba(188, 140, 255, 0.15)', fg: '#bc8cff' },
    { bg: 'rgba(210, 153, 34, 0.15)', fg: '#d29922' },
    { bg: 'rgba(247, 120, 186, 0.15)', fg: '#f778ba' },
];

// ===== DOM References =====
const collapsedStrip = document.getElementById('collapsed-strip');
const expandedPanel = document.getElementById('expanded-panel');
const topTitle = document.getElementById('top-title');
const btnBack = document.getElementById('btn-back');
const btnCollapse = document.getElementById('btn-collapse');
const btnSearchToggle = document.getElementById('btn-search-toggle');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const folderListView = document.getElementById('folder-list-view');
const notesView = document.getElementById('notes-view');
const folderList = document.getElementById('folder-list');
const notesList = document.getElementById('notes-list');
const btnAddFolder = document.getElementById('btn-add-folder');
const btnAddNote = document.getElementById('btn-add-note');
const contextMenu = document.getElementById('context-menu');
const formatDropdown = document.getElementById('format-dropdown');
const resizeHandle = document.getElementById('resize-handle');

// ===== Expansion State =====
window.electronAPI.onExpansionState((expanded) => {
    if (expanded) {
        collapsedStrip.classList.add('hidden');
        expandedPanel.classList.remove('hidden');
    } else {
        expandedPanel.classList.add('hidden');
        collapsedStrip.classList.remove('hidden');
    }
});

collapsedStrip.addEventListener('click', () => {
    window.electronAPI.expand();
});

btnCollapse.addEventListener('click', () => {
    window.electronAPI.collapse();
});

// ===== Resize Handle =====
let isResizing = false;
let resizeStartX = 0;
let resizeStartWidth = 0;
let pendingResize = false;

resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeStartX = e.screenX;
    resizeStartWidth = expandedPanel.offsetWidth;
    resizeHandle.classList.add('resizing');
    document.body.style.cursor = 'ew-resize';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing || pendingResize) return;
    const deltaX = resizeStartX - e.screenX;
    const newWidth = Math.max(260, Math.min(800, resizeStartWidth + deltaX));
    pendingResize = true;
    requestAnimationFrame(() => {
        window.electronAPI.resizeWindow(newWidth);
        pendingResize = false;
    });
});

document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    pendingResize = false;
    resizeHandle.classList.remove('resizing');
    document.body.style.cursor = '';
});

// ===== Search =====
let searchVisible = false;

btnSearchToggle.addEventListener('click', () => {
    searchVisible = !searchVisible;
    if (searchVisible) {
        searchBar.classList.remove('hidden');
        searchInput.focus();
    } else {
        searchBar.classList.add('hidden');
        searchInput.value = '';
        state.searchQuery = '';
        renderCurrentView();
    }
});

searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase();
    renderCurrentView();
});

// ===== Back Button =====
btnBack.addEventListener('click', () => {
    state.currentView = 'folders';
    state.currentFolderId = null;
    state.activeNoteId = null;
    renderCurrentView();
});

// ===== Add Folder =====
btnAddFolder.addEventListener('click', () => {
    const colorIndex = state.folders.length % FOLDER_COLORS.length;
    const folder = {
        id: generateId(),
        name: 'New Folder',
        createdAt: new Date().toISOString(),
        colorIndex,
        notes: []
    };
    state.folders.push(folder);
    save();
    renderFolders();

    setTimeout(() => {
        const items = folderList.querySelectorAll('.folder-item');
        const lastItem = items[items.length - 1];
        if (lastItem) startRenameFolder(folder.id, lastItem);
    }, 50);
});

// ===== Add Note =====
btnAddNote.addEventListener('click', () => addNote());

function addNote() {
    const folder = state.folders.find(f => f.id === state.currentFolderId);
    if (!folder) return;

    const note = {
        id: generateId(),
        content: '',
        pinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        colorTag: NOTE_COLORS[folder.notes.length % NOTE_COLORS.length],
        fontSize: 13
    };
    folder.notes.push(note);
    state.editingNoteIds.add(note.id); // new notes start in edit mode
    save();
    renderNotes();

    setTimeout(() => {
        const editors = notesList.querySelectorAll('.note-editor');
        const lastEditor = editors[editors.length - 1];
        if (lastEditor) {
            lastEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            lastEditor.focus();
        }
    }, 100);
}

// ===== Render Folders =====
function renderFolders() {
    topTitle.textContent = 'SideNote';
    btnBack.classList.add('hidden');
    folderListView.classList.remove('hidden');
    notesView.classList.add('hidden');

    let folders = state.folders;
    if (state.searchQuery) {
        folders = folders.filter(f => {
            const nameMatch = f.name.toLowerCase().includes(state.searchQuery);
            const noteMatch = f.notes.some(n => n.content.toLowerCase().includes(state.searchQuery));
            return nameMatch || noteMatch;
        });
    }

    if (folders.length === 0 && !state.searchQuery) {
        folderList.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <p>No folders yet.<br>Click below to create one.</p>
      </div>
    `;
        return;
    }

    if (folders.length === 0 && state.searchQuery) {
        folderList.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>No results found</p>
      </div>
    `;
        return;
    }

    folderList.innerHTML = folders.map(folder => {
        const color = FOLDER_COLORS[folder.colorIndex || 0];
        const noteCount = folder.notes.length;
        return `
      <div class="folder-item" data-id="${folder.id}">
        <div class="folder-icon" style="background: ${color.bg}; color: ${color.fg}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="folder-info">
          <div class="folder-name">${escapeHtml(folder.name)}</div>
          <div class="folder-count">${noteCount} note${noteCount !== 1 ? 's' : ''}</div>
        </div>
        <button class="btn-icon folder-menu-btn" data-folder-id="${folder.id}" title="Options">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
      </div>
    `;
    }).join('');

    // Attach click events
    folderList.querySelectorAll('.folder-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.folder-menu-btn')) return;
            openFolder(item.dataset.id);
        });
    });

    folderList.querySelectorAll('.folder-menu-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showContextMenu(e, btn.dataset.folderId);
        });
    });
}

// ===== Open Folder =====
function openFolder(folderId) {
    state.currentView = 'notes';
    state.currentFolderId = folderId;
    renderCurrentView();
}

// ===== Render Notes =====
function renderNotes() {
    const folder = state.folders.find(f => f.id === state.currentFolderId);
    if (!folder) return;

    topTitle.textContent = folder.name;
    btnBack.classList.remove('hidden');
    folderListView.classList.add('hidden');
    notesView.classList.remove('hidden');

    let notes = [...folder.notes];

    if (state.searchQuery) {
        notes = notes.filter(n => n.content.toLowerCase().includes(state.searchQuery));
    }

    // Notes display in their stored order (drag to reorder); no automatic sort

    if (notes.length === 0 && !state.searchQuery) {
        notesList.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <p>No notes yet.<br>Click below to add one.</p>
      </div>
    `;
        return;
    }

    notesList.innerHTML = notes.map(note => {
        const wc = wordCount(note.content);
        const isEditing = state.editingNoteIds.has(note.id);

        // Build the content area: either editor (textarea) or rendered preview
        let contentHtml;
        if (isEditing) {
            contentHtml = `
              <div class="note-editor-wrapper">
                <textarea
                  class="note-editor"
                  data-note-id="${note.id}"
                  placeholder="Type your note here... (Markdown supported)"
                  style="font-size: ${note.fontSize || 13}px"
                >${escapeHtml(note.content)}</textarea>
              </div>
              <div class="note-mode-indicator editing"><span class="mode-dot"></span>editing</div>`;
        } else {
            contentHtml = `
              <div class="note-preview" data-note-id="${note.id}">
                ${renderMarkdown(note.content)}
              </div>
              <div class="note-preview-hint">click to edit</div>`;
        }

        return `
      <div class="note-card ${note.pinned ? 'pinned' : ''}" data-note-id="${note.id}">
        <div class="note-card-header">
          <div class="note-drag-handle" title="Drag to reorder"><svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/><circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/><circle cx="2.5" cy="11.5" r="1.2"/><circle cx="7.5" cy="11.5" r="1.2"/></svg></div>
          <span class="note-timestamp">${formatDate(note.updatedAt)}</span>
          <button class="note-pin-btn ${note.pinned ? 'pinned' : ''}" data-note-id="${note.id}" title="${note.pinned ? 'Unpin' : 'Pin'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${note.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M12 2l3 9h9l-7.5 5.5L19 26l-7-5.5L5 26l2.5-9.5L0 11h9z"/>
            </svg>
          </button>
        </div>
        ${contentHtml}
        <div class="note-toolbar">
          <button class="btn-tool btn-format-toggle" data-note-id="${note.id}" title="Formatting (Aa)">
            <span style="font-weight:700;font-size:13px;">Aa</span>
          </button>
          <button class="btn-tool btn-upload" data-note-id="${note.id}" title="Upload">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
          <button class="btn-tool btn-note-settings" data-note-id="${note.id}" title="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button class="btn-tool btn-download" data-note-id="${note.id}" title="Download .md">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="btn-tool btn-copy-clipboard" data-note-id="${note.id}" title="Copy Markdown">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <div class="toolbar-spacer"></div>
          <span class="note-word-count">${wc} word${wc !== 1 ? 's' : ''}</span>
          <button class="btn-tool btn-delete-note" data-note-id="${note.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
        <div class="note-color-strip" style="background: ${note.colorTag}"></div>
      </div>
    `;
    }).join('');

    attachNoteEvents();
}

// ===== Toggle Checkbox in Preview =====
function toggleCheckbox(noteId, checkboxIndex) {
    const folder = state.folders.find(f => f.id === state.currentFolderId);
    if (!folder) return;
    const note = folder.notes.find(n => n.id === noteId);
    if (!note) return;

    // Find the Nth `- [ ]` or `- [x]` in the markdown and toggle it
    const lines = note.content.split('\n');
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
        const unchecked = /^(\s*-\s*)\[\s\](.*)$/.exec(lines[i]);
        const checked = /^(\s*-\s*)\[x\](.*)$/i.exec(lines[i]);
        if (unchecked || checked) {
            if (count === checkboxIndex) {
                if (unchecked) {
                    lines[i] = unchecked[1] + '[x]' + unchecked[2];
                } else {
                    lines[i] = checked[1] + '[ ]' + checked[2];
                }
                break;
            }
            count++;
        }
    }

    note.content = lines.join('\n');
    note.updatedAt = new Date().toISOString();
    save();

    // Re-render the preview in place
    const preview = document.querySelector(`.note-preview[data-note-id="${noteId}"]`);
    if (preview) {
        preview.innerHTML = renderMarkdown(note.content);

        // Update word count and timestamp
        const card = preview.closest('.note-card');
        const wcEl = card.querySelector('.note-word-count');
        const wc = wordCount(note.content);
        wcEl.textContent = `${wc} word${wc !== 1 ? 's' : ''}`;
        const tsEl = card.querySelector('.note-timestamp');
        tsEl.textContent = formatDate(note.updatedAt);

        // Re-attach checkbox handlers on the newly rendered checkboxes
        preview.querySelectorAll('input[type="checkbox"]').forEach((cb, idx) => {
            cb.addEventListener('click', (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                toggleCheckbox(noteId, idx);
            }, true);
        });
    }
}

// ===== Switch between edit and preview =====
function switchToEdit(noteId) {
    state.editingNoteIds.add(noteId);
    state.activeNoteId = noteId;
    renderNotes();
    setTimeout(() => {
        const editor = document.querySelector(`.note-editor[data-note-id="${noteId}"]`);
        if (editor) {
            editor.focus();
            // Move cursor to end
            editor.selectionStart = editor.selectionEnd = editor.value.length;
        }
    }, 50);
}

function switchToPreview(noteId) {
    state.editingNoteIds.delete(noteId);
    renderNotes();
}

// ===== Attach Note Events =====
function attachNoteEvents() {
    // Attach checkbox handlers FIRST, directly on each checkbox
    notesList.querySelectorAll('.note-preview').forEach(preview => {
        const noteId = preview.dataset.noteId;

        // Direct handlers on each checkbox (capture phase)
        preview.querySelectorAll('input[type="checkbox"]').forEach((cb, index) => {
            cb.addEventListener('click', (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                toggleCheckbox(noteId, index, cb.checked);
            }, true); // capture phase
        });

        // Non-checkbox clicks → switch to edit mode
        preview.addEventListener('click', (e) => {
            // Skip if it was a checkbox click
            if (e.target.tagName === 'INPUT') return;
            switchToEdit(noteId);
        });
    });

    // Editor events
    notesList.querySelectorAll('.note-editor').forEach(editor => {
        const noteId = editor.dataset.noteId;

        editor.addEventListener('input', () => {
            const folder = state.folders.find(f => f.id === state.currentFolderId);
            if (!folder) return;
            const note = folder.notes.find(n => n.id === noteId);
            if (!note) return;
            note.content = editor.value;
            note.updatedAt = new Date().toISOString();

            const card = editor.closest('.note-card');
            const wcEl = card.querySelector('.note-word-count');
            const wc = wordCount(note.content);
            wcEl.textContent = `${wc} word${wc !== 1 ? 's' : ''}`;

            const tsEl = card.querySelector('.note-timestamp');
            tsEl.textContent = formatDate(note.updatedAt);

            debouncedSave();
            autoResize(editor);
        });

        editor.addEventListener('focus', () => {
            state.activeNoteId = noteId;
        });

        // Blur → switch to preview (unless clicking toolbar)
        editor.addEventListener('blur', (e) => {
            setTimeout(() => {
                const card = document.querySelector(`.note-card[data-note-id="${noteId}"]`);
                if (card && !card.contains(document.activeElement) && !document.querySelector('.format-dropdown:not(.hidden)')) {
                    switchToPreview(noteId);
                }
            }, 200);
        });

        editor.addEventListener('keydown', (e) => {
            handleEditorShortcut(e, editor);
        });

        autoResize(editor);
    });

    notesList.querySelectorAll('.note-pin-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const noteId = btn.dataset.noteId;
            const folder = state.folders.find(f => f.id === state.currentFolderId);
            if (!folder) return;
            const note = folder.notes.find(n => n.id === noteId);
            if (!note) return;
            note.pinned = !note.pinned;
            save();
            renderNotes();
        });
    });

    notesList.querySelectorAll('.btn-format-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const noteId = btn.dataset.noteId;
            state.activeNoteId = noteId;
            // If not editing, switch to edit first, then show dropdown
            if (!state.editingNoteIds.has(noteId)) {
                switchToEdit(noteId);
                setTimeout(() => {
                    const newBtn = notesList.querySelector(`.btn-format-toggle[data-note-id="${noteId}"]`);
                    if (newBtn) showFormatDropdown(newBtn);
                }, 100);
            } else {
                showFormatDropdown(btn);
            }
        });
    });

    notesList.querySelectorAll('.btn-upload').forEach(btn => {
        btn.addEventListener('click', () => handleUpload(btn.dataset.noteId));
    });

    notesList.querySelectorAll('.btn-note-settings').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showNoteSettings(btn, btn.dataset.noteId);
        });
    });

    notesList.querySelectorAll('.btn-download').forEach(btn => {
        btn.addEventListener('click', () => handleDownload(btn.dataset.noteId));
    });

    notesList.querySelectorAll('.btn-delete-note').forEach(btn => {
        btn.addEventListener('click', () => {
            showConfirm('Delete Note', 'Are you sure? This cannot be undone.', () => {
                deleteNote(btn.dataset.noteId);
            });
        });
    });

    // ===== Copy to Clipboard =====
    notesList.querySelectorAll('.btn-copy-clipboard').forEach(btn => {
        btn.addEventListener('click', async () => {
            const folder = state.folders.find(f => f.id === state.currentFolderId);
            if (!folder) return;
            const note = folder.notes.find(n => n.id === btn.dataset.noteId);
            if (!note) return;
            try {
                await navigator.clipboard.writeText(note.content);
                btn.classList.add('copied');
                const origTitle = btn.title;
                btn.title = 'Copied!';
                setTimeout(() => { btn.classList.remove('copied'); btn.title = origTitle; }, 1500);
            } catch (e) {
                console.error('Clipboard write failed:', e);
            }
        });
    });

    // ===== Note Drag-to-Reorder + Image Drag-and-Drop =====
    notesList.querySelectorAll('.note-card').forEach(card => {
        const noteId = card.dataset.noteId;
        const handle = card.querySelector('.note-drag-handle');

        // Enable card dragging only when user grabs the drag handle
        handle.addEventListener('mousedown', () => {
            card.setAttribute('draggable', 'true');
            const cleanup = () => {
                if (!dragSourceNoteId) card.removeAttribute('draggable');
            };
            document.addEventListener('mouseup', cleanup, { once: true });
        });

        card.addEventListener('dragstart', (e) => {
            dragSourceNoteId = noteId;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', noteId);
            requestAnimationFrame(() => card.classList.add('note-dragging'));
        });

        card.addEventListener('dragend', () => {
            card.removeAttribute('draggable');
            card.classList.remove('note-dragging');
            notesList.querySelectorAll('.note-card').forEach(c => {
                c.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-image-over');
            });
            dragSourceNoteId = null;
        });

        card.addEventListener('dragover', (e) => {
            if (dragSourceNoteId) {
                // Note reorder drag
                if (dragSourceNoteId === noteId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = card.getBoundingClientRect();
                notesList.querySelectorAll('.note-card').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
                card.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
            } else {
                // Image file from desktop
                const hasImage = Array.from(e.dataTransfer.items).some(item => item.kind === 'file' && item.type.startsWith('image/'));
                if (!hasImage) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                card.classList.add('drag-image-over');
            }
        });

        card.addEventListener('dragleave', (e) => {
            if (!card.contains(e.relatedTarget)) {
                card.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-image-over');
            }
        });

        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            card.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-image-over');

            if (dragSourceNoteId && dragSourceNoteId !== noteId) {
                // Reorder: move source note to this position
                const folder = state.folders.find(f => f.id === state.currentFolderId);
                if (!folder) return;
                const srcIdx = folder.notes.findIndex(n => n.id === dragSourceNoteId);
                const tgtIdx = folder.notes.findIndex(n => n.id === noteId);
                if (srcIdx === -1 || tgtIdx === -1) return;
                const rect = card.getBoundingClientRect();
                const insertAfter = e.clientY >= rect.top + rect.height / 2;
                const [removed] = folder.notes.splice(srcIdx, 1);
                const newTgt = folder.notes.findIndex(n => n.id === noteId);
                folder.notes.splice(insertAfter ? newTgt + 1 : newTgt, 0, removed);
                save();
                renderNotes();
            } else if (!dragSourceNoteId) {
                // Image drop from desktop
                const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                if (files.length === 0) return;
                if (!state.editingNoteIds.has(noteId)) {
                    switchToEdit(noteId);
                    await new Promise(r => setTimeout(r, 150));
                }
                const editor = document.querySelector(`.note-editor[data-note-id="${noteId}"]`);
                if (!editor) return;
                const pos = editor.selectionStart;
                const insertText = files.filter(f => f.path).map(f => `![${f.name}](file://${f.path})`).join('\n') + '\n';
                if (!insertText.trim()) return;
                editor.value = editor.value.substring(0, pos) + insertText + editor.value.substring(pos);
                editor.dispatchEvent(new Event('input'));
                editor.focus();
            }
        });
    });
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
}

// ===== Context Menu (Folders) =====
let contextMenuTarget = null;

function showContextMenu(event, folderId) {
    contextMenuTarget = folderId;
    const rect = event.target.getBoundingClientRect();
    contextMenu.classList.remove('hidden');
    contextMenu.style.top = rect.bottom + 4 + 'px';
    contextMenu.style.left = Math.min(rect.left, window.innerWidth - 180) + 'px';
}

function hideContextMenu() {
    contextMenu.classList.add('hidden');
    contextMenuTarget = null;
}

contextMenu.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', () => {
        const action = item.dataset.action;
        const targetId = contextMenuTarget; // capture before hideContextMenu nulls it
        hideContextMenu();
        if (action === 'rename') {
            const folderEl = folderList.querySelector(`[data-id="${targetId}"]`);
            if (folderEl) startRenameFolder(targetId, folderEl);
        } else if (action === 'delete') {
            showConfirm('Delete Folder', 'All notes inside will be deleted. Continue?', () => {
                deleteFolder(targetId);
            });
        }
    });
});

document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
    if (!formatDropdown.contains(e.target) && !e.target.closest('.btn-format-toggle')) hideFormatDropdown();
    const sd = document.querySelector('.settings-dropdown');
    if (sd && !sd.contains(e.target) && !e.target.closest('.btn-note-settings')) sd.remove();
});

// ===== Rename Folder =====
function startRenameFolder(folderId, folderEl) {
    const nameEl = folderEl.querySelector('.folder-name');
    const folder = state.folders.find(f => f.id === folderId);
    if (!folder) return;

    const input = document.createElement('input');
    input.className = 'folder-name-input';
    input.value = folder.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = () => {
        const newName = input.value.trim() || 'Untitled';
        folder.name = newName;
        save();
        renderFolders();
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = folder.name; input.blur(); }
    });
}

// ===== Delete =====
function deleteFolder(folderId) {
    state.folders = state.folders.filter(f => f.id !== folderId);
    save();
    renderFolders();
}

function deleteNote(noteId) {
    const folder = state.folders.find(f => f.id === state.currentFolderId);
    if (!folder) return;
    folder.notes = folder.notes.filter(n => n.id !== noteId);
    save();
    renderNotes();
}

// ===== Confirm Dialog =====
function showConfirm(title, text, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-title">${title}</div>
      <div class="confirm-text">${text}</div>
      <div class="confirm-actions">
        <button class="btn-confirm cancel">Cancel</button>
        <button class="btn-confirm danger">Delete</button>
      </div>
    </div>
  `;
    document.body.appendChild(overlay);

    overlay.querySelector('.cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.danger').addEventListener('click', () => { onConfirm(); overlay.remove(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ===== Format Dropdown =====
function showFormatDropdown(anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    formatDropdown.classList.remove('hidden');
    const dropdownHeight = formatDropdown.offsetHeight;
    let top = rect.top - dropdownHeight - 4;
    if (top < 10) top = rect.bottom + 4;
    formatDropdown.style.top = top + 'px';
    formatDropdown.style.left = Math.max(10, rect.left - 80) + 'px';
}

function hideFormatDropdown() {
    formatDropdown.classList.add('hidden');
}

formatDropdown.querySelectorAll('.format-item').forEach(item => {
    item.addEventListener('click', () => {
        applyFormat(item.dataset.format);
        hideFormatDropdown();
    });
});

// ===== Apply Markdown Format =====
function applyFormat(format) {
    // Make sure we're in edit mode first
    if (!state.editingNoteIds.has(state.activeNoteId)) {
        switchToEdit(state.activeNoteId);
    }
    const editor = document.querySelector(`.note-editor[data-note-id="${state.activeNoteId}"]`);
    if (!editor) return;

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.substring(start, end);
    let replacement = '';
    let cursorOffset = 0;

    switch (format) {
        case 'bold':
            replacement = `**${selected || 'bold text'}**`;
            cursorOffset = selected ? replacement.length : 2;
            break;
        case 'italic':
            replacement = `*${selected || 'italic text'}*`;
            cursorOffset = selected ? replacement.length : 1;
            break;
        case 'strike':
            replacement = `~~${selected || 'strikethrough'}~~`;
            cursorOffset = selected ? replacement.length : 2;
            break;
        case 'highlight':
            replacement = `==${selected || 'highlighted text'}==`;
            cursorOffset = selected ? replacement.length : 2;
            break;
        case 'code':
            if (selected.includes('\n')) {
                replacement = '```\n' + (selected || 'code') + '\n```';
            } else {
                replacement = '`' + (selected || 'code') + '`';
            }
            cursorOffset = selected ? replacement.length : 1;
            break;
        case 'header':
            replacement = `## ${selected || 'Heading'}`;
            cursorOffset = replacement.length;
            break;
        case 'quote':
            replacement = selected ? selected.split('\n').map(l => `> ${l}`).join('\n') : '> quote';
            cursorOffset = replacement.length;
            break;
        case 'link':
            replacement = `[${selected || 'link text'}](url)`;
            cursorOffset = selected ? replacement.length - 4 : 1;
            break;
        case 'picture':
            replacement = `![${selected || 'alt text'}](image-url)`;
            cursorOffset = selected ? replacement.length : 1;
            break;
        case 'list':
            replacement = selected ? selected.split('\n').map(l => `- ${l}`).join('\n') : '- item';
            cursorOffset = replacement.length;
            break;
        case 'ordered_list':
            replacement = selected ? selected.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n') : '1. item';
            cursorOffset = replacement.length;
            break;
        case 'todo':
            replacement = selected ? selected.split('\n').map(l => `- [ ] ${l}`).join('\n') : '- [ ] task';
            cursorOffset = replacement.length;
            break;
    }

    editor.value = editor.value.substring(0, start) + replacement + editor.value.substring(end);
    editor.dispatchEvent(new Event('input'));
    const newPos = start + cursorOffset;
    editor.setSelectionRange(newPos, newPos);
    editor.focus();
}

// ===== Keyboard Shortcuts =====
function handleEditorShortcut(e, editor) {
    const meta = e.metaKey || e.ctrlKey;
    const shift = e.shiftKey;

    if (meta && !shift && e.key === 'b') { e.preventDefault(); e.stopPropagation(); applyFormat('bold'); }
    else if (meta && !shift && e.key === 'i') { e.preventDefault(); e.stopPropagation(); applyFormat('italic'); }
    else if (meta && !shift && e.key === 'k') { e.preventDefault(); e.stopPropagation(); applyFormat('link'); }
    else if (meta && !shift && e.key === 'e') { e.preventDefault(); e.stopPropagation(); applyFormat('code'); }
    else if (meta && shift && (e.key === 'T' || e.key === 't')) { e.preventDefault(); e.stopPropagation(); applyFormat('todo'); }
    else if (meta && shift && (e.key === 'I' || e.key === 'i')) { e.preventDefault(); e.stopPropagation(); applyFormat('picture'); }
    else if (meta && shift && (e.key === 'H' || e.key === 'h')) { e.preventDefault(); e.stopPropagation(); applyFormat('header'); }
    else if (meta && shift && (e.key === "'" || e.key === '"')) { e.preventDefault(); e.stopPropagation(); applyFormat('quote'); }
    else if (meta && shift && (e.key === 'M' || e.key === 'm')) { e.preventDefault(); e.stopPropagation(); applyFormat('highlight'); }
    else if (meta && shift && (e.key === 'X' || e.key === 'x')) { e.preventDefault(); e.stopPropagation(); applyFormat('strike'); }
    else if (meta && shift && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); e.stopPropagation(); applyFormat('list'); }
    else if (meta && shift && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); e.stopPropagation(); applyFormat('ordered_list'); }
}

// Global shortcuts
document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key === 'n' && state.currentView === 'notes') { e.preventDefault(); addNote(); }
    if (meta && e.key === 'f') {
        e.preventDefault();
        if (!searchVisible) { searchVisible = true; searchBar.classList.remove('hidden'); }
        searchInput.focus();
    }
    if (e.key === 'Escape') {
        hideContextMenu();
        hideFormatDropdown();
        if (searchVisible) {
            searchVisible = false;
            searchBar.classList.add('hidden');
            searchInput.value = '';
            state.searchQuery = '';
            renderCurrentView();
        }
    }
});

// ===== Upload =====
async function handleUpload(noteId) {
    const result = await window.electronAPI.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (result.canceled || !result.filePaths.length) return;
    const filePath = result.filePaths[0];
    const fileName = filePath.split('/').pop();
    // Switch to edit mode if needed
    if (!state.editingNoteIds.has(noteId)) {
        switchToEdit(noteId);
        await new Promise(r => setTimeout(r, 100));
    }
    const editor = document.querySelector(`.note-editor[data-note-id="${noteId}"]`);
    if (!editor) return;
    const pos = editor.selectionStart;
    const insertion = `![${fileName}](file://${filePath})\n`;
    editor.value = editor.value.substring(0, pos) + insertion + editor.value.substring(pos);
    editor.dispatchEvent(new Event('input'));
}

// ===== Download =====
async function handleDownload(noteId) {
    const folder = state.folders.find(f => f.id === state.currentFolderId);
    if (!folder) return;
    const note = folder.notes.find(n => n.id === noteId);
    if (!note) return;
    const defaultName = note.content.split('\n')[0]?.replace(/[#*[\]]/g, '').trim().substring(0, 40) || 'note';
    const result = await window.electronAPI.showSaveDialog({
        defaultPath: `${defaultName}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return;
    await window.electronAPI.writeFile(result.filePath, note.content);
}

// ===== Note Settings =====
function showNoteSettings(anchorBtn, noteId) {
    const existing = document.querySelector('.settings-dropdown');
    if (existing) existing.remove();

    const folder = state.folders.find(f => f.id === state.currentFolderId);
    if (!folder) return;
    const note = folder.notes.find(n => n.id === noteId);
    if (!note) return;

    const rect = anchorBtn.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'settings-dropdown';

    dropdown.innerHTML = `
    <div class="settings-label">Font Size</div>
    <div class="settings-row">
      <div class="font-size-control">
        <button class="btn-font-dec">−</button>
        <span class="font-size-val">${note.fontSize || 13}</span>
        <button class="btn-font-inc">+</button>
      </div>
    </div>
    <div class="settings-label" style="margin-top:10px">Color Tag</div>
    <div class="color-picker-grid">
      ${NOTE_COLORS.map(c => `<div class="color-swatch ${note.colorTag === c ? 'active' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
    </div>
  `;

    let top = rect.top - 180;
    if (top < 10) top = rect.bottom + 4;
    dropdown.style.top = top + 'px';
    dropdown.style.left = Math.max(10, rect.left - 100) + 'px';
    document.body.appendChild(dropdown);

    const fontVal = dropdown.querySelector('.font-size-val');
    dropdown.querySelector('.btn-font-dec').addEventListener('click', (e) => {
        e.stopPropagation();
        note.fontSize = Math.max(10, (note.fontSize || 13) - 1);
        fontVal.textContent = note.fontSize;
        const editor = document.querySelector(`.note-editor[data-note-id="${noteId}"]`);
        if (editor) editor.style.fontSize = note.fontSize + 'px';
        save();
    });
    dropdown.querySelector('.btn-font-inc').addEventListener('click', (e) => {
        e.stopPropagation();
        note.fontSize = Math.min(24, (note.fontSize || 13) + 1);
        fontVal.textContent = note.fontSize;
        const editor = document.querySelector(`.note-editor[data-note-id="${noteId}"]`);
        if (editor) editor.style.fontSize = note.fontSize + 'px';
        save();
    });
    dropdown.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            note.colorTag = swatch.dataset.color;
            save();
            renderNotes();
        });
    });
}

// ===== Render Router =====
function renderCurrentView() {
    if (state.currentView === 'folders') renderFolders();
    else if (state.currentView === 'notes') renderNotes();
}

// ===== Initialize =====
async function init() {
    await loadData();
    const expanded = await window.electronAPI.getExpandedState();
    if (expanded) {
        collapsedStrip.classList.add('hidden');
        expandedPanel.classList.remove('hidden');
    }
    renderCurrentView();
}

init();
