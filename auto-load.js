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
    const AUTO_LOAD_VERSION = "1.0.0";

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

        // 1) Zorunlu: İşletme Detay Listesi (.xls / .xlsx)
        const detayHandle = files.find(h =>
            /\.(xls|xlsx)$/.test(name(h)) &&
            (name(h).includes('isletme') || name(h).includes('işletme') || name(h).includes('detay'))
        );
        if (!detayHandle) {
            console.log('ℹ️ Klasörde İşletme Detay Listesi bulunamadı. Manuel yükleme kullanın.');
            return false;
        }

        // 2) Opsiyonel: Sürü Kayıtları Listesi (.xls / .xlsx)
        const suruHandle = files.find(h =>
            /\.(xls|xlsx)$/.test(name(h)) &&
            (name(h).includes('suru') || name(h).includes('sürü') || name(h).includes('kayit'))
        );

        // 3) Dosyaları yükle ve işleme fonksiyonuna ver
        try {
            const detayFile = await detayHandle.getFile();
            const suruFile = suruHandle ? await suruHandle.getFile() : null;

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
