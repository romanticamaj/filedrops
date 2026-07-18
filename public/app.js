// public/app.js
const code = location.pathname.split('/').pop();
const base = `/r/${code}`;
const list = document.getElementById('list');
const drop = document.getElementById('drop');
const picker = document.getElementById('picker');
const uploads = document.getElementById('uploads');

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

function uploadFiles(fileList) {
  Array.from(fileList).forEach(uploadOne);
  picker.value = ''; // let the same file be re-selected later
}

// Upload one file via XHR so we can show its own progress bar.
function uploadOne(file) {
  const name = document.createElement('span');
  name.className = 'up-name';
  name.textContent = file.name;
  const pct = document.createElement('span');
  pct.className = 'up-pct';
  pct.textContent = '0%';
  const head = document.createElement('div');
  head.className = 'up-head';
  head.append(name, pct);
  const fill = document.createElement('div');
  fill.className = 'up-fill';
  const track = document.createElement('div');
  track.className = 'up-track';
  track.append(fill);
  const row = document.createElement('div');
  row.className = 'up';
  row.append(head, track);
  uploads.append(row);

  function fail(msg) {
    row.classList.add('failed');
    pct.textContent = msg;
    fill.style.width = '100%';
    setTimeout(() => row.remove(), 4000);
  }

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${base}/upload`);
  xhr.setRequestHeader('Accept', 'application/json');
  xhr.upload.addEventListener('progress', (e) => {
    if (!e.lengthComputable) return;
    const p = Math.round((e.loaded / e.total) * 100);
    fill.style.width = p + '%';
    pct.textContent = p + '%';
  });
  xhr.addEventListener('load', () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      fill.style.width = '100%';
      pct.textContent = '完成';
      row.classList.add('done');
      setTimeout(() => { row.remove(); refresh(); }, 500);
    } else {
      fail(xhr.status === 413 ? '檔案太大' : '上傳失敗');
    }
  });
  xhr.addEventListener('error', () => fail('連線錯誤'));

  const fd = new FormData();
  fd.append('files', file);
  xhr.send(fd);
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
