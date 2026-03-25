// ─── FILES MANAGER ────────────────────────────────────────────────────────────
let fmInitialized = false;

async function fmLoad() {
    const path = qs('#fm-path').value || '/';
    try {
        const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        if (data.success) {
            renderFileList(data.items);
            qs('#fm-path').value = path.endsWith('/') && path.length > 1 ? path.slice(0,-1) : path;
        } else {
            alert('Error cargando directorio: ' + data.error);
        }
    } catch (err) {
        alert('Error conectando con el servidor para archivos.');
    }
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function renderFileList(items) {
    const list = qs('#fm-list');
    list.innerHTML = '';
    
    if (items.length === 0) {
        list.innerHTML = '<div style="color:var(--text3);text-align:center;padding:20px;">Carpeta vacía</div>';
        return;
    }

    items.forEach(item => {
        const el = document.createElement('div');
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.background = 'var(--surface)';
        el.style.padding = '10px 14px';
        el.style.borderRadius = '8px';
        el.style.border = '1px solid var(--border)';
        el.style.gap = '10px';
        
        const iconName = item.isDirectory ? 'folder' : 'file';
        const color = item.isDirectory ? 'var(--accent)' : 'var(--text2)';
        const ext = item.name.split('.').pop().toLowerCase();
        const isMedia = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'ogg'].includes(ext);
        
        el.innerHTML = `
            <div style="font-size: 20px;"><i data-lucide="${iconName}" style="color:${color}"></i></div>
            <div style="flex:1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; color: ${color}; cursor: pointer;" onclick="fmItemClick('${item.path}', ${item.isDirectory})">${item.name}</div>
            <div style="font-size: 11px; color: var(--text3); width: 60px; text-align: right;">${item.isDirectory ? '' : formatBytes(item.size)}</div>
            <div style="display:flex; gap: 4px;">
                ${isMedia ? `<button class="icon-btn" style="width:30px;height:30px;font-size:12px;color:var(--accent);" onclick="showPreview('${item.path}', '${ext}')" title="Previsualizar"><i data-lucide="eye"></i></button>` : ''}
                ${!item.isDirectory ? `<button class="icon-btn" style="width:30px;height:30px;font-size:12px" onclick="fmDownload('${item.path}')" title="Descargar"><i data-lucide="download"></i></button>` : ''}
                <button class="icon-btn" style="width:30px;height:30px;font-size:12px" onclick="fmRename('${item.path}', '${item.name}')" title="Renombrar"><i data-lucide="edit-3"></i></button>
                <button class="icon-btn" style="width:30px;height:30px;font-size:12px;color:var(--red);" onclick="fmDelete('${item.path}')" title="Borrar"><i data-lucide="trash-2"></i></button>
            </div>
        `;
        list.appendChild(el);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function fmItemClick(path, isDir) {
    if (isDir) {
        qs('#fm-path').value = path;
        fmLoad();
    } else {
        const ext = path.split('.').pop().toLowerCase();
        const media = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'ogg'];
        if (media.includes(ext)) {
            showPreview(path, ext);
        }
    }
}

function showPreview(path, ext) {
    const modal = qs('#preview-modal');
    const body = qs('#preview-body');
    const filename = qs('#preview-filename');
    
    filename.textContent = path.split('/').pop();
    body.innerHTML = '<div style="color:var(--text3)">Cargando vista previa...</div>';
    modal.classList.add('open');
    
    const url = `/api/files/preview?path=${encodeURIComponent(path)}&token=${authToken}`;
    
    if (['mp4', 'webm', 'ogg'].includes(ext)) {
        body.innerHTML = `<video src="${url}" controls autoplay style="max-width:100%; max-height:70vh;"></video>`;
    } else {
        const img = new Image();
        img.onload = () => { body.innerHTML = ''; body.appendChild(img); };
        img.onerror = () => { body.innerHTML = '<div style="color:var(--red)">No se pudo cargar la imagen</div>'; };
        img.src = url;
    }
}

function closePreview() {
    qs('#preview-modal').classList.remove('open');
    qs('#preview-body').innerHTML = '';
}

function fmGoUp() {
    let p = qs('#fm-path').value;
    if (p === '/' || p === '') return;
    let parts = p.split('/').filter(Boolean);
    parts.pop();
    qs('#fm-path').value = '/' + parts.join('/');
    fmLoad();
}

function fmDownload(path) {
    const a = document.createElement('a');
    a.href = `/api/files/download?path=${encodeURIComponent(path)}&token=${authToken}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function fmDelete(path) {
    if (!confirm('¿Seguro que quieres borrar: ' + path + '?')) return;
    try {
        const res = await fetch('/api/files/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({ path })
        });
        const data = await res.json();
        if (data.success) fmLoad();
        else alert('Error: ' + data.error);
    } catch(err) { alert('Request error'); }
}

async function fmRename(oldPath, oldName) {
    const newName = prompt('Nuevo nombre:', oldName);
    if (!newName || newName === oldName) return;
    try {
        const res = await fetch('/api/files/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
            body: JSON.stringify({ path: oldPath, newName })
        });
        const data = await res.json();
        if (data.success) fmLoad();
        else alert('Error: ' + data.error);
    } catch(err) { alert('Request error'); }
}

async function fmUpload(e) {
    const files = e.target.files;
    if (!files.length) return;
    const path = qs('#fm-path').value || '/';
    
    const formData = new FormData();
    formData.append('path', path);
    for(let i=0; i<files.length; i++) {
        formData.append('files', files[i]);
    }

    try {
        const res = await fetch('/api/files/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken },
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            fmLoad();
        } else alert('Error: ' + data.error);
    } catch (err) {
        alert('Upload failed');
    }
    e.target.value = ''; // clear
}



