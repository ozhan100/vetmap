const APP_VERSION = "1.3.8";
let map;
let markerCluster;
let businesses = [];
let animalTypes = [];
let selectedAnimals = [];
let userMarker;
let allMarkers = [];
let suruData = {};

// Auth Credentials
const AUTH_CONFIG = {
    notificationEnabled: true
};

// SUPABASE AYARLARI (Supabase panelinden alıp buraya yapıştırın)
const SUPABASE_URL = 'https://tjedetetzqenwdlqgwiv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ig4eVjojcsZqRraP8cD5xg_WPdUsBgp';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentOwnerData = null;
let currentSearchResults = [];
let currentSearchIndex = 0;

// Initialize Map
function initMap() {
    // Default view: Inegöl center
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([40.08, 29.51], 12);

    // Katman Tanımlamaları
    const streetTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    });

    const googleStreets = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: 'Google',
        maxZoom: 19
    });

    const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    });

    const satelliteTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri',
        maxZoom: 19
    });

    const hybridTiles = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: 'Google',
        maxZoom: 19
    });

    // Varsayılan olarak Hibrit Haritayı ekle (Uydu + İsimler)
    hybridTiles.addTo(map);

    markerCluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 17
    });
    
    map.addLayer(markerCluster);

    // Load Data
    loadData();

    // Event Listeners
    document.getElementById('locateBtn').addEventListener('click', locateUser);
    
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            applyFilters(true); // true means forced search with zoom
        }
    });
    searchBtn.addEventListener('click', () => applyFilters(true));
    
    // Animal Filter Listeners
    const filterBtn = document.getElementById('animalFilterBtn');
    const dropdown = document.getElementById('animalDropdown');
    const selectAll = document.getElementById('selectAllAnimals');
    filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== filterBtn) {
            dropdown.classList.remove('active');
        }
    });

    selectAll.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.animal-checkbox');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
        updateFilters();
    });
    
    // Close panel when clicking on map
    map.on('click', () => {
        document.getElementById('infoPanel').classList.remove('active');
    });

    // Start tracking user
    locateUser();
}

async function loadData() {
    console.log("Başlangıçta veri yüklenmeyecek. Lütfen dosyaları yükleyiniz.");
}

function setupAnimalFilter() {
    const list = document.getElementById('animalList');
    list.innerHTML = animalTypes.map(type => `
        <label class="checkbox-item">
            <input type="checkbox" class="animal-checkbox" value="${type}" checked>
            <span>${type}</span>
        </label>
    `).join('');

    document.querySelectorAll('.animal-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const allChecked = Array.from(document.querySelectorAll('.animal-checkbox')).every(c => c.checked);
            document.getElementById('selectAllAnimals').checked = allChecked;
            updateFilters();
        });
    });
}

function updateFilters() {
    const checked = Array.from(document.querySelectorAll('.animal-checkbox:checked')).map(cb => cb.value);
    selectedAnimals = checked;
    
    applyFilters();
}

function applyFilters(forceZoom = false) {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.toLocaleLowerCase('tr-TR').trim();
    const queryNoSpaces = query.replace(/\s+/g, '');
    const selectAll = document.getElementById('selectAllAnimals').checked;

    const searchTerms = query.split(/\s+/);

    const filtered = businesses.filter(biz => {
        // Search Filter (İsim, Köy, Telefon, TC, İşletme No)
        if (query) {
            const exactNumberMatch = 
                (biz.phone && biz.phone.replace(/\s+/g, '').includes(queryNoSpaces)) ||
                (biz.tc && biz.tc.includes(queryNoSpaces)) ||
                (biz.id && biz.id.toLocaleLowerCase('tr-TR').includes(queryNoSpaces));

            if (!exactNumberMatch) {
                // Combine fields for word-by-word search (like "Akbaşlar Mustafa")
                const bizText = `${biz.name} ${biz.village}`.toLocaleLowerCase('tr-TR');
                const multiWordMatch = searchTerms.every(term => bizText.includes(term));
                
                if (!multiWordMatch) return false;
            }
        }

        // Animal Filter
        if (selectAll) return true;
        if (selectedAnimals.length === 0) return false;

        // İşletmenin seçili hayvan türlerinden en az birine sahip olup olmadığını kontrol et
        return biz.animals.some(a => selectedAnimals.includes(a.type));
    });

    renderMarkers(filtered);

    // Eğer sonuçlar varsa ve arama yapıldıysa veya forceZoom true ise
    if (filtered.length > 0 && (forceZoom || (query.length > 3 && filtered.length === 1))) {
        currentSearchResults = filtered;
        currentSearchIndex = 0;
        showSearchResult(0);
    } else {
        currentSearchResults = [];
        const searchNav = document.getElementById('searchNav');
        if (searchNav) searchNav.style.display = 'none';
    }
}

