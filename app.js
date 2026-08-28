// her güncellemeden sonra APP_VERSION 0.01 arttırılsın
const APP_VERSION = "1.65";

/**
 * AGE programındaki KelimeKucult() fonksiyonunun JS karşılığı.
 * Türkçe büyük → küçük harf dönüşümünü tüm tarayıcılarda (iOS Safari dahil) tutarlı yapar.
 * toLocaleLowerCase('tr-TR') mobil WebKit/Blink'te güvenilmez olabileceğinden
 * replace() zinciri + toLowerCase() tercih edilir.
 */
function normalizeText(text) {
    if (text === null || text === undefined || text === '') return '';
    return String(text)
        .replace(/İ/g, 'i')
        .replace(/I/g, 'ı')
        .replace(/Ş/g, 'ş')
        .replace(/Ğ/g, 'ğ')
        .replace(/Ü/g, 'ü')
        .replace(/Ö/g, 'ö')
        .replace(/Ç/g, 'ç')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}
let map;
let markerCluster;
let ownerLabelLayer;
// marker (data) -> etiket marker'i. Etiketler yeniden kullanılır ki
// her pan/zoom'da tüm DOM yıkılıp yeniden kurulmasın (telefonda kasma).
let ownerLabelMarkers = new Map();
let businesses = [];
let animalTypes = [];
let selectedAnimals = [];
let userMarker;
let allMarkers = [];
let suruData = {};

// Hayvan türlerine göre renklendirme.
// Uydu görüntüsündeki tonlarla karışmaması için parlak ve ayırt edici renkler kullanılır.
const ANIMAL_TYPE_COLORS = {
    'Sığır':      { color: '#E63946', name: 'Sığır' },
    'Koyun':      { color: '#457B9D', name: 'Koyun' },
    'Keçi':       { color: '#9D4EDD', name: 'Keçi' },
    'Manda':      { color: '#8B5A2B', name: 'Manda' },
    'At':         { color: '#F77F00', name: 'At' },
    'Eşek':       { color: '#DB7093', name: 'Eşek' },
    'Tavuk':      { color: '#2A9D8F', name: 'Tavuk' },
    'Arı Kovanı': { color: '#FFD60A', name: 'Arı Kovanı' },
    'KARIŞIK':    { color: '#FFFFFF', name: 'Karışık (2+ hayvan türü)' },
    'YOK':        { color: '#808080', name: 'Hayvan Kaydı Yok' }
};

// Tanımlı olmayan yeni hayvan türleri için paletten otomatik renk seçilir.
const UNKNOWN_ANIMAL_COLORS = ['#E76F51', '#264653', '#E5989B', '#B56576', '#43AA8B', '#577590', '#FF9E00', '#6D597A'];

function getAnimalColor(type) {
    if (ANIMAL_TYPE_COLORS[type]) return ANIMAL_TYPE_COLORS[type].color;
    let hash = 0;
    for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
    return UNKNOWN_ANIMAL_COLORS[hash % UNKNOWN_ANIMAL_COLORS.length];
}

function getAnimalTypeColor(biz) {
    if (!biz.animals || biz.animals.length === 0) return ANIMAL_TYPE_COLORS.YOK.color;
    const types = new Set(biz.animals.map(a => a.type));
    if (types.size > 1) return ANIMAL_TYPE_COLORS.KARIŞIK.color;
    return getAnimalColor([...types][0]);
}

function isAnimalKarisik(biz) {
    return !!(biz.animals && new Set(biz.animals.map(a => a.type)).size > 1);
}

