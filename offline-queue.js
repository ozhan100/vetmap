// =====================================================================
//  VetMap Çevrimdışı Kuyruk + Manuel İşletme Deposu (offline-queue.js)
//  Amaç: İnternet yokken koordinat taleplerini önce telefona kaydetmek,
//  internet gelince Supabase'e otomatik göndermek. Ayrıca elle girilen
//  işletmeler bu dosyadaki depoda kalıcı tutulur.
//  Not: Kuyruktaki kayıtlar, normal akışla birebir aynı RPC parametre
//  yapısındadır; bu yüzden Araç programında hiçbir değişiklik gerekmez.
// =====================================================================

(function () {
    const KUYRUK_KEY = 'vetmap_bekleyen_talepler';
    const MANUEL_KEY = 'vetmap_manuel_isletmeler';
    const SON_GIRIS_KEY = 'vetmap_son_giris';

    function oku(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch (e) {
            return [];
        }
    }

    function yaz(key, dizi) {
        try {
            localStorage.setItem(key, JSON.stringify(dizi));
        } catch (e) {
            console.warn('Yerel kayıt yazılamadı:', e);
        }
    }

    // Küçük, kendiliğinden kaybolan bilgi baloncuğu (alert kadar keskin değil).
    function toast(mesaj, sureMs) {
        try {
            let el = document.getElementById('vetmap-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'vetmap-toast';
                document.body.appendChild(el);
            }
            el.textContent = mesaj;
            el.classList.add('goster');
            clearTimeout(el._t);
            el._t = setTimeout(() => el.classList.remove('goster'), sureMs || 3500);
        } catch (e) {
            console.log(mesaj);
        }
    }

    let gonderimAktif = false;

    const Kuyruk = {
        sayi() {
            return oku(KUYRUK_KEY).length;
        },
        listele() {
            return oku(KUYRUK_KEY);
        },
        ekle(kayit) {
            const d = oku(KUYRUK_KEY);
            kayit._id = 'q' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
            kayit._zaman = new Date().toISOString();
            kayit._deneme = 0;
            d.push(kayit);
            yaz(KUYRUK_KEY, d);
            this.rozetGuncelle();
            return d.length;
        },
        sil(id) {
            yaz(KUYRUK_KEY, oku(KUYRUK_KEY).filter(k => k._id !== id));
            this.rozetGuncelle();
        },
        rozetGuncelle() {
            const n = this.sayi();
            const btn = document.getElementById('kuyrukBtn');
            const rozet = document.getElementById('kuyrukRozet');
            const etiket = document.getElementById('kuyrukSayi');
            if (btn) btn.style.display = n > 0 ? '' : 'none';
            if (rozet) rozet.textContent = n > 99 ? '99+' : String(n);
            if (etiket) etiket.textContent = n > 0 ? `(${n} bekleyen)` : '(bekleyen yok)';
        },
        // Kuyruktaki kayıtları sırayla Supabase'e gönderir.
        // Sunucu reddi (doğrulama hatası) 3 denemeden sonra atlanır;
        // ağ kopması durumunda kalanlar kuyrukta bekler.
        async gonderHepsini(istemci, token) {
            if (gonderimAktif) return { gonderilen: 0, bekleyen: this.sayi(), calisiyor: true };
            if (!istemci || !token) return { gonderilen: 0, bekleyen: this.sayi(), authGerekli: true };
            gonderimAktif = true;
            const ben = sessionStorage.getItem('vetmap_currentUser') || '';
            let gonderilen = 0;
            let hata = 0;
            try {
                const d = oku(KUYRUK_KEY);
                for (const kayit of d.slice()) {
                    // Başka kullanıcının kuyruğu bu oturumda gönderilmez.
                    if (kayit._kullanici && ben && kayit._kullanici !== ben) continue;
                    // Sunucunun sürekli reddettiği kayıt otomatik denemeye girmez.
                    if ((kayit._deneme || 0) >= 3) continue;
                    try {
                        const params = Object.assign({}, kayit.params, { p_token: token });
                        const sonuc = await istemci.rpc('vetmap_koordinat_talebi_olustur', params);
                        const data = sonuc && sonuc.data;
                        const error = sonuc && sonuc.error;
                        if (error) throw error;
                        if (!data || !data.basarili) {
                            const mesaj = (data && data.mesaj) || '';
                            if (/oturum|token|yetki|giriş/i.test(mesaj)) {
                                return { gonderilen, bekleyen: this.sayi(), authGerekli: true };
                            }
                            throw new Error(mesaj || 'Sunucu talebi reddetti.');
                        }
                        this.sil(kayit._id);
                        gonderilen++;
                    } catch (err) {
                        // Ağ hatası: bağlantı koptu, kalanlar kuyrukta kalsın.
                        if (err instanceof TypeError || /failed to fetch|network|load failed/i.test(String((err && err.message) || ''))) {
                            break;
                        }
                        kayit._deneme = (kayit._deneme || 0) + 1;
                        const tumu = oku(KUYRUK_KEY);
                        const hedef = tumu.find(k => k._id === kayit._id);
                        if (hedef) {
                            hedef._deneme = kayit._deneme;
                            yaz(KUYRUK_KEY, tumu);
                        }
                        hata++;
                    }
                }
            } finally {
                gonderimAktif = false;
                this.rozetGuncelle();
            }
            return { gonderilen, bekleyen: this.sayi(), hata };
        }
    };

    const Manuel = {
        listele() {
            return oku(MANUEL_KEY);
        },
        kaydet(biz) {
            const d = oku(MANUEL_KEY).filter(m => String(m.id) !== String(biz.id));
            d.push(biz);
            yaz(MANUEL_KEY, d);
        },
        sil(id) {
            yaz(MANUEL_KEY, oku(MANUEL_KEY).filter(m => String(m.id) !== String(id)));
        }
    };

    const SonGiris = {
        kaydet(kullanici_adi, token) {
            try {
                localStorage.setItem(SON_GIRIS_KEY, JSON.stringify({
                    kullanici_adi: kullanici_adi,
                    token: token,
                    zaman: Date.now()
                }));
            } catch (e) { /* sessiz geç */ }
        },
        oku() {
            try {
                return JSON.parse(localStorage.getItem(SON_GIRIS_KEY) || 'null');
            } catch (e) {
                return null;
            }
        },
        temizle() {
            try {
                localStorage.removeItem(SON_GIRIS_KEY);
            } catch (e) { /* sessiz geç */ }
        }
    };

    window.VetmapKuyruk = Kuyruk;
    window.VetmapManuel = Manuel;
    window.VetmapSonGiris = SonGiris;
    window.VetmapToast = toast;
})();