window.showSearchResult = function(index) {
    if (!currentSearchResults || currentSearchResults.length === 0) return;
    
    if (index < 0) index = currentSearchResults.length - 1;
    if (index >= currentSearchResults.length) index = 0;
    
    currentSearchIndex = index;
    const biz = currentSearchResults[index];
    
    map.setView([biz.lat, biz.lng], 17);
    showBusinessInfo(biz, true);
};

function renderMarkers(data) {
    markerCluster.clearLayers();
    allMarkers = [];

    data.forEach(biz => {
        const marker = L.marker([biz.lat, biz.lng]);
        
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            showBusinessInfo(biz);
        });

        marker.bizData = biz;
        markerCluster.addLayer(marker);
        allMarkers.push(marker);
    });
}

function showBusinessInfo(biz, fromSearch = false) {
    const panel = document.getElementById('infoPanel');
    const nameEl = document.getElementById('bizName');
    const statusEl = document.getElementById('bizStatus');
    const addressEl = document.getElementById('bizAddress');
    const phoneEl = document.getElementById('bizPhone');
    const idEl = document.getElementById('bizID');
    const callBtn = document.getElementById('callBtn');
    const navBtn = document.getElementById('navBtn');

    nameEl.textContent = biz.name;
    statusEl.textContent = biz.status;
    statusEl.className = `status-badge ${biz.status.toLowerCase() === 'aktif' ? 'status-aktif' : 'status-pasif'}`;
    addressEl.textContent = biz.village + " / İNEGÖL";
    phoneEl.textContent = biz.phone || "Telefon Belirtilmemiş";
    idEl.textContent = "ID: " + biz.id;

    // Animal Stats
    const statsEl = document.getElementById('animalStats');
    if (biz.animals && biz.animals.length > 0) {
        statsEl.innerHTML = biz.animals.map(a => `
            <div class="animal-badge">
                <span class="label">${a.type}</span>
                <span class="count">${a.count}</span>
            </div>
        `).join('');
        statsEl.style.display = 'flex';
    } else {
        statsEl.style.display = 'none';
    }

    if (biz.phone) {
        callBtn.href = `tel:${biz.phone.replace(/\s/g, '')}`;
        callBtn.style.display = 'flex';
    } else {
        callBtn.style.display = 'none';
    }

    navBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${biz.lat},${biz.lng}`;

    // Konum Güncelleme Butonunu Bağla
    const updateLocBtn = document.getElementById('updateLocBtn');
    updateLocBtn.onclick = () => handleLocationUpdate(biz);

    // Search Navigation Pagination
    const searchNav = document.getElementById('searchNav');
    if (searchNav) {
        if (fromSearch && currentSearchResults && currentSearchResults.length > 1) {
            searchNav.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin: 10px 0; background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                    <button onclick="showSearchResult(currentSearchIndex - 1)" style="padding: 6px 10px; font-weight:bold; cursor:pointer; border-radius:8px; background:linear-gradient(135deg, #3b82f6, #2563eb); color:white; border:none; box-shadow: 0 2px 8px rgba(37,99,235,0.3); font-size: 0.85rem;">&laquo; Önceki</button>
                    <span style="font-size:0.9rem; font-weight:bold; color:#fff; background: rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 20px;">${currentSearchIndex + 1} / ${currentSearchResults.length}</span>
                    <button onclick="showSearchResult(currentSearchIndex + 1)" style="padding: 6px 10px; font-weight:bold; cursor:pointer; border-radius:8px; background:linear-gradient(135deg, #3b82f6, #2563eb); color:white; border:none; box-shadow: 0 2px 8px rgba(37,99,235,0.3); font-size: 0.85rem;">Sonraki &raquo;</button>
                </div>
            `;
            searchNav.style.display = 'block';
        } else {
            searchNav.style.display = 'none';
        }
    }

    panel.classList.add('active');
    
    // Center map on marker
    map.setView([biz.lat, biz.lng], 16);
}