// SUPABASE AYARLARI (Supabase panelinden alıp buraya yapıştırın)
const SUPABASE_URL = 'https://tjedetetzqenwdlqgwiv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ig4eVjojcsZqRraP8cD5xg_WPdUsBgp';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentOwnerData = null;
let currentSearchResults = [];
let currentSearchIndex = 0;
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
        maxClusterRadius: 45,
        // 16'ya kadar kümele: zoom 15 gibi yoğun kesimde binlerce bireysel
        // marker(ve etiket) render edilmesin, telefon kasmaya geçmesin.
        disableClusteringAtZoom: 16
    });
    markerCluster.on('animationend', updateOwnerLabels);
    map.addLayer(markerCluster);
    ownerLabelLayer = L.layerGroup().addTo(map);
    map.on('zoomend', updateOwnerLabels);

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
    list.innerHTML = animalTypes.map(type => {
        const c = getAnimalColor(type);
        return `
        <label class="checkbox-item">
            <input type="checkbox" class="animal-checkbox" value="${type}" checked>
            <span class="animal-dot" style="background:${c}"></span>
            <span>${type}</span>
        </label>
    `;
    }).join('');

    list.innerHTML += `
        <div class="legend-extra">
            <span class="animal-dot" style="background:${ANIMAL_TYPE_COLORS.KARIŞIK.color}"></span>
            <span>Karışık (2+ hayvan türü)</span>
        </div>
        <div class="legend-extra">
            <span class="animal-dot" style="background:${ANIMAL_TYPE_COLORS.YOK.color}"></span>
            <span>Hayvan Kaydı Yok</span>
        </div>
    `;

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
    const query = normalizeText(searchInput.value);
    const queryNoSpaces = query.replace(/\s+/g, '');
    const selectAll = document.getElementById('selectAllAnimals').checked;

    const searchTerms = query.split(/\s+/).filter(Boolean);

    const filtered = businesses.filter(biz => {
        // Search Filter (İsim, Köy, Telefon, TC, İşletme No)
        if (query) {
            const exactNumberMatch =
                (biz.phone && biz.phone.replace(/\s+/g, '').includes(queryNoSpaces)) ||
                (biz.tc && biz.tc.includes(queryNoSpaces)) ||
                (biz.id && normalizeText(biz.id).includes(queryNoSpaces));

            if (!exactNumberMatch) {
                // Combine fields for word-by-word search (like "Akbaşlar Mustafa")
                const bizText = normalizeText(`${biz.name || ''} ${biz.village || ''}`);
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

window.showSearchResult = function (index) {
    if (!currentSearchResults || currentSearchResults.length === 0) return;

    if (index < 0) index = currentSearchResults.length - 1;
    if (index >= currentSearchResults.length) index = 0;

    currentSearchIndex = index;
    const biz = currentSearchResults[index];

    map.setView([biz.lat, biz.lng], 17);
    showBusinessInfo(biz);
};

function renderMarkers(data) {
    markerCluster.clearLayers();
    allMarkers = [];
    // Veri yeniden kurulduğunda eski etiket marker'larını ve DOM'unu temizle.
    ownerLabelLayer.clearLayers();
    ownerLabelMarkers.clear();

    data.forEach(biz => {
        const fillColor = getAnimalTypeColor(biz);
        const karisik = isAnimalKarisik(biz);

        const marker = L.circleMarker([biz.lat, biz.lng], {
            radius: karisik ? 10 : 8,
            color: karisik ? '#1d3557' : '#ffffff',
            weight: 2,
            opacity: 0.9,
            fillColor: fillColor,
            fillOpacity: 0.85
        });

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            // Aktif arama varsa tıklanan işletmenin arama listesindeki sırasını bul
            if (currentSearchResults.length > 0) {
                const idx = currentSearchResults.findIndex(b => b.id === biz.id);
                if (idx >= 0) currentSearchIndex = idx;
            }
            showBusinessInfo(biz);
        });

        marker.bizData = biz;
        markerCluster.addLayer(marker);
        allMarkers.push(marker);
    });
    updateOwnerLabels();
}

function updateOwnerLabels() {
    if (!map || !markerCluster || !ownerLabelLayer) return;
    const zoom = map.getZoom();

    // 1) Zoom 16'nın altında markerlar kümeli olduğundan etiket gösterme:
    //    tümünü kaldır.
    if (zoom < 16) {
        ownerLabelMarkers.forEach(label => {
            if (ownerLabelLayer.hasLayer(label)) ownerLabelLayer.removeLayer(label);
        });
        return;
    }

    // 2) Görünür olması gereken (data) marker'ları belirle.
    const visibleDataMarkers = allMarkers.filter(marker => {
        const name = marker.bizData?.name;
        // circleMarker SVG/_path kullandığı için _icon hiç set olmaz;
        // getVisibleParent(marker) === marker her zaman false döner.
        // Bireysel görünürlük: marker'ın DOM öğesi haritada mevcutsa.
        return !!marker.getElement() && markerCluster.hasLayer(marker) && !!name;
    });

    // 3) Kaynak marker -> etiket eşlemesini yeniden oluştur, mevcutları koru.
    const wanted = new Set();
    visibleDataMarkers.forEach(marker => {
        wanted.add(marker);
        let label = ownerLabelMarkers.get(marker);
        if (!label) {
            const name = marker.bizData.name;
            const labelIcon = L.divIcon({
                className: 'business-owner-label-icon',
                html: `<span class="business-owner-label">${escapeHtml(name)}</span>`,
                iconSize: null,
                iconAnchor: [-12, 9]
            });
            label = L.marker(marker.getLatLng(), {
                icon: labelIcon,
                interactive: false,
                keyboard: false,
                zIndexOffset: -100
            });
            ownerLabelMarkers.set(marker, label);
        }
        // Konum sabit olduğundan güncellemeye gerek yok; sadece ekle.
        if (!ownerLabelLayer.hasLayer(label)) ownerLabelLayer.addLayer(label);
    });

    // 4) Artık görünmeyenlerin etiketlerini kaldır (silme, sadece sakla).
    ownerLabelMarkers.forEach((label, dataMarker) => {
        if (!wanted.has(dataMarker) && ownerLabelLayer.hasLayer(label)) {
            ownerLabelLayer.removeLayer(label);
        }
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[character]));
}

function showBusinessInfo(biz) {
    currentOwnerData = biz;
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
        statsEl.innerHTML = biz.animals.map(a => {
            const c = getAnimalColor(a.type);
            return `
            <div class="animal-badge" style="border-color:${c}55; background:${c}1f;">
                <span class="label" style="color:${c};">${a.type}</span>
                <span class="count">${a.count}</span>
            </div>
        `;
        }).join('');
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

    // Aktif arama sonucu varsa (birden fazla işletme) her zaman navigasyon göster
    const searchNav = document.getElementById('searchNav');
    if (searchNav) {
        if (currentSearchResults && currentSearchResults.length > 1) {
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

function getFreshUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Tarayıcı konum özelliğini desteklemiyor.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 30000,
            timeout: 15000
        });
    });
}

