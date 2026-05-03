const APP_VERSION = "1.3.1";
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

let currentUser = null;

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
    document.getElementById('refreshBtn').addEventListener('click', () => location.reload());
    
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

    searchInput.addEventListener('input', handleSearch);
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
    const selectAll = document.getElementById('selectAllAnimals').checked;

    const filtered = businesses.filter(biz => {
        // Search Filter
        const matchesSearch = !query || 
            biz.name.toLocaleLowerCase('tr-TR').includes(query) ||
            biz.village.toLocaleLowerCase('tr-TR').includes(query) ||
            biz.phone.includes(query);

        if (!matchesSearch) return false;

        // Animal Filter
        if (selectAll) return true;
        if (selectedAnimals.length === 0) return false;

        // İşletmenin seçili hayvan türlerinden en az birine sahip olup olmadığını kontrol et
        return biz.animals.some(a => selectedAnimals.includes(a.type));
    });

    renderMarkers(filtered);

    // Eğer tek bir sonuç varsa veya "Ara" butonuna basılmışsa ilk sonuca odaklan
    if (filtered.length > 0 && (forceZoom || (query.length > 3 && filtered.length === 1))) {
        const first = filtered[0];
        map.setView([first.lat, first.lng], 17);
        // Paneli de otomatik aç
        showBusinessInfo(first);
    }
}

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

function showBusinessInfo(biz) {
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

let searchTimeout;
function handleSearch(e) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        applyFilters();
    }, 400);
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
    const logoutModal = document.getElementById('logoutModal');
    const closeLogoutBtn = document.getElementById('closeLogoutBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    // Versiyonu yazdır
    document.getElementById('versionTag').textContent = "V" + APP_VERSION;
    document.querySelector('.login-version').textContent = "V" + APP_VERSION;

    // Ayarlar Modal Kontrolleri
    const settingsModal = document.getElementById('settingsModal');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    
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

    // Sürü Excel Yükleme
    document.getElementById('local-suru')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, range: 12 }); // 13. satırdan başlar
            
            suruData = {};
            jsonData.forEach(row => {
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
            alert("Sürü verisi başarıyla yüklendi! Lütfen şimdi İşletme Detay dosyasını yükleyin.");
        };
        reader.readAsArrayBuffer(file);
    });

    // Detay Excel Yükleme
    document.getElementById('local-detay')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, range: 15 }); // 16. satırdan başlar
            
            businesses = [];
            jsonData.forEach(row => {
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
                
                businesses.push({
                    id: business_id,
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
            alert("İşletme Detayları başarıyla yüklendi ve harita güncellendi!");
            settingsModal.classList.remove('active');
        };
        reader.readAsArrayBuffer(file);
    });

    // Oturum kontrolü (Artık sessionStorage kullanıyoruz - Tarayıcı kapanınca silinir)
    const savedLogin = sessionStorage.getItem('isLoggedIn');
    if (savedLogin === 'true') {
        currentUser = sessionStorage.getItem('currentUser');
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
                    sessionStorage.setItem('isLoggedIn', 'true');
                    sessionStorage.setItem('currentUser', currentUser);
                    
                    // Telegram ayarlarını kaydediyoruz
                    if (data.telegram_token) {
                        sessionStorage.setItem('tgToken', data.telegram_token);
                        sessionStorage.setItem('tgChat', data.telegram_chat_id);
                    }
                    sendNotification(`${currentUser} sisteme giriş yaptı! (VetMap)`);
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

    closeLogoutBtn.addEventListener('click', () => {
        logoutModal.classList.remove('active');
    });

    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('isLoggedIn');
        sessionStorage.removeItem('currentUser');
        window.location.href = window.location.pathname + "?v=" + Date.now(); // Cache'i aşmak için
    });
});

async function sendNotification(message) {
    console.log("Bildirim:", message);
    
    const tgToken = sessionStorage.getItem('tgToken');
    const tgChat = sessionStorage.getItem('tgChat');
    
    if (AUTH_CONFIG.notificationEnabled && tgToken && tgChat) {
        try {
            const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: tgChat,
                    text: `🔔 VetMap Bildirimi:\n${message}\n📅 ${new Date().toLocaleString('tr-TR')}`
                })
            });
        } catch (error) {
            console.error("Bildirim hatası:", error);
        }
    }
}

