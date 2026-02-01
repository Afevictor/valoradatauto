const { chromium } = require('playwright');
require('dotenv').config();
const supabase = require('./supabase');
const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * DAT Automation Script - Form Filling Mode
 */

async function downloadPhoto(url, filename) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filename);
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(filename);
            });
        }).on('error', (err) => {
            fs.unlink(filename, () => { });
            reject(err);
        });
    });
}

async function runAutomation() {
    console.log('🚀 Starting Form-Filling Automation...');

    const { data: valuations, error } = await supabase
        .from('anonymized_valuations')
        .select('*')
        .is('feedback', null)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('❌ Supabase Error:', error.message);
        return;
    }

    if (!valuations || valuations.length === 0) {
        console.log('📭 No pending valuations.');
        return;
    }

    for (const valuation of valuations) {
        console.log(`\n🔄 Processing ID: ${valuation.id} (${valuation.registration_number})`);

        const browser = await chromium.launch({
            headless: process.env.HEADLESS !== 'false',
            slowMo: 100
        });
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        try {
            console.log('🔑 Logging in...');
            await page.goto('https://www.datgroup.com/myClaim/index.jsp', { waitUntil: 'networkidle' });

            // Login
            await page.fill('#login-customerNumber', process.env.DAT_CUSTOMER_NUMBER);
            await page.fill('#login-userLogin', process.env.DAT_USER_LOGIN);
            await page.fill('#login-password', process.env.DAT_PASSWORD);
            await page.click('#login-submit');

            // Network selection
            try {
                await page.waitForSelector('#login-networkType', { timeout: 10000 });
                await page.selectOption('#login-networkType', process.env.DAT_NETWORK || 'DAT_IB');
                await page.click('#login-submit');
            } catch (e) { }

            console.log('⏳ Waiting for dashboard...');
            await page.waitForSelector('.button-openClaimButton', { timeout: 30000 });

            // Click "New order"
            await page.click('.button-openClaimButton');
            await page.waitForSelector('li[aria-controls="tab-contractOpening"]', { timeout: 20000 });

            // --- TAB: Apertura ---
            console.log('📂 Filling "Apertura" tab...');
            await page.fill('#customField-input-referenceNumber', valuation.order_number || '');
            await page.fill('#customField-input-address_firstName', valuation.first_name || '');
            await page.fill('#customField-input-address_surname', valuation.last_name || '');

            // Photos
            if (valuation.photos && Array.isArray(valuation.photos)) {
                console.log(`📸 Processing ${valuation.photos.length} photos...`);
                const photoFiles = [];
                for (let i = 0; i < Math.min(valuation.photos.length, 10); i++) {
                    const localPath = path.join(__dirname, `temp_photo_${valuation.id}_${i}.jpg`);
                    try {
                        await downloadPhoto(valuation.photos[i], localPath);
                        photoFiles.push(localPath);
                    } catch (e) { console.error('   Error downloading photo:', e.message); }
                }

                if (photoFiles.length > 0) {
                    try {
                        console.log('📤 Uploading to "Anonymized photos"...');
                        const photoHeader = page.locator('h2.frameHeader:has-text("Anonymized photos")');
                        const photoContainer = page.locator('.document.layout-frame').filter({ has: photoHeader });
                        await photoHeader.scrollIntoViewIfNeeded();
                        await photoContainer.locator('.uploadZone-fileInput').setInputFiles(photoFiles);
                        console.log(`✅ Uploaded ${photoFiles.length} photos.`);
                        await page.waitForTimeout(3000);
                    } catch (e) { console.error('   Upload Error:', e.message); }
                }
                photoFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
            }

            // --- TAB: Vehicle Selection ---
            console.log('🚗 Moving to "Vehicle selection" tab...');
            const vehicleTab = page.locator('li[aria-controls="tab-vehicleSelection"] a, li:has-text("Vehicle selection") a').first();
            await vehicleTab.click({ force: true });
            await page.waitForTimeout(7000);

            console.log('📝 Filling vehicle details...');
            if (valuation.mileage !== undefined && valuation.mileage !== null) {
                const mileageSelectors = ['#customField-input-vehicle_mileage', '#customField-input-mileageOdometer', '#customField-input-vehicle_mileage2'];
                for (const sel of mileageSelectors) {
                    try {
                        const input = page.locator(sel).first();
                        if (await input.count() > 0) {
                            await page.evaluate(({ selector, value }) => {
                                const el = document.querySelector(selector);
                                if (el) { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }
                            }, { selector: sel, value: valuation.mileage.toString() });
                        }
                    } catch (e) { }
                }
            }

            if (valuation.registration_number) {
                const regSelectors = ['#customField-input-vehicle_registration', '#txtLicenceNumberEs', '#txtLicenceNumber', '#customField-input-LicenseNumber'];
                for (const sel of regSelectors) {
                    try {
                        const input = page.locator(sel).first();
                        if (await input.count() > 0) {
                            await page.evaluate(({ selector, value }) => {
                                const el = document.querySelector(selector);
                                if (el) { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }
                            }, { selector: sel, value: valuation.registration_number });
                        }
                    } catch (e) { }
                }
            }

            console.log('✅ Form filling complete.');
            await supabase.from('anonymized_valuations').update({ feedback: 'Success' }).eq('id', valuation.id);
            console.log('✅ Updated Supabase: Success');

        } catch (err) {
            console.error(`❌ Failed for ${valuation.id}:`, err.message);
            await supabase.from('anonymized_valuations').update({ feedback: 'Failed' }).eq('id', valuation.id);
        } finally {
            await browser.close();
            console.log('🏁 Browser closed.');
        }
    }
}

if (require.main === module) {
    runAutomation();
}

module.exports = { runAutomation };
