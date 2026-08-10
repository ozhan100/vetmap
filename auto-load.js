// =====================================================================
//  VetMap Otomatik Veri Yükleme (auto-load.js)
//  Amaç: Program açıldığında en son kullanılan klasörü (varsayılan
//  "Downloads") tarar. "İşletme Detay Listesi" ve "Sürü Kayıtları"
//  Excel dosyalarını bulursa otomatik birleştirip haritaya yükler.
//  Hiçbir şey bulamazsa manuel akış korunur.
//
//  Not: Tarayıcı güvenliği nedeniyle arka planda otomatik tarama
//  imkansızdır. İlk açılışta kullanıcıdan klasör izni istenir
//  (showDirectoryPicker). Seçilen klasör IndexedDB'ye kaydedilir ve
//  sonraki açılışlarda sessizce kullanılır. Yalnızca Chromium
//  tarayıcılarda (Chrome, Edge, Android Chrome) çalışır.
// =====================================================================

(function () {
    // her güncellemeden sonra 0.0.1 arttırılsın
    const AUTO_LOAD_VERSION = "1.1.0";

    // ── IndexedDB yardımcıları (klasör handle saklamak için) ──────────
    const DB_NAME = "vetmap_auto_load_db";
    const DB_STORE = "handles";

    function idbOpen() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(DB_STORE)) {
                    req.result.createObjectStore(DB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function saveHandle(key, handle) {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put(handle, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function loadHandle(key) {
        const db = await idbOpen();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readonly');
            const req = tx.objectStore(DB_STORE).get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    // ── Kayıtlı klasörü izinle birlikte al veya yeni seçtir ──────────
    async function getDirectoryHandle() {
        let dirHandle = await loadHandle('lastDir');

        if (dirHandle) {
            try {
                let perm = await dirHandle.queryPermission({ mode: 'read' });
                if (perm !== 'granted') {
                    perm = await dirHandle.requestPermission({ mode: 'read' });
                }
                if (perm === 'granted') return dirHandle;
            } catch (e) {
                // Kayıtlı handle geçersiz olabilir; yeni seçtirilecek
            }
        }

        if (!window.showDirectoryPicker) return null;

        try {
            // Varsayılan olarak "Downloads / İndirilenler" açılır
            dirHandle = await window.showDirectoryPicker({ startIn: 'downloads' });
            await saveHandle('lastDir', dirHandle);
            return dirHandle;
        } catch (e) {
            // Kullanıcı iptal etti
            return null;
        }
    }

    // ── Klasördeki dosyaları topla ────────────────────────────────────
    async function listFilesInDirectory(dirHandle) {
        const files = [];
        try {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file') files.push(entry);
            }
        } catch (e) {
            console.warn('Klasör okunamadı:', e);
        }
        return files;
    }

    // ── Dosya seçim yardımcıları ──────────────────────────────────────
    // Aynı türden birden fazla dosya varsa en yenisi önerilir; yine de
    // kullanıcıya seçtirilir (rastgele yükleme → harita karışması önlenir).
    async function lastModifiedOf(handle) {
        try {
            const f = await handle.getFile();
            return f.lastModified || 0;
        } catch (e) {
            return 0;
        }
    }

    async function sortNewest(candidates) {
        const dated = await Promise.all(candidates.map(async (h) => ({
            handle: h,
            mtime: await lastModifiedOf(h)
        })));
        dated.sort((a, b) => b.mtime - a.mtime);
        return dated.map(d => d.handle);
    }

    // groups: [{ type, label, files }]
    function showFileChooser(groups) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;';
            const box = document.createElement('div');
            box.style.cssText = 'background:#fff;color:#111;border-radius:12px;padding:20px 24px;max-width:540px;width:92%;max-height:80vh;overflow:auto;font-family:sans-serif;';

            const title = document.createElement('h3');
            title.textContent = 'Aynı türden birden fazla dosya bulundu';
            title.style.margin = '0 0 6px';
            const sub = document.createElement('div');
            sub.textContent = 'En yeni tarihli dosya işaretlidir. Doğru olanları seçip "Yükle" deyin.';
            sub.style.cssText = 'color:#666;font-size:13px;margin-bottom:14px;';
            box.appendChild(title);
            box.appendChild(sub);

            groups.forEach((grp) => {
                const gt = document.createElement('div');
                gt.textContent = grp.label;
                gt.style.cssText = 'font-weight:bold;margin:12px 0 6px;font-size:14px;';
                box.appendChild(gt);

                grp.files.forEach((handle, idx) => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;';
                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = 'pick-' + grp.type;
                    radio.value = String(idx);
                    if (idx === 0) radio.checked = true;
                    const span = document.createElement('span');
                    span.textContent = handle.name;
                    label.appendChild(radio);
                    label.appendChild(span);
                    box.appendChild(label);
                });
            });

            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px;';
            const cancel = document.createElement('button');
            cancel.textContent = 'Vazgeç';
            cancel.style.cssText = 'padding:8px 14px;border:1px solid #ccc;border-radius:8px;background:#f2f2f2;cursor:pointer;font-size:14px;';
            const ok = document.createElement('button');
            ok.textContent = 'Yükle';
            ok.style.cssText = 'padding:8px 18px;border:none;border-radius:8px;background:#2a7de1;color:#fff;cursor:pointer;font-size:14px;';
            btns.appendChild(cancel);
            btns.appendChild(ok);
            box.appendChild(btns);

            const close = (result) => {
                document.body.removeChild(overlay);
                resolve(result);
            };
            cancel.addEventListener('click', () => close(null));
            ok.addEventListener('click', () => {
                const picked = {};
                groups.forEach((grp) => {
                    const sel = box.querySelector('input[name="pick-' + grp.type + '"]:checked');
                    picked[grp.type] = grp.files[Number(sel.value)];
                });
                close(picked);
            });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

            overlay.appendChild(box);
            document.body.appendChild(overlay);
        });
    }

    // ── VetMap dosya eşleştirme ───────────────────────────────────────
    async function autoLoadFromDownloads() {
        if (!window.showDirectoryPicker) {
            console.log('ℹ️ Bu tarayıcı klasör taramasını desteklemiyor. Manuel yükleme kullanılacak.');
            return false;
        }

        const dirHandle = await getDirectoryHandle();
        if (!dirHandle) return false;

        const files = await listFilesInDirectory(dirHandle);
        if (files.length === 0) {
            console.log('ℹ️ Seçili klasörde dosya bulunamadı.');
            return false;
        }

        const name = (h) => h.name.toLowerCase();

        // Adayları türe göre topla (en yeni önce olacak şekilde sıralanır)
        const detayCandidates = await sortNewest(files.filter(h =>
            /\.(xls|xlsx)$/.test(name(h)) &&
            (name(h).includes('isletme') || name(h).includes('işletme') || name(h).includes('detay'))
        ));
        const suruCandidates = await sortNewest(files.filter(h =>
            /\.(xls|xlsx)$/.test(name(h)) &&
            (name(h).includes('suru') || name(h).includes('sürü') || name(h).includes('kayit'))
        ));

        if (detayCandidates.length === 0) {
            console.log('ℹ️ Klasörde İşletme Detay Listesi bulunamadı. Manuel yükleme kullanın.');
            return false;
        }

        let detay = detayCandidates[0];
        let suru = suruCandidates[0] || null;

        // Aynı türden birden fazla dosya varsa kullanıcıya sor
        const ambiguous = [];
        if (detayCandidates.length > 1) ambiguous.push({ type: 'detay', label: 'İşletme Detay Listesi', files: detayCandidates });
        if (suruCandidates.length > 1) ambiguous.push({ type: 'suru', label: 'Sürü Kayıtları Listesi', files: suruCandidates });

        if (ambiguous.length > 0) {
            const picked = await showFileChooser(ambiguous);
            if (!picked) {
                console.log('ℹ️ Dosya seçimi iptal edildi. Manuel yükleme kullanın.');
                return false;
            }
            if (picked.detay) detay = picked.detay;
            if (picked.suru) suru = picked.suru;
        }

        // Dosyaları yükle ve işleme fonksiyonuna ver
        try {
            const detayFile = await detay.getFile();
            const suruFile = suru ? await suru.getFile() : null;

            await processSelectedFiles({ suru: suruFile, detay: detayFile });
            return true;
        } catch (err) {
            console.error('Otomatik yükleme hatası:', err);
            alert('Dosya okunurken bir hata oluştu: ' + err.message);
        }
        return false;
    }

    // Dışarı aç: app.js showApp() içinden çağrılır
    window.autoLoadFromDownloads = autoLoadFromDownloads;
    window.AUTO_LOAD_VERSION = AUTO_LOAD_VERSION;
})();
