// public/app.js
const code = location.pathname.split('/').pop();
const base = `/r/${code}`;
const list = document.getElementById('list');
const drop = document.getElementById('drop');
const picker = document.getElementById('picker');

function fmtSize(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function refresh() {
  const res = await fetch(`${base}/list`, { headers: { Accept: 'application/json' } });
  const { files } = await res.json();
  list.innerHTML = '';
  if (!files.length) { list.innerHTML = '<li class="empty">尚無檔案</li>'; return; }
  for (const f of files) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `${base}/file/${f.id}`;
    a.textContent = f.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = fmtSize(f.size);
    const del = document.createElement('button');
    del.textContent = '刪除';
    del.onclick = async () => {
      await fetch(`${base}/delete/${f.id}`, { method: 'POST', headers: { Accept: 'application/json' } });
      refresh();
    };
    li.append(a, meta, del);
    list.append(li);
  }
}

async function uploadFiles(fileList) {
  if (!fileList.length) return;
  const fd = new FormData();
  for (const file of fileList) fd.append('files', file);
  drop.classList.add('busy');
  await fetch(`${base}/upload`, { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
  drop.classList.remove('busy');
  refresh();
}

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  uploadFiles(e.dataTransfer.files);
});
drop.addEventListener('click', () => picker.click());
picker.addEventListener('change', () => uploadFiles(picker.files));

document.getElementById('clear').onclick = async () => {
  await fetch(`${base}/clear`, { method: 'POST', headers: { Accept: 'application/json' } });
  refresh();
};
document.getElementById('roomUrl').textContent = location.href;

fetch(`${base}/qr`).then((r) => r.json()).then(({ dataUrl }) => {
  document.getElementById('qr').src = dataUrl;
});

refresh();
setInterval(refresh, 4000);
