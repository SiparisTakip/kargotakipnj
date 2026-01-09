const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ezyhoocwfrocaqsehler.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6eWhvb2N3ZnJvY2Fxc2VobGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjcyOTkzOTUsImV4cCI6MjA0Mjg3NTM5NX0.3A2pCuleW0RnGIlCaM5pALWw8fB_KW_y2-qsIJ1_FJI";
const SUPABASE_DB = "siparislistesi";
const API_URL = "http://webpostman.yesilkarkargo.com:9999/restapi/client/cargo";
const API_KEY = "jE6csb3PTtLYAdya87Bnp91G0NJfMSCXUZxmHz4r";
const USER_EMAIL = "seffafbutik@yesilkar.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Telefon numarasını düzenle
function duzenle_telefon_numarasi(takip) {
    takip = takip.replace(/\s/g, '');
    if (!takip.startsWith('0')) {
        takip = '0' + takip;
    }
    return takip;
}

// Kargo bilgilerini çek
async function getCargoInfo(gonderino) {
    try {
        const url = `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${gonderino}`;
        const headers = {
            'Authorization': API_KEY,
            'From': USER_EMAIL,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        const response = await axios.get(url, { headers, timeout: 10000 });
        const $ = cheerio.load(response.data);

        let link_cargo = null;
        let link_cikti = null;

        $('a').each((i, elem) => {
            const href = $(elem).attr('href') || '';
            if (href.includes('CargoInfoWaybillAndDelivered.aspx')) {
                link_cargo = `https://kargotakip.araskargo.com.tr/${href}`;
            }
            if (href.includes('CargoInfoTransactionAndRedirection.aspx')) {
                link_cikti = `https://kargotakip.araskargo.com.tr/${href}`;
            }
        });

        if (!link_cargo) return null;

        const cargoResponse = await axios.get(link_cargo, { headers, timeout: 10000 });
        const $cargo = cheerio.load(cargoResponse.data);

        const cikis_sube = $cargo('span#cikis_subesi').text().trim();
        const teslimat_sube = $cargo('span#varis_subesi').text().trim();
        const gonderim_tarihi = $cargo('span#cikis_tarihi').text().trim();
        const son_durum = $cargo('span#Son_Durum').text().trim();
        const alici_adi = $cargo('span#alici_adi_soyadi').text().trim();
        const gonderi_tip = $cargo('span#LabelGonTipi').text().trim();

        let sonuçlar = [];

        if (link_cikti) {
            try {
                const transResponse = await axios.get(link_cikti, { headers, timeout: 10000 });
                const $trans = cheerio.load(transResponse.data);

                const tablo = $trans('table').first().find('tr');
                const pattern = /(\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}:\d{2})([A-ZŞĞİÜÖÇ]+)([A-ZŞĞİÜÖÇ ]+)/g;

                tablo.slice(0, 2).each((i, row) => {
                    const metin = $trans(row).text();
                    let match;
                    while ((match = pattern.exec(metin)) !== null) {
                        sonuçlar.push({
                            "Tarih/Saat": match[1],
                            "İl": match[2],
                            "Birim/İşlem": match[3].trim()
                        });
                    }
                });
            } catch (e) {
                console.log('İşlem tablosu alınamadı:', e.message);
            }
        }

        return {
            bilgiler: {
                "Alıcı Adı": alici_adi,
                "Teslimat Şube": teslimat_sube,
                "Gönderim Tarihi": gonderim_tarihi,
                "Kargo Son Durum": son_durum,
                "Gönderi Tipi": gonderi_tip,
                "Aras KARGO Takip Kodu": gonderino
            },
            son_durum,
            gonderi_tip,
            teslimat_sube,
            sonuçlar
        };
    } catch (error) {
        console.error('Kargo bilgisi hatası:', error.message);
        return null;
    }
}

// Kargo API'den bilgi çek
async function getCargoFromAPI(takip) {
    try {
        const headers = {
            'Authorization': API_KEY,
            'From': USER_EMAIL
        };

        const response = await axios.get(API_URL, {
            headers,
            params: { sipno: takip },
            timeout: 10000
        });

        const json_data = response.data;

        if (json_data.data && json_data.data.length > 0) {
            const data = json_data.data[0];
            const gonderino = data.cikisno;
            const ad = data.aliciadi;
            const soyad = data.alicisoyad;
            const tutar = data.tutar;
            const il = data.sehiradi;
            const ilce = data.ilce;

            if (gonderino === '') {
                return {
                    type: 'takipyok',
                    bilgiler1: {
                        "Alıcı Adı": ad + " " + soyad,
                        "Teslimat Şube": "ARAS KARGO",
                        "Kargo Son Durum": "PAKET YAPILDI",
                        "İL-İLÇE": il + " " + ilce,
                        "Ücret": tutar + "TL"
                    },
                    veriler: ad
                };
            }

            // Gönderino varsa kargo bilgilerini çek
            const cargoInfo = await getCargoInfo(gonderino);
            if (cargoInfo) {
                return {
                    type: 'result',
                    ...cargoInfo
                };
            }
        }

        return null;
    } catch (error) {
        console.error('API hatası:', error.message);
        return null;
    }
}

// Supabase'den bilgi çek
async function getFromSupabase(takip) {
    try {
        const { data, error } = await supabase
            .from(SUPABASE_DB)
            .select('*')
            .eq('TELEFON', takip);

        if (error) throw error;

        if (data && data.length > 0) {
            const row = data[0];
            return {
                type: 'supabase',
                bilgiler: {
                    "Alıcı Adı": row['İSİM SOYİSİM'] || '',
                    "Adres": row['ADRES'] || '',
                    "İl - İlçe": (row['İL'] || '') + " " + (row['İLÇE'] || ''),
                    "Telefon": row['TELEFON'] || ''
                },
                supabase_takip: 'supabase'
            };
        }

        return null;
    } catch (error) {
        console.error('Supabase hatası:', error.message);
        return null;
    }
}

// Routes
app.get('/', (req, res) => {
    res.render('index', { error_message: null });
});

app.post('/', async (req, res) => {
    try {
        let takip = req.body.takip_no || '';
        takip = duzenle_telefon_numarasi(takip);

        if (takip.length !== 11) {
            return res.render('index', {
                error_message: 'Takip numarası bulunamadı. Lütfen geçerli bir numara girin!'
            });
        }

        // Önce API'den dene
        let result = await getCargoFromAPI(takip);

        // API'de bulamazsa Supabase'den dene
        if (!result) {
            result = await getFromSupabase(takip);
        }

        if (!result) {
            return res.render('index', {
                error_message: 'Takip numarası bulunamadı. Lütfen geçerli bir numara girin!'
            });
        }

        if (result.type === 'takipyok') {
            return res.render('takipyok', {
                bilgiler1: result.bilgiler1,
                veriler: result.veriler
            });
        }

        if (result.type === 'supabase') {
            return res.render('result', {
                bilgiler: result.bilgiler,
                supabase_takip: result.supabase_takip,
                son_durum: null,
                gonderi_tip: null,
                teslimat_sube: null,
                sonuçlar: []
            });
        }

        // result.type === 'result'
        return res.render('result', {
            bilgiler: result.bilgiler,
            son_durum: result.son_durum,
            gonderi_tip: result.gonderi_tip,
            teslimat_sube: result.teslimat_sube,
            sonuçlar: result.sonuçlar,
            supabase_takip: null
        });

    } catch (error) {
        console.error('Ana hata:', error);
        res.render('index', {
            error_message: 'Bir hata oluştu. Lütfen daha sonra tekrar deneyin.'
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor`);
});

module.exports = app;