async function createCoordinateUpdateRequest() {
    const biz = currentOwnerData;
    const button = document.getElementById('requestCoordUpdateBtn');
    const token = sessionStorage.getItem('vetmap_sessionToken');

    if (!biz || !biz.id) {
        alert('Önce bir işletme seçmelisiniz.');
        return;
    }
    if (!token) {
        alert('VetMap oturumunuz bulunamadı. Lütfen yeniden giriş yapın.');
        return;
    }

    const originalText = button ? button.innerText : '';
    if (button) {
        button.disabled = true;
        button.innerText = 'Konum alınıyor...';
    }

    try {
        const position = await getFreshUserLocation();
        const yeniEnlem = Number(position.coords.latitude);
        const yeniBoylam = Number(position.coords.longitude);

        if (!Number.isFinite(yeniEnlem) || !Number.isFinite(yeniBoylam)) {
            throw new Error('Geçerli konum koordinatı alınamadı.');
        }

        if (button) button.innerText = 'Talep kaydediliyor...';

        const { data, error } = await supabaseClient.rpc(
            'vetmap_koordinat_talebi_olustur',
            {
                p_token: token,
                p_isletme_no: String(biz.id).trim(),
                p_isletme_adi: biz.name || null,
                p_koy: biz.village || null,
                p_mevcut_enlem: Number.isFinite(Number(biz.lat)) ? Number(biz.lat) : null,
                p_mevcut_boylam: Number.isFinite(Number(biz.lng)) ? Number(biz.lng) : null,
                p_yeni_enlem: yeniEnlem,
                p_yeni_boylam: yeniBoylam,
                p_aciklama: 'VetMap konum güncelleme talebi'
            }
        );

        if (error) throw error;
        if (!data || !data.basarili) {
            throw new Error(data?.mesaj || 'Talep oluşturulamadı.');
        }

        alert(`Koordinat güncelleme talebi oluşturuldu.\nİşletme: ${biz.id}`);
    } catch (error) {
        console.error('Koordinat güncelleme talebi hatası:', error);
        alert(error.message || 'Koordinat güncelleme talebi oluşturulamadı.');
    } finally {
        if (button) {
            button.disabled = false;
            button.innerText = originalText || '📍 Koordinat Güncelleme Talebi';
        }
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
        navigator.serviceWorker.register('./sw.js?v=1.65').catch(err => console.log(err));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginScreen = document.getElementById('loginScreen');
    const appOverlay = document.getElementById('appOverlay');
    const loginError = document.getElementById('loginError');

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

    document.getElementById('requestCoordUpdateBtn')?.addEventListener(
        'click',
        createCoordinateUpdateRequest
    );

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
            await processSelectedFiles(selectedFiles);
            settingsModal.classList.remove('active');
        } catch (error) {
            console.error(error);
            alert("Dosya okunurken bir hata oluştu: " + error.message);
        } finally {
            processBtn.innerText = oldText;
            processBtn.disabled = false;
        }
    });

    // Oturum kontrolü — token yalnızca SUNUCUDA doğrulanırsa geçerlidir.
    // (İstemci bayrağına güvenilmez — sahte "isLoggedIn=true" ile giriş atlanamaz.)
    const token = sessionStorage.getItem('vetmap_sessionToken');
    if (token) {
        (async () => {
            try {
                const { data, error } = await supabaseClient.rpc('oturum_dogrula', {
                    p_token: token,
                    p_uygulama_adi: 'VetMap'
                });
                if (!error && data && data.gecerli) {
                    currentUser = data.kullanici_adi;
                    showApp();
                    return;
                }
            } catch (err) {
                console.warn('Oturum doğrulaması başarısız:', err);
            }
            sessionStorage.removeItem('vetmap_sessionToken');
            sessionStorage.removeItem('vetmap_currentUser');
        })();
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
                    sessionStorage.setItem('vetmap_sessionToken', data.token);
                    sessionStorage.setItem('vetmap_currentUser', currentUser);

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
        if (typeof window.initAdminPanel === 'function') {
            window.initAdminPanel({
                appName: 'VetMap',
                supabaseUrl: SUPABASE_URL,
                tokenStorageKey: 'vetmap_sessionToken',
                userName: currentUser
            });
        }

        setTimeout(() => {
            initMap();
            loginScreen.style.display = 'none';
        }, 500);

        // Otomatik veri yükleme: girişten hemen sonra Downloads klasörünü tara
        setTimeout(async () => {
            try {
                if (typeof window.autoLoadFromDownloads === 'function') {
                    await window.autoLoadFromDownloads();
                }
            } catch (err) {
                console.warn('Otomatik veri yükleme başarısız:', err);
            }
        }, 1000);
    }

    // Oturum: token sessionStorage'da tutulur; sekme kapanınca otomatik çıkış olur.

    // Kullanım istatistiği: açıkken 2 dakikada bir sunucuya aktiflik sinyali gönder
    setInterval(async () => {
        const aktifToken = sessionStorage.getItem('vetmap_sessionToken');
        if (!aktifToken) return;
        try {
            await supabaseClient.rpc('aktiflik_bildir', {
                p_token: aktifToken,
                p_uygulama_adi: 'VetMap'
            });
        } catch (err) { /* sessiz geç */ }
    }, 120000);
});