async function handleLocationUpdate(biz) {
    if (!userMarker) {
        alert("Şu anki konumunuz henüz belirlenemedi. Lütfen GPS'in açık olduğundan emin olun.");
        return;
    }

    const currentPos = userMarker.getLatLng();
    const newCoords = `${currentPos.lat}\n${currentPos.lng}`; // Excel uyumlu alt alta format
    
    if (confirm(`${biz.name} işletmesinin konumunu şu an bulunduğunuz yer olarak güncellemek istiyor musunuz?`)) {
        const message = `📍 KONUM GÜNCELLEME TALEBİ\n------------------------\n🏢 İşletme: ${biz.name}\n🆔 ID: ${biz.id}\n👤 Bildiren: ${currentUser}\n\n📋 EXCEL İÇİN YENİ KOORDİNAT:\n${newCoords}`;
        
        await sendNotification(message);
        alert("Güncelleme talebi başarıyla iletildi. Ofise döndüğünüzde Excel'i bu koordinatlarla güncelleyebilirsiniz.");
    }
}

function locateUser() {
    if (!navigator.geolocation) {
        alert("Tarayıcınız konum özelliğini desteklemiyor.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            const latlng = [latitude, longitude];

            if (userMarker) {
                userMarker.setLatLng(latlng);
            } else {
                const userIcon = L.divIcon({
                    className: 'user-location-marker',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10],
                    html: `
                        <div class="user-pulse"></div>
                        <div class="user-dot"></div>
                    `
                });
                userMarker = L.marker(latlng, { 
                    icon: userIcon,
                    zIndexOffset: 1000 
                }).addTo(map);
            }

            map.setView(latlng, 15);
        },
        (error) => {
            console.error("Geolocation error:", error);
            // Default to center if blocked
        },
        { enableHighAccuracy: true }
    );
}