async function processSelectedFiles(files) {
    const readExcel = (file, headerRowIdx) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, range: headerRowIdx });
            resolve(jsonData);
        };
        reader.readAsArrayBuffer(file);
    });

    // 1. Sürü verisini oku (opsiyonel)
    suruData = {};
    if (files.suru) {
        const suruJson = await readExcel(files.suru, 12);
        suruJson.forEach(row => {
            let biz_id = String(row[4] || '').trim();
            let animal_type = String(row[23] || '').trim();

            if (animal_type.includes("Ar") && animal_type.includes("Kovan")) animal_type = "Arı Kovanı";
            else if (animal_type.includes("Sr")) animal_type = "Sığır";

            let count = 0;
            try { count = parseInt(parseFloat(row[27] || 0)); } catch (e) { }

            if (biz_id && animal_type) {
                if (!suruData[biz_id]) suruData[biz_id] = [];

                let existing = suruData[biz_id].find(a => a.type === animal_type);
                if (existing) {
                    existing.count += count;
                } else {
                    suruData[biz_id].push({ type: animal_type, count: count });
                }
            }
        });
    }

    // 2. Detay verisini oku
    const detayJson = await readExcel(files.detay, 15);
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

    const suruMsg = files.suru ? "Sürü detayları ve " : "Sadece ";
    alert(suruMsg + "İşletme Detayları başarıyla yüklendi ve harita güncellendi!");
}