// Handle PWA installation
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log(err));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginScreen = document.getElementById('loginScreen');
    const appOverlay = document.getElementById('appOverlay');
    const loginError = document.getElementById('loginError');
    const updateBtn = document.getElementById('updateBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    // Versiyonu yazdır
    document.getElementById('versionTag').textContent = "V" + APP_VERSION;
    document.querySelector('.login-version').textContent = "V" + APP_VERSION;

    // Ayarlar Modal Kontrolleri
    const settingsModal = document.getElementById('settingsModal');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    
    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.add('active');
        });
    }
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('active');
        });
    }
    if (cancelSettingsBtn) {
        cancelSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('active');
        });
    }

    let selectedFiles = { suru: null, detay: null };

    document.getElementById('local-suru')?.addEventListener('change', (e) => {
        selectedFiles.suru = e.target.files[0];
    });

    document.getElementById('local-detay')?.addEventListener('change', (e) => {
        selectedFiles.detay = e.target.files[0];
    });

    document.getElementById('processFilesBtn')?.addEventListener('click', async () => {
        if (!selectedFiles.detay) {
            alert("Lütfen en azından İşletme Detay Listesi (.xls) dosyasını seçiniz!");
            return;
        }

        const processBtn = document.getElementById('processFilesBtn');
        const oldText = processBtn.innerText;
        processBtn.innerText = "Yükleniyor...";
        processBtn.disabled = true;

        try {
            const readExcel = (file, headerRowIdx) => new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const data = new Uint8Array(event.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, range: headerRowIdx });
                    resolve(jsonData);
                };
                reader.readAsArrayBuffer(file);
            });

            // 1. Sürü verisini oku (opsiyonel)
            suruData = {};
            if (selectedFiles.suru) {
                const suruJson = await readExcel(selectedFiles.suru, 12);
                suruJson.forEach(row => {
                    let biz_id = String(row[4] || '').trim();
                    let animal_type = String(row[23] || '').trim();
                    
                    if (animal_type.includes("Ar") && animal_type.includes("Kovan")) animal_type = "Arı Kovanı";
                    else if (animal_type.includes("Sr")) animal_type = "Sığır";
                    
                    let count = 0;
                    try { count = parseInt(parseFloat(row[27] || 0)); } catch(e) {}
                    
                    if (biz_id && animal_type) {
                        if (!suruData[biz_id]) suruData[biz_id] = [];
                        
                        let existing = suruData[biz_id].find(a => a.type === animal_type);
                        if (existing) {
                            existing.count += count;
                        } else {
                            suruData[biz_id].push({type: animal_type, count: count});
                        }
                    }
                });
            }

            // 2. Detay verisini oku
            const detayJson = await readExcel(selectedFiles.detay, 15);
            businesses = [];
            detayJson.forEach(row => {
                let coord_raw = String(row[23] || '').trim();
                if (!coord_raw || coord_raw === "0" || coord_raw === "0.0") return;
                
                let parts = coord_raw.split(/[\s\n,]+/);
                if (parts.length < 2) return;
                
                let v1 = parseFloat(parts[0]);
                let v2 = parseFloat(parts[1]);
                if (isNaN(v1) || isNaN(v2)) return;
                
                let lat, lng;
                if (v1 > 26 && v1 < 32 && v2 > 36 && v2 < 42) {
                    lat = v2; lng = v1;
                } else {
                    lat = v1; lng = v2;
                }
                
                let business_id = String(row[8] || '').trim();
                let name = (String(row[13] || '').trim() + " " + String(row[12] || '').trim()).trim();
                let village = String(row[4] || '').trim();
                let phone = String(row[20] || '').trim() || String(row[21] || '').trim();
                let status = String(row[11] || '').trim();
                let tc = String(row[17] || '').replace(/\.\d+$/, '').trim();
                
                businesses.push({
                    id: business_id,
                    tc: tc,
                    name: name,
                    phone: phone,
                    village: village,
                    status: status,
                    lat: lat,
                    lng: lng,
                    animals: suruData[business_id] || []
                });
            });
            
            animalTypes = [...new Set(businesses.flatMap(b => b.animals.map(a => a.type)))].sort();
            setupAnimalFilter();
            renderMarkers(businesses);
            
            const suruMsg = selectedFiles.suru ? "Sürü detayları ve " : "Sadece ";
            alert(suruMsg + "İşletme Detayları başarıyla yüklendi ve harita güncellendi!");
            settingsModal.classList.remove('active');

        } catch (error) {
            console.error(error);
            alert("Dosya okunurken bir hata oluştu: " + error.message);
        } finally {
            processBtn.innerText = oldText;
            processBtn.disabled = false;
        }
    });

    // Oturum kontrolü (Artık sessionStorage kullanıyoruz - Tarayıcı kapanınca silinir)
    const savedLogin = sessionStorage.getItem('vetmap_isLoggedIn');
    if (savedLogin === 'true') {
        currentUser = sessionStorage.getItem('vetmap_currentUser');
        showApp();
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = document.getElementById('username').value.trim();
        const pass = document.getElementById('password').value;

        const loginBtn = document.querySelector('.login-btn');
        const originalText = loginBtn.innerText;
        loginBtn.innerText = "Giriş Yapılıyor...";
        loginBtn.disabled = true;
        loginError.style.display = 'none';

        try {
            console.log("VetMap Giriş denemesi:", user);
            // Supabase RPC fonksiyonunu çağırıyoruz
            const { data, error } = await supabaseClient.rpc('guvenli_giris_yap', {
                p_kullanici_adi: user,
                p_sifre: pass,
                p_uygulama_adi: 'VetMap'
            });

            if (error) {
                console.error("Supabase RPC Hatası:", error);
                loginError.innerText = "Bağlantı Hatası: " + (error.message || "Sunucuya ulaşılamadı.");
                loginError.style.display = 'block';
                return;
            }

            console.log("RPC Yanıtı:", data);

            if (data && data.basarili) {
                // VetMap uygulaması için yetki kontrolü
                if (data.vetmap_yetkisi) {
                    currentUser = data.kullanici_adi;
                    sessionStorage.setItem('vetmap_isLoggedIn', 'true');
                    sessionStorage.setItem('vetmap_currentUser', currentUser);
                    
                    // ── Telegram tokenini doğrudan tablodan çek (id=2 = VetMap) ──
                    await loadTelegramConfig('vetmap');
                    // ─────────────────────────────────────────────────────────────

                    await sendNotification(`${currentUser} sisteme giriş yaptı!\nUygulama: VetMap v${APP_VERSION}`);
                    showApp();
                } else {
                    loginError.innerText = "Bu hesabın VetMap uygulamasına giriş yetkisi yoktur!";
                    loginError.style.display = 'block';
                }
            } else {
                loginError.innerText = (data && data.mesaj) ? data.mesaj : "Hatalı şifre veya kullanıcı adı!";
                loginError.style.display = 'block';
            }
        } catch (err) {
            console.error("Beklenmeyen hata:", err);
            loginError.innerText = "Beklenmeyen bir hata oluştu. Lütfen internet bağlantınızı kontrol edin.";
            loginError.style.display = 'block';
        } finally {
            loginBtn.innerText = originalText;
            loginBtn.disabled = false;
            document.getElementById('password').value = '';
            // Hata mesajını hemen gizleme, kullanıcı okuyabilsin
        }
    });


    function showApp() {
        loginScreen.classList.add('hidden');
        appOverlay.style.display = 'flex';
        
        // Güncelleme butonu herkese görünür
        updateBtn.style.display = 'flex';

        setTimeout(() => {
            initMap();
            loginScreen.style.display = 'none';
        }, 500);
    }

    // Güncelleme İşlemi
    updateBtn.addEventListener('click', () => {
        if (confirm("Programın en son versiyonuna güncellenmesini istiyor musunuz?")) {
            // Önbelleği temizlemek ve yeni versiyonu zorlamak için reload
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                    for (let registration of registrations) {
                        registration.update();
                    }
                });
            }
            window.location.href = window.location.pathname + "?v=" + APP_VERSION + "_" + Date.now();
        }
    });

    // Oturumu Kapatma (Artık bir buton yerine bir modal açıyoruz veya direkt kapatıyoruz)
    // Ancak kullanıcı arama kutusuna basmak için header'a tıklayabilir.
    // Şimdilik "Güncelle" butonu yanına bir "Çıkış" butonu eklemedik ama logout logicini koruyalım.
    // Eğer kullanıcı çıkmak isterse sayfayı yenilemesi yeterli (sessionStorage kullandığımız için)
    // Veya logoyu tıklanabilir yapıp çıkış modala bağlayabiliriz.
    
    // Header was removed, user can just use refresh to logout if needed

    const logoutModal = document.getElementById('logoutModal');

    document.getElementById('closeLogoutBtn').addEventListener('click', () => {
        logoutModal.classList.remove('active');
    });

    document.getElementById('logoutModalBtn').addEventListener('click', () => {
        sessionStorage.removeItem('vetmap_isLoggedIn');
        sessionStorage.removeItem('vetmap_currentUser');
        sessionStorage.removeItem('vetmap_tgToken');
        sessionStorage.removeItem('vetmap_tgChat');
        window.location.href = window.location.pathname + "?v=" + Date.now();
    });
});

async function sendNotification(message) {
    console.log("Bildirim:", message);

    const tgToken = sessionStorage.getItem('vetmap_tgToken');
    const tgChat = sessionStorage.getItem('vetmap_tgChat');

    if (!tgToken || !tgChat) {
        console.warn("Telegram yapılandırması eksik, bildirim gönderilemedi.");
        return;
    }

    try {
        const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: tgChat, text: message })
        });
    } catch (err) {
        console.error("Telegram bildirim hatası:", err);
    }
}

async function loadTelegramConfig(app) {
    try {
        const { data, error } = await supabaseClient
            .from('uygulama_ayarlari')
            .select('tg_token, tg_chat_id')
            .eq('uygulama_adi', app)
            .single();

        if (error) {
            console.error(`❌ loadTelegramConfig (${app}) hatası:`, error);
            return;
        }

        if (data) {
            sessionStorage.setItem('vetmap_tgToken', data.tg_token || '');
            sessionStorage.setItem('vetmap_tgChat', data.tg_chat_id || '');
            console.log(`✅ Telegram config (${app}) yüklendi.`);
        }
    } catch (err) {
        console.error(`❌ loadTelegramConfig (${app}) beklenmeyen hata:`, err);
    }
}
